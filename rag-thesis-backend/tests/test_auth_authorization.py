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
def clear_caches():
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
        monkeypatch.setattr(auth, '_token_aal', lambda _credentials: 'aal1')
        with pytest.raises(HTTPException) as mfa_required:
            auth.require_admin(user, credentials)
        assert mfa_required.value.status_code == 403
        monkeypatch.setattr(auth, '_token_aal', lambda _credentials: 'aal2')
        assert auth.require_admin(user, credentials) is user

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
