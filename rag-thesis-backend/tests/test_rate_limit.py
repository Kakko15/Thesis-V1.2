"""Rate-limit bucket keying: verified user id when possible, else client IP."""

import jwt as pyjwt
from starlette.requests import Request

from config import settings
from main import rate_limit_key

SECRET = 'unit-test-jwt-secret'
IP = '203.0.113.7'


def make_request(token=None, ip=IP) -> Request:
    headers = []
    if token is not None:
        headers.append((b'authorization', f'Bearer {token}'.encode()))
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
        assert rate_limit_key(make_request(token)) == IP

    def test_verified_token_keys_by_user_id(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode({'sub': 'user-1', 'aud': 'authenticated'}, SECRET, algorithm='HS256')
        assert rate_limit_key(make_request(token)) == 'user:user-1'

    def test_forged_signature_falls_back_to_ip(self, monkeypatch):
        """A forged token must NOT mint a fresh rate-limit bucket."""
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode({'sub': 'attacker', 'aud': 'authenticated'}, 'wrong-secret', algorithm='HS256')
        assert rate_limit_key(make_request(token)) == IP

    def test_wrong_audience_falls_back_to_ip(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode({'sub': 'user-1', 'aud': 'other'}, SECRET, algorithm='HS256')
        assert rate_limit_key(make_request(token)) == IP

    def test_garbage_token_falls_back_to_ip(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        assert rate_limit_key(make_request('not-a-jwt')) == IP

    def test_anonymous_request_keys_by_ip(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        assert rate_limit_key(make_request(None)) == IP
