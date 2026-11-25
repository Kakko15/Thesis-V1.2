import threading
import time
import logging
import httpx
import jwt

from fastapi import Security, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client

from config import settings
from services.network_retry import is_transient_network_error, retry_transient

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
# Nothing removed an entry that was never read again, so a long-running process
# serving a whole university accumulated one tuple per user who had ever
# authenticated, forever. Prune expired keys on write and cap the total.
_ROLE_CACHE_MAX_ENTRIES = 2048
# Reads and writes arrive from the event loop's worker threads and from
# FastAPI's sync-dependency pool, so the prune-then-delete sequence needs a
# lock. Held for dict access only, never across the profile lookup.
_role_cache_lock = threading.Lock()


def _prune_role_cache(now: float) -> None:
    """Drop expired entries, then oldest-first while still over the ceiling."""
    for user_id in [
        user_id for user_id, (_role, expires_at) in _ROLE_CACHE.items() if expires_at <= now
    ]:
        del _ROLE_CACHE[user_id]
    overflow = len(_ROLE_CACHE) - _ROLE_CACHE_MAX_ENTRIES + 1
    if overflow <= 0:
        return
    # dict preserves insertion order, so the earliest inserts come first.
    for user_id in list(_ROLE_CACHE)[:overflow]:
        del _ROLE_CACHE[user_id]


def get_user_role(user_id: str) -> str:
    """Return the user's role from profiles, with a short in-process cache."""
    with _role_cache_lock:
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
        # Deliberately NOT cached. Caching the safe fallback would pin a
        # privileged account to `student` for the full TTL after a single
        # transient lookup failure, so every admin request in that window
        # would 403 with no way to clear it. Fail safe, then retry next call.
        logger.exception('Failed to fetch user role from profiles (%s)', type(e).__name__)
        return ROLE_STUDENT
    with _role_cache_lock:
        now = time.monotonic()
        _prune_role_cache(now)
        _ROLE_CACHE[user_id] = (role, now + _ROLE_CACHE_TTL)
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
        logger.exception('Failed to fetch user scope (%s)', type(e).__name__)
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
        logger.exception('Failed to validate requested department (%s)', type(e).__name__)
        raise HTTPException(status_code=503, detail='Department validation is unavailable.') from e
    if not res.data:
        raise HTTPException(status_code=422, detail='Unknown department.')
    return selected


def invalidate_role_cache(user_id: str | None = None):
    """Drop cached roles and approvals (e.g. after an admin changes someone's role)."""
    with _role_cache_lock:
        if user_id:
            _ROLE_CACHE.pop(user_id, None)
        else:
            _ROLE_CACHE.clear()
    with _approved_cache_lock:
        if user_id:
            _APPROVED_CACHE.pop(user_id, None)
        else:
            _APPROVED_CACHE.clear()


# Approved accounts only: {user_id: expires_at}. Every authenticated request
# re-read `profiles.status`, so a dashboard opening six requests at once made
# six identical reads, and one stalled Supabase connection (4.6 s measured
# 2026-11-24) held the whole page on skeletons. A pending or rejected answer is
# never cached, so an approval takes effect on the next request; revoking an
# approval goes through the admin endpoints, which call invalidate_role_cache,
# and otherwise lapses within the TTL, the same bound the role cache accepts.
_APPROVED_CACHE: dict[str, float] = {}
_APPROVED_CACHE_TTL = 30.0
_APPROVED_CACHE_MAX_ENTRIES = 2048
_approved_cache_lock = threading.Lock()


def _ensure_approved_account(user_id: str) -> None:
    """Reject missing, pending, or rejected profiles at the API boundary."""
    with _approved_cache_lock:
        expires_at = _APPROVED_CACHE.get(user_id)
        if expires_at and expires_at > time.monotonic():
            return
    try:
        result = retry_transient(
            lambda: sb.table('profiles').select('status').eq('id', user_id).limit(1).execute(),
            label='Account status lookup',
            attempts=3,
            base_delay_seconds=0.2,
            logger=logger,
        )
    except Exception as error:
        logger.exception('Failed to validate account status (%s)', type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Account validation is temporarily unavailable.',
        ) from error
    if not result.data or result.data[0].get('status') != 'approved':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='This account is pending approval or has been rejected.',
        )
    now = time.monotonic()
    with _approved_cache_lock:
        if len(_APPROVED_CACHE) >= _APPROVED_CACHE_MAX_ENTRIES:
            for stale in [uid for uid, until in _APPROVED_CACHE.items() if until <= now]:
                del _APPROVED_CACHE[stale]
            if len(_APPROVED_CACHE) >= _APPROVED_CACHE_MAX_ENTRIES:
                _APPROVED_CACHE.clear()
        _APPROVED_CACHE[user_id] = now + _APPROVED_CACHE_TTL


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
        # NOSONAR python:S5659 - Reading the header only selects the branch
        # below; it grants nothing on its own. Authentication itself is
        # performed by Supabase before this function is reachable.
        header = jwt.get_unverified_header(token)  # NOSONAR
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
            #
            # NOSONAR python:S5659 - Intentional and bounded, not a bypass:
            #   1. This branch is reachable only after Supabase has validated
            #      this exact token and returned ``expected_user_id``.
            #   2. The only value read is the ``aal`` claim, and the ``sub``
            #      check below discards it unless it belongs to that already
            #      validated identity.
            #   3. Signature verification IS performed whenever a local HS256
            #      secret is configured (the branch above). This fallback
            #      exists solely for Supabase projects on asymmetric signing
            #      keys, where the secret cannot be held locally.
            # Removing it would force a second network round trip per
            # privileged request without adding any security guarantee.
            claims = jwt.decode(
                token,
                options={'verify_signature': False, 'verify_aud': False},  # NOSONAR
            )
        else:
            return 'aal1'
        if expected_user_id and str(claims.get('sub') or '') != expected_user_id:
            return 'aal1'
        return str(claims.get('aal') or 'aal1')
    except (jwt.InvalidTokenError, jwt.DecodeError):
        return 'aal1'


# The single wording of this refusal. The browser reads it to tell an ordinary
# authorization failure from "this session can never do privileged work until
# it reaches aal2", and reacts by offering the second factor rather than a
# Retry button. `rag-thesis-frontend/src/lib/privilegedMfa.js` matches on a
# lowercase prefix of it; `tests/test_auth_authorization.py` pins the string so
# a reworded message cannot quietly strand that side.
PRIVILEGED_MFA_REQUIRED_DETAIL = (
    'Multi-factor authentication is required for privileged access.'
)


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
            detail=PRIVILEGED_MFA_REQUIRED_DETAIL,
        )


AUTH_UNAVAILABLE_DETAIL = 'Authentication is temporarily unavailable. Please try again in a moment.'


# --- Local verification of Supabase access tokens -------------------------
#
# Every authenticated request used to call `sb.auth.get_user`, a network round
# trip to Supabase Auth. Measured 2026-11-24 on the development machine: TLS
# handshakes to Supabase intermittently stalled past httpx's 5 s timeout, so a
# dashboard (six parallel requests) sat on skeletons for 10-15 s while each
# request waited out one or two handshakes just to learn who the caller was.
#
# This project signs access tokens with an asymmetric key (ES256), whose public
# half Supabase publishes at /auth/v1/.well-known/jwks.json. A token verified
# against that key, with its expiry and `authenticated` audience checked, is
# the identity Supabase vouches for; this is what supabase-js `getClaims()`
# does. The key set is fetched once, refreshed every ten minutes, and kept when
# a refresh fails, so token checks no longer touch the network at all.
#
# Trade-off, the same one Supabase documents for `getClaims()`: signing out does
# not revoke an access token that was already issued, so it stays usable until
# its `exp` (one hour by default). Account state is NOT on that path: pending,
# rejected and deleted accounts are still refused by `_ensure_approved_account`
# on the profile row, which the delete cascade removes.
#
# Tokens this cannot verify locally (legacy HS256 without a configured secret,
# or anything that is not a JWT at all) still go to Supabase Auth as before.
_JWKS_URL = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
_JWKS_REFRESH_SECONDS = 600.0
# An unknown `kid` forces a refetch (Supabase rotated its key), but no more
# often than this, so random `kid` values cannot turn into a request flood.
_JWKS_MIN_REFETCH_SECONDS = 30.0
_LOCAL_JWT_ALGORITHMS = frozenset({'ES256', 'RS256', 'EdDSA'})
_JWT_AUDIENCE = 'authenticated'
_jwks_state: dict = {'keys': {}, 'fetched_at': 0.0, 'refreshing': False}
# Guards `_jwks_state`; never held across a download.
_jwks_lock = threading.Lock()
# Single-flight for the one blocking case: a `kid` this process has never seen.
_jwks_fetch_lock = threading.Lock()


class VerifiedUser:  # pylint: disable=too-few-public-methods
    """The caller identity carried by a locally verified Supabase access token.

    Routers read only `.id`; the claims are kept for anything that needs more.
    """

    def __init__(self, claims: dict):
        self.claims = claims
        self.id = claims['sub']
        self.email = claims.get('email')
        self.role = claims.get('role')
        self.aal = claims.get('aal')
        self.user_metadata = claims.get('user_metadata') or {}
        self.app_metadata = claims.get('app_metadata') or {}


def _download_jwks() -> dict[str, dict]:
    def fetch() -> dict[str, dict]:
        response = httpx.get(_JWKS_URL, timeout=5.0)
        response.raise_for_status()
        return {key['kid']: key for key in response.json().get('keys', []) if key.get('kid')}

    return retry_transient(
        fetch, label='Supabase signing-key fetch', attempts=2, base_delay_seconds=0.2, logger=logger,
    )


def _store_jwks(keys: dict[str, dict]) -> None:
    with _jwks_lock:
        _jwks_state['keys'] = keys
        _jwks_state['fetched_at'] = time.monotonic()


def _refresh_jwks_in_background() -> None:
    """Refresh a stale key set without making any request wait for it."""
    with _jwks_lock:
        if _jwks_state['refreshing']:
            return
        _jwks_state['refreshing'] = True

    def run() -> None:
        try:
            _store_jwks(_download_jwks())
        except Exception as error:  # pylint: disable=broad-exception-caught
            # Stale-if-error: a published key does not stop being valid
            # because one refresh could not reach Supabase.
            logger.warning('Signing-key refresh failed (%s); keeping the cached keys', type(error).__name__)
        finally:
            with _jwks_lock:
                _jwks_state['refreshing'] = False

    threading.Thread(target=run, name='jwks-refresh', daemon=True).start()


def _signing_jwk(kid: str) -> dict:
    """The published signing key for `kid`, from cache whenever possible."""
    with _jwks_lock:
        keys = _jwks_state['keys']
        age = time.monotonic() - _jwks_state['fetched_at']
    if kid in keys:
        if age >= _JWKS_REFRESH_SECONDS:
            _refresh_jwks_in_background()
        return keys[kid]
    # Unknown key: first request after startup, or Supabase rotated its key.
    with _jwks_fetch_lock:
        with _jwks_lock:
            keys = _jwks_state['keys']
            age = time.monotonic() - _jwks_state['fetched_at']
        if kid in keys:  # another request fetched it while this one waited
            return keys[kid]
        if keys and age < _JWKS_MIN_REFETCH_SECONDS:
            raise jwt.InvalidTokenError('Unknown signing key')
        latest = _download_jwks()
        _store_jwks(latest)
    if kid not in latest:
        raise jwt.InvalidTokenError('Unknown signing key')
    return latest[kid]


def _verify_token_locally(token: str) -> VerifiedUser | None:
    """Verify an asymmetric Supabase JWT without a network call.

    Returns None when the token is not one this can check (so the caller asks
    Supabase instead); raises a `jwt.PyJWTError` when it is checkable and bad.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    algorithm, kid = header.get('alg'), header.get('kid')
    if algorithm in _LOCAL_JWT_ALGORITHMS and kid:
        key = jwt.PyJWK(_signing_jwk(kid), algorithm=algorithm).key
    elif algorithm == 'HS256' and settings.supabase_jwt_secret:
        key = settings.supabase_jwt_secret
    else:
        return None
    claims = jwt.decode(
        token,
        key=key,
        algorithms=[algorithm],
        audience=_JWT_AUDIENCE,
        options={'require': ['exp', 'sub', 'aud']},
        leeway=30,
    )
    return VerifiedUser(claims)


def _validate_token(token: str):
    """Ask Supabase Auth who owns `token`, riding out brief network failures.

    Measured 2026-11-24: `sb.auth.get_user` raised httpx ConnectTimeout during
    an ordinary page load, and the handlers below turned it into 401. A 401
    tells the browser its session is invalid, so api.js refreshed the token and
    replayed the call (and signs the user out when that refresh also fails) even
    though nothing was wrong with the session. A transient failure is retried
    here, and one that persists is reported as 503 by `_auth_failure`. One retry
    only: each attempt can wait out httpx's 5 s connect timeout, so a third
    would hold the request for ~15 s before the reader hears anything.
    """
    return retry_transient(
        lambda: sb.auth.get_user(token),
        label='Supabase token validation',
        attempts=2,
        base_delay_seconds=0.2,
        logger=logger,
    )


def _auth_failure(error: Exception, context: str) -> HTTPException:
    """401 for a token Supabase rejected; 503 when Supabase could not be reached."""
    if is_transient_network_error(error):
        logger.warning('%s: authentication service unreachable (%s)', context, type(error).__name__)
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=AUTH_UNAVAILABLE_DETAIL,
            headers={'Retry-After': '2'},
        )
    logger.warning('%s (%s)', context, type(error).__name__)
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Invalid or expired authentication token',
        headers={'WWW-Authenticate': 'Bearer'},
    )


def _authenticated_user(token: str):
    """The caller behind `token`: verified locally when possible, else by Supabase."""
    verified = _verify_token_locally(token)
    if verified is not None:
        return verified
    res = _validate_token(token)
    return res.user if res and res.user else None


def get_optional_user(credentials: HTTPAuthorizationCredentials = Security(optional_security)):
    """Validate an optional JWT; an invalid supplied token never becomes a guest."""
    if not credentials:
        return None
    try:
        user = _authenticated_user(credentials.credentials)
        if user:
            _ensure_approved_account(user.id)
            return user
    except HTTPException:
        raise
    except Exception as error:
        raise _auth_failure(error, 'Optional authentication failed') from error
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Invalid or expired authentication token',
        headers={'WWW-Authenticate': 'Bearer'},
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Validates the JWT token and returns the authenticated user."""
    try:
        user = _authenticated_user(credentials.credentials)
        if not user:
            raise ValueError('Invalid token')
        _ensure_approved_account(user.id)
        return user
    except HTTPException:
        raise
    except Exception as e:
        raise _auth_failure(e, 'Authentication failed') from e


def prewarm_signing_keys() -> None:
    """Fetch the signing keys at startup so the first sign-in does not wait on it."""
    try:
        _store_jwks(_download_jwks())
    except Exception as error:  # pylint: disable=broad-exception-caught
        logger.warning('Signing-key prefetch failed (%s); the first request will fetch them', type(error).__name__)


def cached_token_subject(token: str) -> str | None:
    """The verified `sub` of a Supabase token, using only keys already cached.

    For the rate limiter, which runs on the event loop before any route
    dependency: it must never wait on the network, so an unknown `kid` simply
    yields None (the caller falls back to an IP bucket) instead of fetching the
    key set the way `_verify_token_locally` does. Expiry is not checked -- a
    validly signed token still identifies whose bucket a request belongs to,
    and authorization is decided separately by the route's own dependency.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    algorithm, kid = header.get('alg'), header.get('kid')
    if algorithm in _LOCAL_JWT_ALGORITHMS and kid:
        with _jwks_lock:
            jwk = _jwks_state['keys'].get(kid)
        if not jwk:
            return None
        try:
            key = jwt.PyJWK(jwk, algorithm=algorithm).key
        except jwt.PyJWTError:
            return None
    elif algorithm == 'HS256' and settings.supabase_jwt_secret:
        key = settings.supabase_jwt_secret
    else:
        return None
    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=[algorithm],
            audience=_JWT_AUDIENCE,
            options={'require': ['sub', 'aud'], 'verify_exp': False},
        )
    except jwt.PyJWTError:
        return None
    subject = claims.get('sub')
    return subject if isinstance(subject, str) and subject else None


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
        logger.exception('Failed to fetch role features (%s)', type(e).__name__)
    return {}

def _feature_enabled(role: str, feature: str) -> bool:
    """Whether `role` may use `feature`, falling back to the documented default.

    `get_role_features` returns `{}` when `system_settings` is unreachable, and
    the two guards below treat that as a refusal. That is right for `upload` and
    `novelty`, which default to False: failing closed matches the policy. It is
    the wrong answer for `chat` and `archive`, which default to True for both
    non-privileged roles -- refusing those on a transient read failure would
    take the whole library offline for every student and faculty member, which
    is a worse outcome than a toggle going briefly unenforced. So those two read
    through to the same `DEFAULT_FEATURES` the frontend mirrors in
    `src/lib/permissions.js`, and only an explicitly stored `false` denies.

    Imported inside the function because `routers.settings` imports this module;
    at module scope the two would be a cycle.
    """
    from routers.settings import DEFAULT_FEATURES

    features = get_role_features()
    configured = features.get(role) if isinstance(features, dict) else None
    if isinstance(configured, dict) and isinstance(configured.get(feature), bool):
        return configured[feature]
    return bool((DEFAULT_FEATURES.get(role) or {}).get(feature))


# The role-feature matrix names four features, and until 2026-09-12 only two of
# them were enforced anywhere but the browser. `novelty` had
# `require_novelty_access` and `upload` had `require_upload_access`; `chat` and
# `archive` had no server-side guard at all, so turning either off for a role
# changed only `canChat` / `canArchive` in the React context and any student
# could still call POST /chat and GET /papers directly. The superadmin screen
# presents all four as access controls, so two of them were telling the truth
# and two were decoration.
#
# Deliberately NOT calling `_require_privileged_mfa` for an administrator here,
# unlike the upload and novelty guards. Those protect privileged operations;
# reading the archive and asking a research question are ordinary user features,
# and requiring aal2 for them would lock an administrator out of the library
# itself the moment REQUIRE_PRIVILEGED_MFA was enabled.
def _require_feature(user, feature: str, refusal: str):
    role = get_user_role(user.id)
    if role in (ROLE_ADMIN, ROLE_SUPERADMIN):
        return user
    if _feature_enabled(role, feature):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=refusal)


def require_chat_access(user=Security(get_optional_user)):
    """Guests are always allowed; a signed-in role must have `chat` enabled.

    Optional rather than required authentication, because guest chat is a
    documented feature of this deployment and the matrix only describes the
    signed-in roles.
    """
    if user is None:
        return None
    return _require_feature(
        user, 'chat', 'Research chat is not enabled for your role.',
    )


def require_archive_access(user=Security(get_current_user)):
    """Allows admins, and any role whose `archive` feature is enabled."""
    return _require_feature(
        user, 'archive', 'Archive access is not enabled for your role.',
    )


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
