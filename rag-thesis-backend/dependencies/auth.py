import time
import logging
import jwt

from fastapi import Security, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client

from config import settings

logger = logging.getLogger(__name__)

sb = create_client(settings.supabase_url, settings.supabase_key)
security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

ROLE_STUDENT = 'student'
ROLE_FACULTY = 'faculty'
ROLE_ADMIN = 'admin'
ROLE_SUPERADMIN = 'superadmin'

# Short-lived in-process role cache: {user_id: (role, expires_at)}
_ROLE_CACHE: dict[str, tuple[str, float]] = {}
_ROLE_CACHE_TTL = 60.0  # seconds


def get_user_role(user_id: str) -> str:
    """Return the user's role from profiles, with a short in-process cache."""
    cached = _ROLE_CACHE.get(user_id)
    if cached and cached[1] > time.monotonic():
        return cached[0]
    try:
        res = sb.table('profiles').select('role,status').eq('id', user_id).execute()
        profile = res.data[0] if res.data else {}
        role = profile.get('role') if profile.get('status', 'approved') == 'approved' else ROLE_STUDENT
        if role not in (ROLE_STUDENT, ROLE_FACULTY, ROLE_ADMIN, ROLE_SUPERADMIN):
            role = ROLE_STUDENT
    except Exception as e:
        logger.error('Failed to fetch user role from profiles (%s)', type(e).__name__)
        role = ROLE_STUDENT
    _ROLE_CACHE[user_id] = (role, time.monotonic() + _ROLE_CACHE_TTL)
    return role


def get_user_scope(user_id: str) -> dict:
    """Return the authoritative role and department for retrieval policy."""
    try:
        res = sb.table('profiles').select('role,department,status').eq('id', user_id).execute()
        if res.data:
            profile = res.data[0]
            if profile.get('status') != 'approved':
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail='This account is not approved for application access.',
                )
            return {
                'role': profile.get('role') or ROLE_STUDENT,
                'department': profile.get('department') or settings.thesis_evaluation_department,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error('Failed to fetch user scope (%s)', type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='User department validation is unavailable.',
        ) from e
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail='A valid user profile is required for department-scoped access.',
    )


def resolve_effective_department(user, requested: str | None = None) -> str:
    """Enforce the server-owned department boundary for every RAG operation."""
    if user is None:
        return settings.thesis_evaluation_department

    scope = get_user_scope(user.id)
    role = scope['role']
    assigned = scope['department']
    if role != ROLE_SUPERADMIN:
        if requested and requested != assigned:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='You can only search your assigned department.',
            )
        return assigned

    selected = requested or assigned or settings.thesis_evaluation_department
    try:
        res = sb.table('departments').select('name').eq('name', selected).limit(1).execute()
    except Exception as e:
        logger.error('Failed to validate requested department (%s)', type(e).__name__)
        raise HTTPException(status_code=503, detail='Department validation is unavailable.') from e
    if not res.data:
        raise HTTPException(status_code=422, detail='Unknown department.')
    return selected


def invalidate_role_cache(user_id: str | None = None):
    """Drop cached roles (e.g. after an admin changes someone's role)."""
    if user_id:
        _ROLE_CACHE.pop(user_id, None)
    else:
        _ROLE_CACHE.clear()


def _ensure_approved_account(user_id: str) -> None:
    """Reject missing, pending, or rejected profiles at the API boundary."""
    try:
        result = sb.table('profiles').select('status').eq('id', user_id).limit(1).execute()
    except Exception as error:
        logger.error('Failed to validate account status (%s)', type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Account validation is temporarily unavailable.',
        ) from error
    if not result.data or result.data[0].get('status') != 'approved':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='This account is pending approval or has been rejected.',
        )


def _token_aal(
    credentials: HTTPAuthorizationCredentials,
    expected_user_id: str | None = None,
) -> str:
    """Read AAL after Supabase has validated this exact access token.

    A configured legacy HS256 secret still enables local signature checking.
    Without it, privileged guards may decode only after ``get_current_user``
    has successfully validated the same token with Supabase, and the token
    subject must match that validated user. This supports Supabase projects
    using newer asymmetric signing keys without weakening authentication.
    """
    token = getattr(credentials, 'credentials', None)
    if not isinstance(token, str) or not token:
        return 'aal1'
    try:
        header = jwt.get_unverified_header(token)
        algorithm = str(header.get('alg') or '')
        if settings.supabase_jwt_secret and algorithm == 'HS256':
            claims = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=['HS256'],
                audience='authenticated',
            )
        elif expected_user_id:
            # ``get_current_user`` has already sent this exact token to
            # Supabase and returned ``expected_user_id``.  Reading its claims
            # here supports projects that use asymmetric signing keys without
            # adding a second network request.  The subject match below binds
            # the claim to the remotely validated identity.
            claims = jwt.decode(
                token,
                options={'verify_signature': False, 'verify_aud': False},
            )
        else:
            return 'aal1'
        if expected_user_id and str(claims.get('sub') or '') != expected_user_id:
            return 'aal1'
        return str(claims.get('aal') or 'aal1')
    except (jwt.InvalidTokenError, jwt.DecodeError):
        return 'aal1'


def _require_privileged_mfa(
    credentials: HTTPAuthorizationCredentials,
    expected_user_id: str,
) -> None:
    if (
        settings.require_privileged_mfa
        and _token_aal(credentials, expected_user_id) != 'aal2'
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Multi-factor authentication is required for privileged access.',
        )


def get_optional_user(credentials: HTTPAuthorizationCredentials = Security(optional_security)):
    """Validate an optional JWT; an invalid supplied token never becomes a guest."""
    if not credentials:
        return None
    try:
        res = sb.auth.get_user(credentials.credentials)
        if res and res.user:
            _ensure_approved_account(res.user.id)
            return res.user
    except HTTPException:
        raise
    except Exception as error:
        logger.warning('Optional authentication failed: %s', type(error).__name__)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Invalid or expired authentication token',
        headers={'WWW-Authenticate': 'Bearer'},
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Validates the JWT token and returns the Supabase user object."""
    try:
        res = sb.auth.get_user(credentials.credentials)
        if not res or not res.user:
            raise ValueError('Invalid token')
        _ensure_approved_account(res.user.id)
        return res.user
    except HTTPException:
        raise
    except Exception as e:
        logger.warning('Authentication failed (%s)', type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid or expired authentication token',
            headers={'WWW-Authenticate': 'Bearer'},
        ) from e


def require_admin(
    user=Security(get_current_user),
    credentials: HTTPAuthorizationCredentials = Security(security),
):
    """Allows only administrators and superadmins (archive management, analytics, roles)."""
    if get_user_role(user.id) not in (ROLE_ADMIN, ROLE_SUPERADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Administrator privileges are required for this action.',
        )
    _require_privileged_mfa(credentials, user.id)
    return user


def require_faculty_or_admin(
    user=Security(get_current_user),
    credentials: HTTPAuthorizationCredentials = Security(security),
):
    """Allows faculty advisers, administrators, and superadmins."""
    if get_user_role(user.id) not in (ROLE_FACULTY, ROLE_ADMIN, ROLE_SUPERADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Faculty or administrator privileges are required for this action.',
        )
    if get_user_role(user.id) in (ROLE_ADMIN, ROLE_SUPERADMIN):
        _require_privileged_mfa(credentials, user.id)
    return user


def require_superadmin(
    user=Security(get_current_user),
    credentials: HTTPAuthorizationCredentials = Security(security),
):
    """Allows only superadmins (full system management)."""
    if get_user_role(user.id) != ROLE_SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Superadmin privileges are required for this action.',
        )
    _require_privileged_mfa(credentials, user.id)
    return user

_FEATURES_CACHE: dict[str, object] = {
    'features': {},
    'expires_at': 0.0,
}

def invalidate_features_cache():
    """Clear cached role-feature settings without rebinding module state."""
    _FEATURES_CACHE['features'] = {}
    _FEATURES_CACHE['expires_at'] = 0.0

def get_role_features() -> dict:
    """Fetch feature permissions from system_settings with a short cache."""
    expires_at = float(_FEATURES_CACHE['expires_at'])
    if expires_at > time.monotonic():
        return dict(_FEATURES_CACHE['features'])
    try:
        res = sb.table('system_settings').select('value').eq('key', 'role_features').execute()
        if res.data:
            features = res.data[0]['value']
            _FEATURES_CACHE['features'] = features
            _FEATURES_CACHE['expires_at'] = time.monotonic() + 60.0
            return features
    except Exception as e:
        logger.error('Failed to fetch role features (%s)', type(e).__name__)
    return {}

def require_novelty_access(
    user=Security(get_current_user),
    credentials: HTTPAuthorizationCredentials = Security(security),
):
    """Allows access if user is admin/superadmin or if their role has the novelty feature enabled."""
    role = get_user_role(user.id)
    if role in (ROLE_ADMIN, ROLE_SUPERADMIN):
        _require_privileged_mfa(credentials, user.id)
        return user
    features = get_role_features()
    if role in features and features[role].get('novelty') is True:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail='Faculty or administrator privileges are required for this action.',
    )

def require_upload_access(
    user=Security(get_current_user),
    credentials: HTTPAuthorizationCredentials = Security(security),
):
    """Allows access if user is admin/superadmin or if their role has the upload feature enabled."""
    role = get_user_role(user.id)
    if role in (ROLE_ADMIN, ROLE_SUPERADMIN):
        _require_privileged_mfa(credentials, user.id)
        return user
    features = get_role_features()
    if role in features and features[role].get('upload') is True:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail='Administrator privileges are required for this action.',
    )
