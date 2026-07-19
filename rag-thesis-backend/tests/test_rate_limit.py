"""Rate-limit bucket keying: verified user id when possible, else client IP."""

import jwt as pyjwt
from starlette.requests import Request

from config import settings
from services.rate_limiting import ip_rate_limit_key, rate_limit_key

SECRET = 'unit-test-jwt-secret-at-least-32-bytes'
WRONG_SECRET = 'wrong-unit-test-secret-at-least-32-bytes'
IP = '203.0.113.7'


def make_request(token=None, ip=IP, guest_id=None) -> Request:
    headers = []
    if token is not None:
        headers.append((b'authorization', f'Bearer {token}'.encode()))
    if guest_id is not None:
        headers.append((b'x-guest-id', guest_id.encode()))
    return Request({
        'type': 'http',
        'method': 'GET',
        'path': '/chat',
        'headers': headers,
        'client': (ip, 51234),
    })


class TestRateLimitKey:
    def test_ip_fallback_when_secret_not_configured(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', '')
        token = pyjwt.encode({'sub': 'user-1', 'aud': 'authenticated'}, SECRET, algorithm='HS256')
        assert rate_limit_key(make_request(token)) == f'ip:{IP}'

    def test_verified_token_keys_by_user_id(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode({'sub': 'user-1', 'aud': 'authenticated'}, SECRET, algorithm='HS256')
        assert rate_limit_key(make_request(token)) == 'user:user-1'

    def test_forged_signature_falls_back_to_ip(self, monkeypatch):
        """A forged token must NOT mint a fresh rate-limit bucket."""
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode(
            {'sub': 'attacker', 'aud': 'authenticated'},
            WRONG_SECRET,
            algorithm='HS256',
        )
        assert rate_limit_key(make_request(token)) == f'ip:{IP}'

    def test_wrong_audience_falls_back_to_ip(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode({'sub': 'user-1', 'aud': 'other'}, SECRET, algorithm='HS256')
        assert rate_limit_key(make_request(token)) == f'ip:{IP}'

    def test_garbage_token_falls_back_to_ip(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        assert rate_limit_key(make_request('not-a-jwt')) == f'ip:{IP}'

    def test_anonymous_request_keys_by_ip(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        assert rate_limit_key(make_request(None)) == f'ip:{IP}'

    def test_guest_ids_are_ip_bound_and_broad_ip_limit_cannot_rotate(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        first = rate_limit_key(make_request(guest_id='guest-browser-0001'))
        second = rate_limit_key(make_request(guest_id='guest-browser-0002'))
        assert first.startswith('guest:') and first != second
        assert ip_rate_limit_key(make_request(guest_id='guest-browser-0001')) == f'ip:{IP}'
        assert ip_rate_limit_key(make_request(guest_id='guest-browser-0002')) == f'ip:{IP}'
