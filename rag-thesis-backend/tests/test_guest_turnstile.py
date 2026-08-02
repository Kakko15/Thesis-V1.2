"""Guest-chat Turnstile guard: config-gated, fail-closed, guest-session cached."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from config import settings
from main import app
from services import turnstile


def run(coro):
    return asyncio.run(coro)


def fake_request(headers=None, host='203.0.113.10'):
    return SimpleNamespace(
        headers=headers or {},
        client=SimpleNamespace(host=host) if host else None,
    )


@pytest.fixture(autouse=True)
def clean_guard_state(monkeypatch):
    turnstile.reset_guest_verifications()
    monkeypatch.setattr(settings, 'turnstile_secret_key', '')
    yield
    turnstile.reset_guest_verifications()


class TestGuardGating:
    def test_disabled_by_default_lets_guests_through(self):
        assert turnstile.guard_enabled() is False
        run(turnstile.ensure_guest_chat_verification(fake_request(), None))

    def test_authenticated_users_are_never_challenged(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        run(turnstile.ensure_guest_chat_verification(
            fake_request(), SimpleNamespace(id='user-1'),
        ))

    def test_guest_without_token_is_asked_to_verify(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        with pytest.raises(HTTPException) as excinfo:
            run(turnstile.ensure_guest_chat_verification(
                fake_request({'X-Guest-ID': 'guest-1'}), None,
            ))
        assert excinfo.value.status_code == 403
        assert excinfo.value.headers[turnstile.VERIFICATION_HEADER] == 'required'

    def test_guest_without_guest_id_is_rejected_even_with_token(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        with pytest.raises(HTTPException) as excinfo:
            run(turnstile.ensure_guest_chat_verification(
                fake_request({'X-Turnstile-Token': 'tok'}), None,
            ))
        assert excinfo.value.status_code == 403


class TestVerificationFlow:
    def test_valid_token_verifies_and_caches_the_guest(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')

        async def accept(token, remote_ip):
            assert token == 'tok'
            assert remote_ip == '203.0.113.10'
            return True

        monkeypatch.setattr(turnstile, 'verify_turnstile_token', accept)
        run(turnstile.ensure_guest_chat_verification(
            fake_request({'X-Guest-ID': 'guest-1', 'X-Turnstile-Token': 'tok'}), None,
        ))
        # Second message: no token needed while the cache entry is fresh.
        run(turnstile.ensure_guest_chat_verification(
            fake_request({'X-Guest-ID': 'guest-1'}), None,
        ))

    def test_rejected_token_fails_with_the_failed_signal(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')

        async def reject(_token, _remote_ip):
            return False

        monkeypatch.setattr(turnstile, 'verify_turnstile_token', reject)
        with pytest.raises(HTTPException) as excinfo:
            run(turnstile.ensure_guest_chat_verification(
                fake_request({'X-Guest-ID': 'guest-1', 'X-Turnstile-Token': 'bad'}), None,
            ))
        assert excinfo.value.status_code == 403
        assert excinfo.value.headers[turnstile.VERIFICATION_HEADER] == 'failed'
        assert not turnstile.is_guest_verified('guest-1')

    def test_verification_expires_after_the_configured_ttl(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        clock = {'now': 1000.0}
        monkeypatch.setattr(turnstile.time, 'monotonic', lambda: clock['now'])
        turnstile.mark_guest_verified('guest-1')
        assert turnstile.is_guest_verified('guest-1')
        clock['now'] += settings.turnstile_guest_ttl_seconds + 1
        assert not turnstile.is_guest_verified('guest-1')


class TestCloudflareCall:
    def test_network_failure_fails_closed(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')

        class FailingClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                raise httpx.ConnectError('unreachable')

        monkeypatch.setattr(turnstile.httpx, 'AsyncClient', FailingClient)
        assert run(turnstile.verify_turnstile_token('tok', None)) is False

    def test_token_from_another_widget_action_is_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        monkeypatch.setattr(settings, 'turnstile_expected_action', 'guest_chat')
        assert turnstile._token_context_is_expected(
            {'success': True, 'action': 'signin'},
        ) is False
        assert turnstile._token_context_is_expected(
            {'success': True, 'action': 'guest_chat'},
        ) is True

    def test_token_solved_on_another_hostname_is_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        monkeypatch.setattr(settings, 'turnstile_expected_action', 'guest_chat')
        monkeypatch.setattr(settings, 'turnstile_allowed_hostnames', 'thesis.isu.edu.ph')
        assert turnstile._token_context_is_expected(
            {'success': True, 'action': 'guest_chat', 'hostname': 'attacker.example'},
        ) is False
        # Hostname comparison is case-insensitive.
        assert turnstile._token_context_is_expected(
            {'success': True, 'action': 'guest_chat', 'hostname': 'THESIS.ISU.EDU.PH'},
        ) is True

    def test_configured_checks_reject_missing_context_fields(self, monkeypatch):
        """A configured check is enforced; a missing field must not slip past it."""
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        monkeypatch.setattr(settings, 'turnstile_expected_action', 'guest_chat')
        monkeypatch.setattr(settings, 'turnstile_allowed_hostnames', 'thesis.isu.edu.ph')
        assert turnstile._token_context_is_expected({'success': True}) is False
        assert turnstile._token_context_is_expected(
            {'success': True, 'action': 'guest_chat'},
        ) is False  # hostname allowlist configured but hostname absent
        assert turnstile._token_context_is_expected(
            {'success': True, 'action': 'guest_chat', 'hostname': 'thesis.isu.edu.ph'},
        ) is True

    def test_cleared_settings_disable_each_check_for_local_development(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        monkeypatch.setattr(settings, 'turnstile_expected_action', '')
        monkeypatch.setattr(settings, 'turnstile_allowed_hostnames', '')
        assert turnstile._token_context_is_expected({'success': True}) is True

    def test_valid_token_with_wrong_action_fails_the_full_verification(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        monkeypatch.setattr(settings, 'turnstile_expected_action', 'guest_chat')

        class SigninTokenClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, data=None):
                request = httpx.Request('POST', url)
                return httpx.Response(
                    200,
                    json={'success': True, 'action': 'signin', 'hostname': 'thesis.isu.edu.ph'},
                    request=request,
                )

        monkeypatch.setattr(turnstile.httpx, 'AsyncClient', SigninTokenClient)
        assert run(turnstile.verify_turnstile_token('tok', None)) is False

    def test_success_flag_from_cloudflare_is_honored(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        captured = {}

        class OkClient:
            def __init__(self, **kwargs):
                captured['timeout'] = kwargs.get('timeout')

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, data=None):
                captured['url'] = url
                captured['data'] = data
                request = httpx.Request('POST', url)
                return httpx.Response(
                    200,
                    json={'success': True, 'action': 'guest_chat'},
                    request=request,
                )

        monkeypatch.setattr(turnstile.httpx, 'AsyncClient', OkClient)
        assert run(turnstile.verify_turnstile_token('tok', '198.51.100.7')) is True
        assert captured['url'] == turnstile.VERIFY_URL
        assert captured['data']['response'] == 'tok'
        assert captured['data']['remoteip'] == '198.51.100.7'
        assert captured['data']['secret'] == 'secret'
        assert captured['timeout'] == settings.turnstile_verify_timeout_seconds


class TestChatRouteIntegration:
    def test_guarded_guest_chat_returns_403_before_any_processing(self, monkeypatch):
        monkeypatch.setattr(settings, 'turnstile_secret_key', 'secret')
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            '/chat',
            json={'question': 'What thesis studies exist?'},
            headers={'X-Guest-ID': 'guest-e2e'},
        )
        assert response.status_code == 403
        assert response.headers[turnstile.VERIFICATION_HEADER] == 'required'

    def test_unguarded_guest_chat_is_unchanged(self, monkeypatch):
        # Secret empty (default): the request proceeds into the normal chat
        # flow — the greeting fast path answers without any external service.
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            '/chat',
            json={'question': 'Hello'},
            headers={'X-Guest-ID': 'guest-e2e'},
        )
        assert response.status_code == 200
        assert 'IskAI' in response.json()['answer']
