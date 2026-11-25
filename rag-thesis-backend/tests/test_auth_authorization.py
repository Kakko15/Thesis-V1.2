import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from dependencies import auth


class Query:
    def __init__(self, data=None, error=None):
        self.data = data or []
        self.error = error

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def limit(self, *_args): return self
    def execute(self):
        if self.error:
            raise self.error
        return SimpleNamespace(data=self.data)


class Client:
    def __init__(self, tables=None, auth_result=None, auth_error=None):
        self.tables = tables or {}
        self.auth_result = auth_result
        self.auth_error = auth_error
        self.auth = self

    def table(self, name): return Query(*self.tables.get(name, ([], None)))
    def get_user(self, _token):
        if self.auth_error:
            raise self.auth_error
        return self.auth_result


@pytest.fixture(autouse=True)
def clear_caches(monkeypatch):
    # Guard unit tests invoke dependencies directly, outside FastAPI's
    # credential injection. Individual MFA tests opt back in explicitly.
    monkeypatch.setattr(auth.settings, 'require_privileged_mfa', False)
    auth.invalidate_role_cache()
    auth.invalidate_features_cache()
    yield
    auth.invalidate_role_cache()
    auth.invalidate_features_cache()


class TestRoleAndScope:
    def test_role_lookup_cache_and_invalid_role_fallback(self, monkeypatch):
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([{'role': 'admin'}], None)}))
        assert auth.get_user_role('u1') == 'admin'
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([{'role': 'hacker'}], None)}))
        assert auth.get_user_role('u1') == 'admin'
        auth.invalidate_role_cache('u1')
        assert auth.get_user_role('u1') == 'student'

    def test_role_lookup_failure_defaults_to_student(self, monkeypatch):
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([], RuntimeError('offline'))}))
        assert auth.get_user_role('u1') == 'student'

    def test_role_lookup_failure_is_not_cached(self, monkeypatch):
        # Caching the safe fallback pinned a privileged account to `student`
        # for the full TTL after one transient failure, so every admin request
        # in that window 403'd with no way to clear it.
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([], RuntimeError('offline'))}))
        assert auth.get_user_role('u1') == 'student'
        assert 'u1' not in auth._ROLE_CACHE
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([{'role': 'admin'}], None)}))
        assert auth.get_user_role('u1') == 'admin'

    def test_scope_defaults_department_and_rejects_missing_profile(self, monkeypatch):
        monkeypatch.setattr(auth, 'sb', Client({
            'profiles': ([{'role': None, 'department': None, 'status': 'approved'}], None),
        }))
        assert auth.get_user_scope('u1') == {'role': 'student', 'department': 'CCSICT'}
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([], None)}))
        with pytest.raises(HTTPException) as caught:
            auth.get_user_scope('missing')
        assert caught.value.status_code == 403

    def test_scope_backend_failure_is_503(self, monkeypatch):
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([], RuntimeError('offline'))}))
        with pytest.raises(HTTPException) as caught:
            auth.get_user_scope('u1')
        assert caught.value.status_code == 503

    def test_department_resolution_for_guest_ordinary_and_superadmin(self, monkeypatch):
        assert auth.resolve_effective_department(None, 'OTHER') == 'CCSICT'
        monkeypatch.setattr(auth, 'get_user_scope', lambda _uid: {'role': 'student', 'department': 'CCSICT'})
        assert auth.resolve_effective_department(SimpleNamespace(id='u1')) == 'CCSICT'
        with pytest.raises(HTTPException) as caught:
            auth.resolve_effective_department(SimpleNamespace(id='u1'), 'CAS')
        assert caught.value.status_code == 403

        monkeypatch.setattr(auth, 'get_user_scope', lambda _uid: {'role': 'superadmin', 'department': 'CCSICT'})
        monkeypatch.setattr(auth, 'sb', Client({'departments': ([{'name': 'CAS'}], None)}))
        assert auth.resolve_effective_department(SimpleNamespace(id='root'), 'CAS') == 'CAS'
        monkeypatch.setattr(auth, 'sb', Client({'departments': ([], None)}))
        with pytest.raises(HTTPException) as unknown:
            auth.resolve_effective_department(SimpleNamespace(id='root'), 'UNKNOWN')
        assert unknown.value.status_code == 422

    def test_superadmin_department_validation_failure_is_503(self, monkeypatch):
        monkeypatch.setattr(auth, 'get_user_scope', lambda _uid: {'role': 'superadmin', 'department': 'CCSICT'})
        monkeypatch.setattr(auth, 'sb', Client({'departments': ([], RuntimeError('offline'))}))
        with pytest.raises(HTTPException) as caught:
            auth.resolve_effective_department(SimpleNamespace(id='root'), 'CAS')
        assert caught.value.status_code == 503


class TestTokenAndRoleGuards:
    def test_token_aal_requires_a_valid_signature(self, monkeypatch):
        secret = 'unit-test-supabase-jwt-secret-at-least-32-bytes'
        monkeypatch.setattr(auth.settings, 'supabase_jwt_secret', secret)
        valid = auth.jwt.encode(
            {'sub': 'u1', 'aud': 'authenticated', 'aal': 'aal2'},
            secret,
            algorithm='HS256',
        )
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=valid)
        assert auth._token_aal(credentials) == 'aal2'

        forged = auth.jwt.encode(
            {'sub': 'u1', 'aud': 'authenticated', 'aal': 'aal2'},
            'different-unit-test-secret-at-least-32-bytes',
            algorithm='HS256',
        )
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=forged)
        assert auth._token_aal(credentials) == 'aal1'

        monkeypatch.setattr(auth.settings, 'supabase_jwt_secret', '')
        assert auth._token_aal(credentials) == 'aal1'

        validated = auth.jwt.encode(
            {'sub': 'u1', 'aud': 'authenticated', 'aal': 'aal2'},
            'asymmetric-provider-placeholder-key-32-bytes',
            algorithm='HS256',
        )
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=validated)
        assert auth._token_aal(credentials, 'u1') == 'aal2'
        assert auth._token_aal(credentials, 'different-user') == 'aal1'
        assert auth._token_aal(object(), 'u1') == 'aal1'

        # A remotely validated token from a project using asymmetric signing
        # must not be forced through the optional legacy HS256 secret.
        monkeypatch.setattr(auth.settings, 'supabase_jwt_secret', secret)
        monkeypatch.setattr(auth.jwt, 'get_unverified_header', lambda _token: {'alg': 'ES256'})
        assert auth._token_aal(credentials, 'u1') == 'aal2'

    def test_optional_and_required_token_paths(self, monkeypatch):
        assert auth.get_optional_user(None) is None
        user = SimpleNamespace(id='u1')
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials='token')
        monkeypatch.setattr(auth, 'sb', Client(
            {'profiles': ([{'status': 'approved'}], None)},
            auth_result=SimpleNamespace(user=user),
        ))
        assert auth.get_optional_user(credentials) is user
        assert auth.get_current_user(credentials) is user
        monkeypatch.setattr(auth, 'sb', Client(auth_error=RuntimeError('bad token')))
        with pytest.raises(HTTPException) as optional_error:
            auth.get_optional_user(credentials)
        assert optional_error.value.status_code == 401
        with pytest.raises(HTTPException) as caught:
            auth.get_current_user(credentials)
        assert caught.value.status_code == 401

    def test_a_brief_auth_outage_is_retried_not_treated_as_a_bad_token(self, monkeypatch):
        """Measured 2026-11-24: Supabase Auth raised httpx ConnectTimeout during
        a page load and the guard answered 401, which makes the browser refresh
        the token and sign the user out if that refresh also fails."""
        import httpx
        from services import network_retry

        monkeypatch.setattr(network_retry.time, 'sleep', lambda _seconds: None)
        user = SimpleNamespace(id='u1')
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials='token')

        class FlakyAuth(Client):
            calls = 0

            def get_user(self, _token):
                FlakyAuth.calls += 1
                if FlakyAuth.calls == 1:
                    raise httpx.ConnectTimeout('timed out')
                return SimpleNamespace(user=user)

        monkeypatch.setattr(auth, 'sb', FlakyAuth({'profiles': ([{'status': 'approved'}], None)}))
        assert auth.get_current_user(credentials) is user
        assert FlakyAuth.calls == 2

    def test_an_unreachable_auth_service_is_503_for_both_guards(self, monkeypatch):
        import httpx
        from services import network_retry

        monkeypatch.setattr(network_retry.time, 'sleep', lambda _seconds: None)
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials='token')
        monkeypatch.setattr(auth, 'sb', Client(auth_error=httpx.ConnectTimeout('timed out')))
        for guard in (auth.get_current_user, auth.get_optional_user):
            with pytest.raises(HTTPException) as caught:
                guard(credentials)
            assert caught.value.status_code == 503
            assert caught.value.detail == auth.AUTH_UNAVAILABLE_DETAIL
            assert caught.value.headers == {'Retry-After': '2'}

    def test_the_auth_outage_wording_matches_the_frontend(self):
        """`src/lib/apiErrors.js` retries a GET on exactly this detail."""
        from pathlib import Path

        frontend = Path(__file__).resolve().parents[2] / 'rag-thesis-frontend' / 'src' / 'lib' / 'apiErrors.js'
        if not frontend.exists():
            pytest.skip('frontend source not present in this checkout')
        assert f"'{auth.AUTH_UNAVAILABLE_DETAIL}'" in frontend.read_text(encoding='utf-8')

    def test_a_transient_profile_lookup_failure_is_retried(self, monkeypatch):
        import httpx
        from services import network_retry

        monkeypatch.setattr(network_retry.time, 'sleep', lambda _seconds: None)
        attempts = []

        class FlakyQuery(Query):
            def execute(self):
                attempts.append(1)
                if len(attempts) == 1:
                    raise httpx.ReadTimeout('timed out')
                return SimpleNamespace(data=[{'status': 'approved'}])

        class FlakyProfiles(Client):
            def table(self, _name): return FlakyQuery()

        monkeypatch.setattr(auth, 'sb', FlakyProfiles())
        auth._ensure_approved_account('u1')
        assert len(attempts) == 2

    def test_pending_account_and_privileged_mfa_are_enforced(self, monkeypatch):
        user = SimpleNamespace(id='u1')
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials='token')
        monkeypatch.setattr(auth, 'sb', Client(
            {'profiles': ([{'status': 'pending'}], None)},
            auth_result=SimpleNamespace(user=user),
        ))
        with pytest.raises(HTTPException) as pending:
            auth.get_current_user(credentials)
        assert pending.value.status_code == 403

        monkeypatch.setattr(auth.settings, 'require_privileged_mfa', True)
        monkeypatch.setattr(auth, 'get_user_role', lambda _uid: 'admin')
        monkeypatch.setattr(auth, '_token_aal', lambda _credentials, _user_id: 'aal1')
        with pytest.raises(HTTPException) as mfa_required:
            auth.require_admin(user, credentials)
        assert mfa_required.value.status_code == 403
        monkeypatch.setattr(auth, '_token_aal', lambda _credentials, _user_id: 'aal2')
        assert auth.require_admin(user, credentials) is user

    def test_the_mfa_refusal_is_worded_identically_by_every_privileged_guard(
        self, monkeypatch,
    ):
        """The browser reads this wording to distinguish "you lack the role"
        from "this session has not reached aal2" -- only the second is fixable
        without signing in as somebody else, and only the second should offer
        the second factor instead of a Retry button. The literal below is the
        contract `rag-thesis-frontend/src/lib/privilegedMfa.js` matches on; if
        this assertion is edited, that matcher has to move with it.
        """
        assert auth.PRIVILEGED_MFA_REQUIRED_DETAIL == (
            'Multi-factor authentication is required for privileged access.'
        )

        user = SimpleNamespace(id='u1')
        credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials='token')
        monkeypatch.setattr(auth.settings, 'require_privileged_mfa', True)
        monkeypatch.setattr(auth, '_token_aal', lambda _credentials, _user_id: 'aal1')
        monkeypatch.setattr(auth, 'get_role_features', lambda: {})

        for guard, role in (
            (auth.require_admin, 'admin'),
            (auth.require_superadmin, 'superadmin'),
            (auth.require_faculty_or_admin, 'admin'),
            (auth.require_novelty_access, 'admin'),
            (auth.require_upload_access, 'superadmin'),
        ):
            monkeypatch.setattr(auth, 'get_user_role', lambda _uid, role=role: role)
            with pytest.raises(HTTPException) as refused:
                guard(user, credentials)
            assert refused.value.status_code == 403
            assert refused.value.detail == auth.PRIVILEGED_MFA_REQUIRED_DETAIL, (
                f'{guard.__name__} must refuse in the wording the browser reads'
            )

    def test_a_role_refusal_is_not_worded_as_an_mfa_refusal(self, monkeypatch):
        """The inverse: a genuine privilege failure must not send the browser
        chasing a second factor that would not help."""
        user = SimpleNamespace(id='u1')
        monkeypatch.setattr(auth, 'get_user_role', lambda _uid: 'student')
        monkeypatch.setattr(auth, 'get_role_features', lambda: {})
        for guard in (auth.require_admin, auth.require_novelty_access, auth.require_upload_access):
            with pytest.raises(HTTPException) as refused:
                guard(user)
            assert refused.value.status_code == 403
            assert refused.value.detail != auth.PRIVILEGED_MFA_REQUIRED_DETAIL

    @pytest.mark.parametrize('guard,allowed,denied', [
        (auth.require_admin, 'admin', 'faculty'),
        (auth.require_faculty_or_admin, 'faculty', 'student'),
        (auth.require_superadmin, 'superadmin', 'admin'),
    ])
    def test_fixed_role_guards(self, monkeypatch, guard, allowed, denied):
        user = SimpleNamespace(id='u1')
        monkeypatch.setattr(auth, 'get_user_role', lambda _uid: allowed)
        assert guard(user) is user
        monkeypatch.setattr(auth, 'get_user_role', lambda _uid: denied)
        with pytest.raises(HTTPException) as caught:
            guard(user)
        assert caught.value.status_code == 403

    def test_feature_permissions_cache_and_guards(self, monkeypatch):
        user = SimpleNamespace(id='u1')
        features = {'faculty': {'novelty': True, 'upload': True}}
        monkeypatch.setattr(auth, 'sb', Client({'system_settings': ([{'value': features}], None)}))
        assert auth.get_role_features() == features
        monkeypatch.setattr(auth, 'sb', Client({'system_settings': ([], RuntimeError('offline'))}))
        assert auth.get_role_features() == features
        auth.invalidate_features_cache()
        assert auth.get_role_features() == {}

        monkeypatch.setattr(auth, 'get_user_role', lambda _uid: 'faculty')
        monkeypatch.setattr(auth, 'get_role_features', lambda: features)
        assert auth.require_novelty_access(user) is user
        assert auth.require_upload_access(user) is user
        monkeypatch.setattr(auth, 'get_role_features', lambda: {})
        with pytest.raises(HTTPException): auth.require_novelty_access(user)
        with pytest.raises(HTTPException): auth.require_upload_access(user)

        monkeypatch.setattr(auth, 'get_user_role', lambda _uid: 'admin')
        assert auth.require_novelty_access(user) is user
        assert auth.require_upload_access(user) is user


class TestLocalTokenVerification:
    """Supabase ES256 access tokens are verified against the published key set
    instead of a per-request round trip to Supabase Auth (2026-11-24: stalled
    TLS handshakes held the dashboard on skeletons for 10-15 s)."""

    KID = 'unit-test-kid'

    @pytest.fixture(autouse=True)
    def keys(self, monkeypatch):
        from cryptography.hazmat.primitives.asymmetric import ec

        private_key = ec.generate_private_key(ec.SECP256R1())
        jwk = auth.jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
        jwk.update({'kid': self.KID, 'alg': 'ES256', 'use': 'sig'})
        downloads = []

        def download():
            downloads.append(1)
            return {self.KID: jwk}

        monkeypatch.setattr(auth, '_download_jwks', download)
        monkeypatch.setattr(auth, '_jwks_state', {'keys': {}, 'fetched_at': 0.0, 'refreshing': False})
        # Any fall-through to Supabase Auth is a failure of this path.
        monkeypatch.setattr(auth, 'sb', NetworkForbidden({'profiles': ([{'status': 'approved'}], None)}))
        self.private_key = private_key
        self.downloads = downloads
        return jwk

    def token(self, kid=None, drop=(), **overrides):
        claims = {
            'sub': 'u1', 'aud': 'authenticated', 'role': 'authenticated', 'aal': 'aal1',
            'email': 'student@example.test', 'exp': int(time.time()) + 3600,
        }
        claims.update(overrides)
        for name in drop:
            claims.pop(name, None)
        return auth.jwt.encode(claims, self.private_key, algorithm='ES256', headers={'kid': kid or self.KID})

    def credentials(self, token):
        return HTTPAuthorizationCredentials(scheme='Bearer', credentials=token)

    def test_a_valid_token_is_verified_without_calling_supabase_auth(self):
        user = auth.get_current_user(self.credentials(self.token()))
        assert user.id == 'u1'
        assert user.email == 'student@example.test'
        assert auth.get_optional_user(self.credentials(self.token())).id == 'u1'
        # One key download serves every later request.
        assert len(self.downloads) == 1

    @pytest.mark.parametrize('variant', [
        {'exp': int(time.time()) - 120},
        {'aud': 'anon'},
        {'drop': ('sub',)},
        {'drop': ('exp',)},
    ])
    def test_expired_wrong_audience_or_incomplete_tokens_are_401(self, variant):
        with pytest.raises(HTTPException) as caught:
            auth.get_current_user(self.credentials(self.token(**variant)))
        assert caught.value.status_code == 401

    def test_a_token_signed_by_another_key_is_401(self):
        from cryptography.hazmat.primitives.asymmetric import ec

        forger = ec.generate_private_key(ec.SECP256R1())
        forged = auth.jwt.encode(
            {'sub': 'u1', 'aud': 'authenticated', 'exp': int(time.time()) + 3600},
            forger, algorithm='ES256', headers={'kid': self.KID},
        )
        with pytest.raises(HTTPException) as caught:
            auth.get_current_user(self.credentials(forged))
        assert caught.value.status_code == 401

    def test_unknown_key_ids_refetch_at_most_once_per_window(self):
        assert auth.get_current_user(self.credentials(self.token())).id == 'u1'
        stranger = self.token(kid='rotated-away')
        for _ in range(3):
            with pytest.raises(HTTPException) as caught:
                auth.get_current_user(self.credentials(stranger))
            assert caught.value.status_code == 401
        # Keys were fetched for the first token only: the cache is fresh, so
        # random key ids cannot turn into a stream of downloads.
        assert len(self.downloads) == 1

    def test_a_stale_key_set_is_served_while_it_refreshes_in_the_background(self, monkeypatch):
        auth.get_current_user(self.credentials(self.token()))
        refreshes = []
        monkeypatch.setattr(auth, '_refresh_jwks_in_background', lambda: refreshes.append(1))
        auth._jwks_state['fetched_at'] -= auth._JWKS_REFRESH_SECONDS + 1
        assert auth.get_current_user(self.credentials(self.token())).id == 'u1'
        assert refreshes == [1]
        assert len(self.downloads) == 1

    def test_unreachable_key_set_with_nothing_cached_is_503(self, monkeypatch):
        import httpx

        def unreachable():
            raise httpx.ConnectTimeout('timed out')

        monkeypatch.setattr(auth, '_download_jwks', unreachable)
        with pytest.raises(HTTPException) as caught:
            auth.get_current_user(self.credentials(self.token()))
        assert caught.value.status_code == 503
        assert caught.value.detail == auth.AUTH_UNAVAILABLE_DETAIL

    def test_a_pending_account_is_still_refused_with_a_valid_token(self, monkeypatch):
        monkeypatch.setattr(auth, 'sb', NetworkForbidden({'profiles': ([{'status': 'pending'}], None)}))
        with pytest.raises(HTTPException) as caught:
            auth.get_current_user(self.credentials(self.token()))
        assert caught.value.status_code == 403

    def test_legacy_hs256_tokens_still_go_to_supabase_without_a_secret(self, monkeypatch):
        monkeypatch.setattr(auth.settings, 'supabase_jwt_secret', '')
        legacy = auth.jwt.encode(
            {'sub': 'u1', 'aud': 'authenticated', 'exp': int(time.time()) + 3600},
            'legacy-secret-for-unit-tests-at-least-32-bytes', algorithm='HS256',
        )
        assert auth._verify_token_locally(legacy) is None
        assert auth._verify_token_locally('not-a-jwt') is None


class NetworkForbidden(Client):
    def get_user(self, _token):
        raise AssertionError('Supabase Auth must not be called for a locally verifiable token')


class TestApprovedAccountCache:
    def test_an_approval_is_reused_briefly_and_cleared_by_invalidation(self, monkeypatch):
        reads = []

        class CountingQuery(Query):
            def execute(self):
                reads.append(1)
                return SimpleNamespace(data=[{'status': 'approved'}])

        class Counting(Client):
            def table(self, _name): return CountingQuery()

        monkeypatch.setattr(auth, 'sb', Counting())
        auth._ensure_approved_account('u1')
        auth._ensure_approved_account('u1')
        assert len(reads) == 1
        auth.invalidate_role_cache('u1')
        auth._ensure_approved_account('u1')
        assert len(reads) == 2

    def test_pending_is_never_cached_so_approval_applies_at_once(self, monkeypatch):
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([{'status': 'pending'}], None)}))
        with pytest.raises(HTTPException):
            auth._ensure_approved_account('u2')
        assert 'u2' not in auth._APPROVED_CACHE
        monkeypatch.setattr(auth, 'sb', Client({'profiles': ([{'status': 'approved'}], None)}))
        auth._ensure_approved_account('u2')
        assert 'u2' in auth._APPROVED_CACHE
