"""Functional Suitability tests — API surface, validation, and access control."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from main import app
from models import CCSICT_TRACKS, ChatRequest


@pytest.fixture(scope='module')
def client():
    return TestClient(app, raise_server_exceptions=False)


class TestHealth:
    @staticmethod
    def _available_database(monkeypatch):
        class Query:
            def select(self, *_args): return self
            def limit(self, *_args): return self
            def execute(self): return SimpleNamespace(data=[])

        class Client:
            def table(self, _name): return Query()

        monkeypatch.setattr('dependencies.auth.sb', Client())

    def test_health_endpoint_responds(self, client, monkeypatch):
        self._available_database(monkeypatch)
        res = client.get('/health')
        assert res.status_code == 200
        body = res.json()
        assert body['status'] in ('ok', 'degraded')
        assert body['checks']['api'] == 'ok'

    def test_readiness_endpoint_has_machine_readable_state(self, client, monkeypatch):
        self._available_database(monkeypatch)
        res = client.get('/ready')
        assert res.status_code in (200, 503)
        body = res.json()
        assert body['status'] in ('ready', 'not_ready')
        assert set(body['checks']) == {'database', 'ai_configuration', 'rate_limit_store'}

    def test_readiness_returns_503_when_database_is_unavailable(self, client, monkeypatch):
        class Client:
            def table(self, _name):
                raise RuntimeError('offline')

        monkeypatch.setattr('dependencies.auth.sb', Client())
        res = client.get('/ready')
        assert res.status_code == 503
        assert res.json()['checks']['database'] == 'unavailable_or_incompatible'


class TestValidation:
    def test_chat_rejects_empty_question(self, client):
        res = client.post('/chat', json={'question': ''})
        assert res.status_code == 422

    def test_chat_rejects_oversized_question(self, client):
        res = client.post('/chat', json={'question': 'x' * 5000})
        assert res.status_code == 422

    def test_deprecated_client_thresholds_are_ignored(self):
        request = ChatRequest(
            question='Which archived studies used clustering?',
            match_threshold=0.0,
            match_count=20,
        )
        assert request.model_dump() == {
            'question': 'Which archived studies used clustering?',
            'session_id': None,
            'department_filter': None,
            'guest_history': [],
            'guest_source_ids': [],
        }

    def test_guest_history_is_bounded_and_each_question_is_validated(self):
        valid = ChatRequest(question='What about its findings?', guest_history=['Prior question'])
        assert valid.guest_history == ['Prior question']
        with pytest.raises(Exception):
            ChatRequest(question='Follow-up', guest_history=['q'] * 6)
        with pytest.raises(Exception):
            ChatRequest(question='Follow-up', guest_history=['x' * 4001])
        with pytest.raises(Exception):
            ChatRequest(question='Follow-up', guest_source_ids=['id'] * 6)


class TestAccessControl:
    """Role-guarded endpoints must reject unauthenticated requests."""

    @pytest.mark.parametrize('method,path', [
        ('get', '/papers'),
        ('get', '/sessions'),
        ('get', '/duplication/history'),
        ('get', '/analytics/overview'),
        ('get', '/analytics/users'),
        ('get', '/analytics/activity'),
        ('get', '/upload/status/some-job'),
    ])
    def test_protected_endpoints_require_auth(self, client, method, path):
        res = getattr(client, method)(path)
        assert res.status_code in (401, 403)

    def test_paper_delete_requires_auth(self, client):
        res = client.delete('/papers/some-id')
        assert res.status_code in (401, 403)


class TestPublicSurface:
    def test_tracks_endpoint_is_public(self, client):
        res = client.get('/upload/tracks')
        assert res.status_code == 200
        assert res.json()['tracks'] == CCSICT_TRACKS

    def test_ccsict_tracks_match_paper(self):
        # Section 3.2.1: representation across academic tracks
        for track in ('Data Mining', 'Web Development', 'Network Security'):
            assert track in CCSICT_TRACKS
