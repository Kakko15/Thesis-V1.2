"""Rate-limit bucket keying: verified user id when possible, else client IP."""

import json

import jwt as pyjwt
from cryptography.hazmat.primitives.asymmetric import ec
from starlette.requests import Request

from config import settings
from dependencies import auth
from services.rate_limiting import ip_rate_limit_key, rate_limit_key

SECRET = 'unit-test-jwt-secret-at-least-32-bytes'
WRONG_SECRET = 'wrong-unit-test-secret-at-least-32-bytes'
IP = '203.0.113.7'


def make_request(token=None, ip=IP, guest_id=None, path='/chat') -> Request:
    headers = []
    if token is not None:
        headers.append((b'authorization', f'Bearer {token}'.encode()))
    if guest_id is not None:
        headers.append((b'x-guest-id', guest_id.encode()))
    return Request({
        'type': 'http',
        'method': 'GET',
        'path': path,
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

    def test_rotating_guest_ids_mints_no_new_bucket_outside_guest_chat(self):
        # 2026-11-25 review: X-Guest-ID used to key every limit, so a caller
        # rotating it escaped the public, upload and scan limits entirely.
        for path in ('/analytics/summary', '/duplication/scan', '/upload/paper', '/ready'):
            keys = {rate_limit_key(make_request(guest_id=f'guest-browser-{n:04d}', path=path)) for n in range(5)}
            assert keys == {f'ip:{IP}'}

    def test_expired_but_genuine_token_still_names_its_bucket(self, monkeypatch):
        monkeypatch.setattr(settings, 'supabase_jwt_secret', SECRET)
        token = pyjwt.encode({'sub': 'user-1', 'aud': 'authenticated', 'exp': 1}, SECRET, algorithm='HS256')
        assert rate_limit_key(make_request(token)) == 'user:user-1'


class TestAsymmetricTokens:
    """This project signs access tokens with ES256, not a shared secret."""

    def _es256(self, monkeypatch, kid='key-1'):
        private_key = ec.generate_private_key(ec.SECP256R1())
        jwk = json.loads(pyjwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key()))
        jwk['kid'] = kid
        monkeypatch.setitem(auth._jwks_state, 'keys', {kid: jwk})
        monkeypatch.setattr(settings, 'supabase_jwt_secret', '')
        return private_key

    def test_es256_token_keys_by_user_without_a_shared_secret(self, monkeypatch):
        private_key = self._es256(monkeypatch)
        token = pyjwt.encode(
            {'sub': 'user-9', 'aud': 'authenticated'}, private_key, algorithm='ES256', headers={'kid': 'key-1'},
        )
        assert rate_limit_key(make_request(token, path='/upload/paper')) == 'user:user-9'

    def test_unknown_kid_falls_back_to_ip_without_touching_the_network(self, monkeypatch):
        private_key = self._es256(monkeypatch)

        def no_network():
            raise AssertionError('the rate limiter must never fetch signing keys')

        monkeypatch.setattr(auth, '_download_jwks', no_network)
        token = pyjwt.encode(
            {'sub': 'user-9', 'aud': 'authenticated'}, private_key, algorithm='ES256', headers={'kid': 'rotated'},
        )
        assert rate_limit_key(make_request(token, path='/upload/paper')) == f'ip:{IP}'

    def test_es256_token_signed_by_another_key_is_not_trusted(self, monkeypatch):
        self._es256(monkeypatch)
        attacker = ec.generate_private_key(ec.SECP256R1())
        token = pyjwt.encode(
            {'sub': 'victim', 'aud': 'authenticated'}, attacker, algorithm='ES256', headers={'kid': 'key-1'},
        )
        assert rate_limit_key(make_request(token, path='/upload/paper')) == f'ip:{IP}'

    def test_algorithm_mismatch_with_the_cached_key_is_rejected(self, monkeypatch):
        self._es256(monkeypatch)
        token = pyjwt.encode({'sub': 'victim', 'aud': 'authenticated'}, 'x' * 32, algorithm='HS256',
                             headers={'kid': 'key-1'})
        assert rate_limit_key(make_request(token)) == f'ip:{IP}'
        forged = pyjwt.encode({'sub': 'victim', 'aud': 'authenticated'}, ec.generate_private_key(ec.SECP256R1()),
                              algorithm='ES256', headers={'kid': 'key-1'}).rsplit('.', 1)[0]
        assert auth.cached_token_subject(forged + '.AAAA') is None
        rsa_header = pyjwt.encode({'sub': 'victim'}, 'x' * 32, algorithm='HS256')
        assert auth.cached_token_subject(rsa_header) is None
