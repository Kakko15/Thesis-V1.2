"""Functional Suitability tests — API surface, validation, and access control."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from config import settings
from main import app
from models import CATALOG_OUTAGE_TRACKS, CCSICT_TRACKS, ChatRequest, DuplicationAlert


@pytest.fixture(scope='module')
def client():
    return TestClient(app, raise_server_exceptions=False)


def test_duplication_alert_never_serializes_archived_text():
    alert = DuplicationAlert(**{
        'flagged': True,
        'similarity': 91.2,
        'threshold': 85.0,
        'matched_paper': {'id': 'paper-1', 'title': 'Metadata only'},
        'matched_abstract': 'private abstract',
        'matched_excerpt': 'private archived chunk',
        'summary': 'Safe generated summary.',
    })

    public = alert.model_dump()
    assert 'matched_abstract' not in public
    assert 'matched_excerpt' not in public
    assert public['summary'] == 'Safe generated summary.'


def test_cors_exposes_the_headers_the_client_reads():
    """Retry-After and the guest-verification signal are not CORS-safelisted.

    A cross-origin browser hides any response header not listed here, so the
    batch novelty scan would never see how long a 503 asked it to wait.
    """
    origin = settings.cors_origin_list[0]
    response = TestClient(app).get('/health', headers={'Origin': origin})
    exposed = {value.strip().lower() for value in response.headers['access-control-expose-headers'].split(',')}
    assert {'retry-after', 'x-guest-verification'} <= exposed


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

    def test_health_does_not_re_read_the_schema_on_every_poll(self, client, monkeypatch):
        """Finding 16: `/health` is unauthenticated and ran four `select` calls
        per request, so the global 120/minute default permitted 480 database
        reads a minute per caller. A named 30/minute limit would have broken
        legitimate polling — the frontend polls every 30 s per open tab — so the
        amplification is removed at the source instead."""
        import main

        calls = []
        monkeypatch.setattr(main, '_verify_database_contract', lambda: calls.append(1))
        main.reset_contract_cache()

        for _ in range(5):
            assert client.get('/health').status_code == 200
        assert len(calls) == 1, 'the schema contract should be checked once per window'

    def test_health_recovers_after_the_cache_window(self, client, monkeypatch):
        import main

        calls = []
        monkeypatch.setattr(main, '_verify_database_contract', lambda: calls.append(1))
        monkeypatch.setattr(main, '_CONTRACT_CACHE_TTL_SECONDS', 0)
        main.reset_contract_cache()

        client.get('/health')
        client.get('/health')
        assert len(calls) == 2

    def test_health_reports_degraded_when_the_schema_check_raises(self, client, monkeypatch):
        import main

        def broken():
            raise RuntimeError('relation does not exist')

        monkeypatch.setattr(main, '_verify_database_contract', broken)
        main.reset_contract_cache()
        body = client.get('/health').json()
        assert body['status'] == 'degraded'
        assert body['checks']['database'] == 'unavailable_or_incompatible'

    def test_readiness_still_pays_for_an_exact_answer(self, client, monkeypatch):
        """`/ready` gates whether traffic reaches this instance, so a stale
        `ready` could route requests to a broken process. It must not share the
        health cache."""
        import main

        calls = []
        monkeypatch.setattr(main, '_verify_database_contract', lambda: calls.append(1))
        main.reset_contract_cache()

        client.get('/ready')
        client.get('/ready')
        assert len(calls) == 2

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

    def test_concurrent_health_polls_share_one_cold_check(self, monkeypatch):
        """Several tabs (or the pre-warm plus the first poll) arriving during a
        slow cold check must wait for that one result, not each issue their own
        four reads."""
        import threading
        import time

        import main

        calls = []

        def slow_check():
            calls.append(1)
            time.sleep(0.3)

        monkeypatch.setattr(main, '_verify_database_contract', slow_check)
        main.reset_contract_cache()
        results = []
        threads = [
            threading.Thread(target=lambda: results.append(main._cached_database_contract()))
            for _ in range(5)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
        assert len(calls) == 1
        assert results == [True] * 5

    def test_prewarm_is_a_no_op_when_disabled(self, monkeypatch):
        import main

        calls = []
        monkeypatch.setattr(main, '_verify_database_contract', lambda: calls.append(1))
        monkeypatch.setattr(main.settings, 'health_prewarm_enabled', False)
        main.reset_contract_cache()
        main.start_contract_prewarm()
        assert not calls

    def test_prewarm_fills_the_cache_from_a_daemon_thread(self, monkeypatch):
        """The pre-warm must not delay port binding (daemon thread) and must
        leave the cache warm so the first browser poll does no database work."""
        import threading

        import main

        started = []
        real_thread = threading.Thread

        class RecordingThread(real_thread):
            def start(self):
                started.append(self)
                super().start()

        calls = []
        monkeypatch.setattr(main, '_verify_database_contract', lambda: calls.append(1))
        monkeypatch.setattr(main.settings, 'health_prewarm_enabled', True)
        monkeypatch.setattr(main.threading, 'Thread', RecordingThread)
        main.reset_contract_cache()
        main.start_contract_prewarm()
        assert len(started) == 1
        assert started[0].daemon
        started[0].join(timeout=5)
        assert calls == [1]
        assert main._cached_database_contract() is True
        assert calls == [1], 'the first poll after the pre-warm must hit the cache'

    def test_contract_check_reads_every_required_table(self, monkeypatch):
        import main

        seen = []

        class Query:
            def __init__(self, name): self.name = name
            def select(self, *_args): return self
            def limit(self, *_args): return self
            def execute(self):
                seen.append(self.name)
                return SimpleNamespace(data=[])

        class Client:
            def table(self, name): return Query(name)

        monkeypatch.setattr('dependencies.auth.sb', Client())
        main._verify_database_contract()
        assert sorted(seen) == sorted(
            ['profiles', 'departments', 'papers', 'paper_index_versions'],
        )

    def test_contract_check_raises_when_any_table_is_missing(self, monkeypatch):
        import main

        class Query:
            def __init__(self, name): self.name = name
            def select(self, *_args): return self
            def limit(self, *_args): return self
            def execute(self):
                if self.name == 'paper_index_versions':
                    raise RuntimeError('relation does not exist')
                return SimpleNamespace(data=[])

        class Client:
            def table(self, name): return Query(name)

        monkeypatch.setattr('dependencies.auth.sb', Client())
        with pytest.raises(RuntimeError, match='relation does not exist'):
            main._verify_database_contract()


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
            'thesis_category_filter': None,
            'min_year': None,
            'guest_history': [],
            'guest_source_ids': [],
            'edit_from_turn': None,
            'conversation_replies': [],
        }

    def test_guest_history_is_bounded_and_each_question_is_validated(self):
        valid = ChatRequest(question='What about its findings?', guest_history=['Prior question'])
        assert valid.guest_history == ['Prior question']
        with pytest.raises(Exception):
            ChatRequest(question='Follow-up', guest_history=['q'] * 6)
        with pytest.raises(Exception):
            ChatRequest(question='Follow-up', guest_history=['x' * 4001])
        assert len(ChatRequest(question='Follow-up', guest_source_ids=['id'] * 10).guest_source_ids) == 10
        with pytest.raises(Exception):
            ChatRequest(question='Follow-up', guest_source_ids=['id'] * 11)


class TestAccessControl:
    """Role-guarded endpoints must reject unauthenticated requests."""

    @pytest.mark.parametrize('method,path', [
        ('get', '/papers'),
        ('get', '/sessions'),
        ('get', '/duplication/history'),
        ('delete', '/duplication/history'),
        ('delete', '/duplication/history/some-id'),
        ('get', '/analytics/overview'),
        ('get', '/analytics/users'),
        ('get', '/analytics/activity'),
        ('get', '/upload/status/some-job'),
        ('get', '/upload/jobs?ids=some-job'),
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
        assert res.json()['tracks'] == CATALOG_OUTAGE_TRACKS

    def test_outage_tracks_carry_no_retired_vocabulary(self):
        # Data Mining was retired as a BSCS specialization (20260923 migration).
        assert 'Data Mining' not in CATALOG_OUTAGE_TRACKS

    def test_ccsict_tracks_match_paper(self):
        # Section 3.2.1: representation across academic tracks
        for track in ('Data Mining', 'Web Development', 'Network Security'):
            assert track in CCSICT_TRACKS
