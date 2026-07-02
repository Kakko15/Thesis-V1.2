"""Functional Suitability tests — API surface, validation, and access control."""

import pytest
from fastapi.testclient import TestClient

from main import app
from models import CCSICT_TRACKS


@pytest.fixture(scope='module')
def client():
    return TestClient(app, raise_server_exceptions=False)


class TestHealth:
    def test_health_endpoint_responds(self, client):
        res = client.get('/health')
        assert res.status_code == 200
        body = res.json()
        assert body['status'] in ('ok', 'degraded')
        assert body['checks']['api'] == 'ok'


class TestValidation:
    def test_chat_rejects_empty_question(self, client):
        res = client.post('/chat', json={'question': ''})
        assert res.status_code == 422

    def test_chat_rejects_oversized_question(self, client):
        res = client.post('/chat', json={'question': 'x' * 5000})
        assert res.status_code == 422

    def test_chat_rejects_invalid_threshold(self, client):
        res = client.post('/chat', json={'question': 'ok', 'match_threshold': 3.0})
        assert res.status_code == 422


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
