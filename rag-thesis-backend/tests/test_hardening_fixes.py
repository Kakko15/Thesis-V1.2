"""Regression tests for the Phase A hardening batch.

Each class pins one defect from SYSTEM_IMPROVEMENTS_AND_BUGS_2026-08-03.md so it
cannot silently return. The defect id is named in each docstring.
"""

import inspect
import time
import warnings
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

import main
from dependencies import auth
from routers import analytics, catalog, departments, papers
from routers import settings as settings_router
from services.network_retry import is_transient_network_error


def public_request(path='/'):
    return Request({
        'type': 'http', 'method': 'GET', 'path': path, 'headers': [],
        'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


class RecordingQuery:
    def __init__(self, log, table, data):
        self._log = log
        self._table = table
        self._data = data
        self._filters = []

    def select(self, *args):
        self._log.append((self._table, 'select', args))
        return self

    def insert(self, payload):
        self._log.append((self._table, 'insert', payload))
        return self

    def update(self, payload):
        self._log.append((self._table, 'update', payload))
        return self

    def in_(self, column, values):
        self._filters.append((column, tuple(values)))
        self._log.append((self._table, 'in_', (column, tuple(values))))
        return self

    def eq(self, *args):
        self._log.append((self._table, 'eq', args))
        return self

    def order(self, *args, **kwargs): return self
    def limit(self, *args): return self
    def execute(self): return SimpleNamespace(data=self._data)


class RecordingClient:
    def __init__(self, tables):
        self.tables = tables
        self.log = []

    def table(self, name):
        data = self.tables.get(name, [])
        if isinstance(data, list) and data and isinstance(data[0], list):
            data = data.pop(0)
        return RecordingQuery(self.log, name, data)

    def operations(self, table, operation):
        return [entry for entry in self.log if entry[0] == table and entry[1] == operation]


class TestLifespanReplacesDeprecatedEventHooks:
    """B6 — @app.on_event is deprecated since FastAPI 0.93 and slated for removal."""

    def test_no_deprecated_event_handlers_are_registered(self):
        assert main.app.router.on_startup == []
        assert main.app.router.on_shutdown == []
        assert main.app.router.lifespan_context is not None

    def test_lifespan_owns_the_operations_monitor_lifecycle(self, monkeypatch):
        monkeypatch.setattr(main.settings, 'operations_monitor_enabled', True)
        monkeypatch.setattr(main, '_operations_monitor', lambda: None)
        main._OPERATIONS_STATE['thread'] = None
        with TestClient(main.app):
            assert main._OPERATIONS_STATE['thread'] is not None
        # The stop half runs on exit, which two independent hooks could not
        # guarantee if later startup work raised.
        assert main._OPERATIONS_STATE['thread'] is None

    def test_application_start_emits_no_deprecation_warning(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            with TestClient(main.app):
                pass
        offenders = [
            str(item.message) for item in caught
            if issubclass(item.category, DeprecationWarning)
            and 'on_event' in str(item.message)
        ]
        assert offenders == []


class TestSettingsUseSupportedPydanticConfig:
    """Discovered while fixing B6: class-based Config is removed in Pydantic V3."""

    def test_importing_config_emits_no_pydantic_deprecation(self):
        import importlib
        import config as config_module
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            importlib.reload(config_module)
        offenders = [
            str(item.message) for item in caught
            if 'class-based `config`' in str(item.message)
        ]
        assert offenders == []

    def test_env_loading_contract_is_unchanged(self):
        from config import Settings
        assert Settings.model_config.get('env_file') == '.env'
        assert Settings.model_config.get('extra') == 'ignore'

    def test_frozen_rag_contract_is_untouched(self):
        from config import settings
        assert (settings.chunk_size_tokens, settings.chunk_overlap_tokens) == (800, 100)
        assert settings.retrieval_threshold == 0.30
        assert settings.retrieval_match_count == 5
        assert settings.duplication_threshold == 0.85
        assert settings.embedding_dimensions == 768


class TestRoleCacheIsBounded:
    """B11 — entries were added per user id and never removed if not read again."""

    @pytest.fixture(autouse=True)
    def clean_cache(self):
        auth.invalidate_role_cache()
        yield
        auth.invalidate_role_cache()

    def test_expired_entries_are_pruned_on_write(self):
        auth._ROLE_CACHE['stale'] = ('admin', time.monotonic() - 1)
        auth._prune_role_cache(time.monotonic())
        assert 'stale' not in auth._ROLE_CACHE

    def test_the_cache_never_exceeds_its_ceiling(self, monkeypatch):
        monkeypatch.setattr(auth, '_ROLE_CACHE_MAX_ENTRIES', 8)
        future = time.monotonic() + 3600
        for index in range(50):
            with auth._role_cache_lock:
                auth._prune_role_cache(time.monotonic())
                auth._ROLE_CACHE[f'user-{index}'] = ('student', future)
        assert len(auth._ROLE_CACHE) <= 8
        # Oldest-first eviction, so the most recent identities survive.
        assert 'user-49' in auth._ROLE_CACHE
        assert 'user-0' not in auth._ROLE_CACHE

    def test_unexpired_entries_survive_a_prune(self):
        future = time.monotonic() + 3600
        auth._ROLE_CACHE['fresh'] = ('superadmin', future)
        auth._prune_role_cache(time.monotonic())
        assert auth._ROLE_CACHE['fresh'] == ('superadmin', future)


class TestFeatureSettingsGetIsReadOnly:
    """B12 — a GET inserted the row, so any student's first load wrote settings."""

    def test_missing_row_returns_defaults_without_writing(self, monkeypatch):
        client = RecordingClient({'system_settings': []})
        monkeypatch.setattr(settings_router, 'sb', client)

        result = settings_router.get_features(SimpleNamespace(id='student-1'))

        assert result == settings_router.DEFAULT_FEATURES
        assert client.operations('system_settings', 'insert') == []
        assert client.operations('system_settings', 'update') == []

    def test_present_row_is_returned_verbatim(self, monkeypatch):
        stored = {'student': {'chat': False, 'archive': True, 'novelty': False, 'upload': False}}
        client = RecordingClient({'system_settings': [{'value': stored}]})
        monkeypatch.setattr(settings_router, 'sb', client)

        assert settings_router.get_features(SimpleNamespace(id='s1')) == stored
        assert client.operations('system_settings', 'insert') == []


class TestArchiveListingDoesNotReadEveryProfile:
    """B9 — the uploader-name lookup read the entire profiles table per request."""

    def test_the_profile_lookup_is_restricted_to_present_uploaders(self, monkeypatch):
        client = RecordingClient({
            'profiles': [
                [{'role': 'admin', 'department': 'CCSICT'}],
                [{'id': 'u1', 'full_name': 'Ana Cruz', 'email': 'ana@isu.edu.ph'}],
            ],
            'papers': [[
                {'id': 'p1', 'title': 'A', 'uploaded_by': 'u1', 'created_at': 'x'},
                {'id': 'p2', 'title': 'B', 'uploaded_by': 'u1', 'created_at': 'x'},
                {'id': 'p3', 'title': 'C', 'uploaded_by': None, 'created_at': 'x'},
            ]],
        })
        monkeypatch.setattr(papers, 'sb', client)

        result = papers.list_papers(SimpleNamespace(id='admin'))

        filters = [entry[2] for entry in client.operations('profiles', 'in_')]
        assert filters == [('id', ('u1',))], 'the profile read must be scoped to uploaders'
        assert result[0]['uploader_name'] == 'Ana Cruz'
        assert result[2]['uploader_name'] == 'Unknown / System'

    def test_no_profile_query_runs_when_no_paper_has_an_uploader(self, monkeypatch):
        client = RecordingClient({
            'profiles': [[{'role': 'admin', 'department': 'CCSICT'}]],
            'papers': [[{'id': 'p1', 'title': 'A', 'uploaded_by': None, 'created_at': 'x'}]],
        })
        monkeypatch.setattr(papers, 'sb', client)

        result = papers.list_papers(SimpleNamespace(id='admin'))

        assert client.operations('profiles', 'in_') == []
        assert result[0]['uploader_name'] == 'Unknown / System'


class TestCatalogInsertsFailCleanly:
    """B18 — `.execute().data[0]` raised instead of reporting a usable error."""

    def test_duplicate_program_code_is_a_conflict_not_a_crash(self, monkeypatch):
        class Client:
            def table(self, name):
                if name == 'departments':
                    return RecordingQuery([], name, [{'id': 'd1'}])
                raise RuntimeError('duplicate key value violates unique constraint')
        monkeypatch.setattr(catalog, 'sb', Client())

        with pytest.raises(HTTPException) as caught:
            catalog.create_program(
                SimpleNamespace(parent_id='d1', code='BSCS', name='Computer Science'),
                SimpleNamespace(id='root'),
            )
        assert caught.value.status_code == 409
        assert 'BSCS' in caught.value.detail

    def test_missing_representation_is_reported_as_a_gateway_error(self, monkeypatch):
        class Client:
            def table(self, name):
                # The parent program exists; PostgREST just returns no
                # representation for the insert.
                data = [{'id': 'p1'}] if name == 'programs' else []
                return RecordingQuery([], name, data)
        monkeypatch.setattr(catalog, 'sb', Client())

        with pytest.raises(HTTPException) as caught:
            catalog.create_specialization(
                SimpleNamespace(parent_id='p1', code='DM', name='Data Mining'),
                SimpleNamespace(id='root'),
            )
        assert caught.value.status_code == 502

    def test_department_write_without_representation_is_not_an_indexerror(self, monkeypatch):
        monkeypatch.setattr(departments, 'sb', RecordingClient({'departments': [[], []]}))
        from models import DepartmentCreate
        with pytest.raises(HTTPException) as caught:
            departments.create_department(
                DepartmentCreate(name='CAS', track_label='Track', tracks=[]),
                SimpleNamespace(id='root'),
            )
        assert caught.value.status_code == 502


class TestUnauthenticatedReadsAreRateLimited:
    """B19 — the public summary and catalog reads carried no explicit limit."""

    @pytest.mark.parametrize('handler', [
        analytics.public_summary,
        catalog.list_catalog,
        catalog.list_catalog_legacy,
        departments.list_departments,
    ])
    def test_the_endpoint_declares_a_limit(self, handler):
        # slowapi records the decorator on the wrapper, and the wrapper requires
        # a real Request — both are absent on an unlimited endpoint.
        assert hasattr(handler, '__wrapped__'), f'{handler.__name__} is not rate limited'
        assert 'request' in inspect.signature(inspect.unwrap(handler)).parameters

    def test_the_public_limit_is_stricter_than_the_global_default(self):
        from config import settings
        assert settings.rate_limit_public == '30/minute'


class TestTransientDetectionIsNotSubstringMatching:
    """N6 — a bare '429'/'503' anywhere in a message forced a pointless retry."""

    @pytest.mark.parametrize('error', [
        RuntimeError('HTTP 503 Service Unavailable'),
        RuntimeError('status_code: 429'),
        RuntimeError('502 Bad Gateway'),
        RuntimeError('504 gateway timeout'),
        RuntimeError('code=500 internal server error'),
        RuntimeError('connection reset by peer'),
        TimeoutError('timed out'),
    ])
    def test_genuine_transient_failures_still_retry(self, error):
        assert is_transient_network_error(error)

    @pytest.mark.parametrize('error', [
        RuntimeError('deleted 503 stale rows'),
        RuntimeError('chunk 429 exceeded the token limit'),
        RuntimeError('paper 502ab3f4 not found'),
        RuntimeError('embedding dimension 504 does not match 768'),
        ValueError('Chunk 429 exceeds the 800-token limit'),
    ])
    def test_deterministic_failures_are_not_retried(self, error):
        assert not is_transient_network_error(error)

    def test_a_status_attribute_is_honoured(self):
        # httpx and the Supabase client raise exceptions carrying status_code,
        # which is more reliable than anything in the rendered message.
        class ProviderError(RuntimeError):
            def __init__(self, status_code):
                super().__init__('the provider rejected the request')
                self.status_code = status_code

        assert is_transient_network_error(ProviderError(503))
        assert is_transient_network_error(ProviderError(429))
        assert not is_transient_network_error(ProviderError(404))
        assert not is_transient_network_error(ProviderError(422))


class TestModelOutputParsingIsRobust:
    """B13 — `lstrip('json')` is not prefix removal, and content can be a list."""

    def test_a_fenced_json_block_is_unwrapped(self):
        from services.llm_output import strip_code_fence
        payload = '{"title": "Network Security"}'
        for fenced in (
            f'```json\n{payload}\n```',
            f'```JSON\n{payload}\n```',
            f'```\n{payload}\n```',
            f'  ```json\n{payload}\n```  ',
            payload,
        ):
            assert strip_code_fence(fenced) == payload

    def test_an_unfenced_json_label_is_still_handled(self):
        from services.llm_output import strip_code_fence
        # The old chain accepted this shape, so the replacement must too.
        assert strip_code_fence('json\n{"a": 1}') == '{"a": 1}'
        assert strip_code_fence('json {"a": 1}') == '{"a": 1}'
        assert strip_code_fence('json\n[1, 2]') == '[1, 2]'

    def test_leading_json_letters_are_no_longer_eaten(self):
        from services.llm_output import strip_code_fence
        # str.lstrip('json') stripped any leading run of j/o/s/n, so text
        # beginning with one of them lost real characters.
        assert strip_code_fence('json data') == 'json data'
        assert strip_code_fence('{"title": "Jonson on Networks"}') == '{"title": "Jonson on Networks"}'
        assert strip_code_fence('nooj') == 'nooj'
        assert strip_code_fence('ση') == 'ση'

    def test_multi_part_content_blocks_are_joined_not_crashed(self):
        from services.llm_output import coerce_text
        result = SimpleNamespace(content=[{'text': 'Part one. '}, {'text': 'Part two.'}])
        assert coerce_text(result) == 'Part one. Part two.'
        assert coerce_text(SimpleNamespace(content='plain')) == 'plain'
        assert coerce_text('bare string') == 'bare string'

    def test_all_three_routers_share_one_implementation(self):
        from routers import chat, duplication
        from services.llm_output import coerce_text
        assert chat._coerce_answer is coerce_text
        assert duplication._coerce is coerce_text


class TestScanFilenamesAreSanitized:
    """B16 — the scan path stored the raw client filename; upload did not."""

    def test_path_components_and_length_are_stripped(self):
        from services.filenames import sanitize_filename
        assert sanitize_filename('../../etc/passwd.txt', default_stem='manuscript',
                                 force_suffix='txt') == 'passwd.txt'
        long_name = sanitize_filename('a' * 4000 + '.txt', default_stem='manuscript',
                                      force_suffix='txt')
        assert len(long_name) <= 104 and long_name.endswith('.txt')
        assert sanitize_filename('draft\x00\n.pdf', default_stem='manuscript',
                                 force_suffix='pdf') == 'draft.pdf'

    def test_the_upload_contract_is_byte_for_byte_unchanged(self):
        from routers.upload import _sanitize_filename
        assert _sanitize_filename(None) == 'thesis.pdf'
        assert _sanitize_filename('../../etc/passwd.pdf') == 'passwd.pdf'
        assert _sanitize_filename('my thesis (final).pdf') == 'my_thesis_final.pdf'
        assert _sanitize_filename('....pdf') == 'thesis.pdf'
        assert _sanitize_filename('no-extension') == 'no-extension.pdf'
        assert _sanitize_filename('a' * 300 + '.pdf') == 'a' * 100 + '.pdf'

    def test_the_scan_handler_persists_the_sanitized_name(self):
        from routers import duplication
        source = inspect.getsource(duplication.scan_duplication)
        assert "'filename': safe_filename" in source
        assert "'filename': file.filename" not in source


class TestStoredNonAnswersNeverBecomeResearchContext:
    """B14 — a quota apology was replayed to the model as conversational context."""

    @pytest.mark.parametrize('answer', [
        'IskAI has reached the research AI service usage limit, so your question '
        'could not be processed right now. Please try again later.',
        'No relevant thesis was found in the CCSICT archive for that query. '
        'Try rephrasing with different technical terms, or ask about another topic.',
    ])
    def test_system_notices_are_recognized(self, answer):
        from routers import chat
        assert chat._is_stored_non_answer(answer)

    def test_the_refusal_message_is_recognized(self):
        from routers import chat
        assert chat._is_stored_non_answer(chat.REFUSAL_MESSAGE)

    @pytest.mark.parametrize('answer', [
        'The attendance monitoring study used a quantitative design [1].',
        'Two archived theses cover campus network intrusion detection [1] [2].',
        '',
    ])
    def test_real_answers_are_kept(self, answer):
        from routers import chat
        assert not chat._is_stored_non_answer(answer)

    def test_the_capacity_message_has_one_definition(self):
        from routers import chat
        assert chat._capacity_response().answer == chat.CAPACITY_MESSAGE


class TestHeartbeatStateIsSynchronized:
    """B15 — two threads shared `valid`/`cancel_requested` with no lock and
    could issue overlapping control RPCs, so a stale stage could land after a
    newer one and a transient background failure could abort a healthy job."""

    def _heartbeat(self, monkeypatch, recorder):
        from workers import ingestion_worker
        monkeypatch.setattr(ingestion_worker, 'heartbeat_job_control', recorder)
        return ingestion_worker.LeaseHeartbeat(object(), 'job-1', 'worker-1')

    def test_the_background_keep_alive_carries_no_stage_or_progress(self, monkeypatch):
        calls = []

        def recorder(_client, _job, _worker, _lease, **updates):
            calls.append(updates)
            return {'lease_valid': True, 'cancel_requested': False}

        beat = self._heartbeat(monkeypatch, recorder)
        beat.update(stage='embed', progress=58, message='Embedding...')
        beat.update()  # what the background thread sends

        assert calls[0] == {'stage': 'embed', 'progress': 58, 'message': 'Embedding...'}
        assert calls[1] == {}, 'a keep-alive must not overwrite the reported stage'

    def test_control_calls_never_overlap(self, monkeypatch):
        import threading
        active = []
        overlaps = []
        guard = threading.Lock()

        def recorder(_client, _job, _worker, _lease, **_updates):
            with guard:
                active.append(1)
                if len(active) > 1:
                    overlaps.append(len(active))
            time.sleep(0.01)
            with guard:
                active.pop()
            return {'lease_valid': True, 'cancel_requested': False}

        beat = self._heartbeat(monkeypatch, recorder)
        threads = [
            threading.Thread(target=lambda i=index: beat.update(stage='embed', progress=i))
            for index in range(8)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert overlaps == [], f'{len(overlaps)} overlapping control RPCs'

    def test_a_transient_failure_marks_the_lease_lost_exactly_once(self, monkeypatch):
        def recorder(_client, _job, _worker, _lease, **_updates):
            raise RuntimeError('transient control failure')

        beat = self._heartbeat(monkeypatch, recorder)
        assert beat.update(stage='chunk') is False
        assert beat.valid is False
        # Once invalid, later calls short-circuit rather than retrying blindly.
        assert beat.update() is False

    def test_a_cancellation_is_raised_to_the_pipeline_thread(self, monkeypatch):
        from workers.ingestion_worker import CancellationRequested

        def recorder(_client, _job, _worker, _lease, **_updates):
            return {'lease_valid': True, 'cancel_requested': True}

        beat = self._heartbeat(monkeypatch, recorder)
        with pytest.raises(CancellationRequested):
            beat.update(stage='screen')
        assert beat.cancel_requested is True


class TestDuplicationAlertSurvivesEmptyRetrieval:
    """N7 — the alert was built only after generation, so the no-context return
    path always sent None even when a match had been flagged."""

    def test_a_flagged_match_is_returned_with_the_no_result_answer(self, monkeypatch):
        import asyncio
        from fastapi import BackgroundTasks
        from models import ChatRequest
        from routers import chat

        alert = {
            'flagged': True,
            'similarity': 91.5,
            'threshold': 85.0,
            'matched_paper': {'id': 'p1', 'title': 'Existing Attendance Study'},
            'matched_location': {'chunk_index': 3},
        }
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')

        async def empty_retrieval(*_args, **_kwargs):
            return ('', [], 0.0), dict(alert)
        monkeypatch.setattr(chat, '_retrieve_evidence', empty_retrieval)

        response = asyncio.run(chat._chat_impl(
            ChatRequest(question='Is an attendance monitoring system already archived?'),
            SimpleNamespace(headers={}), BackgroundTasks(), None,
        ))

        assert response.no_relevant_thesis is True
        assert response.sources == []
        assert response.duplication_alert is not None
        assert response.duplication_alert.similarity == 91.5
        assert response.duplication_alert.matched_paper['title'] == 'Existing Attendance Study'

    def test_no_alert_is_invented_when_nothing_was_flagged(self, monkeypatch):
        import asyncio
        from fastapi import BackgroundTasks
        from models import ChatRequest
        from routers import chat

        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')

        async def empty_retrieval(*_args, **_kwargs):
            return ('', [], 0.0), None
        monkeypatch.setattr(chat, '_retrieve_evidence', empty_retrieval)

        response = asyncio.run(chat._chat_impl(
            ChatRequest(question='Which theses cover quantum networking?'),
            SimpleNamespace(headers={}), BackgroundTasks(), None,
        ))

        assert response.no_relevant_thesis is True
        assert response.duplication_alert is None


class TestYearValidationUsesUtc:
    """R1 — datetime.now() used the host's local zone; everything else is UTC."""

    def test_the_upload_year_bound_is_timezone_aware(self):
        from datetime import datetime, timezone
        from routers import upload
        source = inspect.getsource(upload._validate_metadata)
        assert 'datetime.now(timezone.utc)' in source
        assert 'datetime.now().year' not in source
        # A next-year submission is accepted; the year after that is not.
        current = datetime.now(timezone.utc).year
        upload._validate_metadata('A valid thesis title', '', str(current + 1), '')
        with pytest.raises(HTTPException) as caught:
            upload._validate_metadata('A valid thesis title', '', str(current + 2), '')
        assert caught.value.status_code == 422
