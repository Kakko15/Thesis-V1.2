import time
import logging

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
        res = sb.table('profiles').select('role').eq('id', user_id).execute()
        role = res.data[0].get('role') if res.data else ROLE_STUDENT
        if role not in (ROLE_STUDENT, ROLE_FACULTY, ROLE_ADMIN, ROLE_SUPERADMIN):
            role = ROLE_STUDENT
    except Exception as e:
        logger.error('Failed to fetch user role from profiles: %s', e)
        role = ROLE_STUDENT
    _ROLE_CACHE[user_id] = (role, time.monotonic() + _ROLE_CACHE_TTL)
    return role


def invalidate_role_cache(user_id: str | None = None):
    """Drop cached roles (e.g. after an admin changes someone's role)."""
    if user_id:
        _ROLE_CACHE.pop(user_id, None)
    else:
        _ROLE_CACHE.clear()


def get_optional_user(credentials: HTTPAuthorizationCredentials = Security(optional_security)):
    """Validates the JWT token if present, returns None otherwise."""
    if not credentials:
        return None
    try:
        res = sb.auth.get_user(credentials.credentials)
        if res and res.user:
            return res.user
    except Exception:
        pass
    return None


def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Validates the JWT token and returns the Supabase user object."""
    try:
        res = sb.auth.get_user(credentials.credentials)
        if not res or not res.user:
            raise ValueError('Invalid token')
        return res.user
    except Exception as e:
        logger.warning('Auth error: %s', e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid or expired authentication token',
            headers={'WWW-Authenticate': 'Bearer'},
        ) from e


def require_admin(user=Security(get_current_user)):
    """Allows only administrators and superadmins (archive management, analytics, roles)."""
    if get_user_role(user.id) not in (ROLE_ADMIN, ROLE_SUPERADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Administrator privileges are required for this action.',
        )
    return user


def require_faculty_or_admin(user=Security(get_current_user)):
    """Allows faculty advisers, administrators, and superadmins."""
    if get_user_role(user.id) not in (ROLE_FACULTY, ROLE_ADMIN, ROLE_SUPERADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Faculty or administrator privileges are required for this action.',
        )
    return user


def require_superadmin(user=Security(get_current_user)):
    """Allows only superadmins (full system management)."""
    if get_user_role(user.id) != ROLE_SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Superadmin privileges are required for this action.',
        )
    return user

_FEATURES_CACHE: tuple[dict, float] = ({}, 0.0)

def invalidate_features_cache():
    global _FEATURES_CACHE
    _FEATURES_CACHE = ({}, 0.0)

def get_role_features() -> dict:
    """Fetch feature permissions from system_settings with a short cache."""
    global _FEATURES_CACHE
    if _FEATURES_CACHE[1] > time.monotonic():
        return _FEATURES_CACHE[0]
    try:
        res = sb.table('system_settings').select('value').eq('key', 'role_features').execute()
        if res.data:
            features = res.data[0]['value']
            _FEATURES_CACHE = (features, time.monotonic() + 60.0)
            return features
    except Exception as e:
        logger.error('Failed to fetch role_features: %s', e)
    return {}

def require_novelty_access(user=Security(get_current_user)):
    """Allows access if user is admin/superadmin or if their role has the novelty feature enabled."""
    role = get_user_role(user.id)
    if role in (ROLE_ADMIN, ROLE_SUPERADMIN):
        return user
    features = get_role_features()
    if role in features and features[role].get('novelty') is True:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail='Faculty or administrator privileges are required for this action.',
    )

def require_upload_access(user=Security(get_current_user)):
    """Allows access if user is admin/superadmin or if their role has the upload feature enabled."""
    role = get_user_role(user.id)
    if role in (ROLE_ADMIN, ROLE_SUPERADMIN):
        return user
    features = get_role_features()
    if role in features and features[role].get('upload') is True:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail='Administrator privileges are required for this action.',
    )
