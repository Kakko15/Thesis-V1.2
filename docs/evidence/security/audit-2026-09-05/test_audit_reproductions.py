r"""Offline observations for the 2026-09-05 audit of commit 1426252.

These tests demonstrate CURRENT defects, so passing means the observation was
reproduced, not that the application is secure. They are deliberately outside
the application's normal test directory. No live services or accounts are used.

Run from rag-thesis-backend:
  .\.venv\Scripts\python.exe -m pytest ../docs/evidence/security/audit-2026-09-05/test_audit_reproductions.py -q
"""

import asyncio
import inspect
import json
import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

BACKEND = Path(__file__).resolve().parents[4] / 'rag-thesis-backend'
sys.path.insert(0, str(BACKEND))
# Apply the project's explicit fake credentials before any application import.
import tests.conftest  # noqa: F401,E402

import fitz
import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from starlette.datastructures import Headers, UploadFile
from starlette.formparsers import MultiPartParser
from starlette.requests import Request

from config import settings
from dependencies import auth
from main import app
from models import ChatRequest, ChatResponse
from routers import catalog, chat, duplication, papers, upload
from services import guest_budget, malware
from services.catalog import AcademicSelection
from services.citations import enforce_citation_coverage, validate_citations
from services.rate_limiting import limiter

USER_ID = '22222222-2222-4222-8222-222222222222'
JOB_ID = '11111111-1111-4111-8111-111111111111'
SESSION_ID = '33333333-3333-4333-8333-333333333333'
USER = SimpleNamespace(id=USER_ID)


@pytest.fixture(autouse=True)
def isolated_services(monkeypatch):
    """Any unexpected outbound HTTP fails rather than contacting a service."""
    def blocked(*_args, **_kwargs):
        raise AssertionError('Unexpected outbound HTTP in offline audit')

    async def async_blocked(*_args, **_kwargs):
        raise AssertionError('Unexpected outbound HTTP in offline audit')

    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', async_blocked)
    monkeypatch.setattr(settings, 'supabase_jwt_secret', '')
    monkeypatch.setattr(limiter, 'enabled', False)
    auth.invalidate_role_cache()
    auth.invalidate_features_cache()
    saved_overrides = app.dependency_overrides.copy()
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(saved_overrides)
    auth.invalidate_role_cache()
    auth.invalidate_features_cache()


def request(path='/chat'):
    return Request({
        'type': 'http', 'method': 'POST', 'path': path, 'headers': [],
        'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('audit', 80), 'scheme': 'http',
    })


def pdf_bytes(pages=1):
    with fitz.open() as document:
        for index in range(pages):
            page = document.new_page()
            page.insert_text((72, 72), f'Chapter {index + 1}\nResearch methods and experimental results for this study.')
        return document.tobytes()


class Query:
    def __init__(self, data=None):
        self.data = data or []
        self.inserted = None

    def select(self, *_args, **_kwargs): return self
    def eq(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def in_(self, *_args, **_kwargs): return self
    def insert(self, payload):
        self.inserted = payload
        self.data = [{**payload, 'id': JOB_ID}]
        return self
    def execute(self): return SimpleNamespace(data=self.data)


@pytest.mark.parametrize('path', ['/upload/paper', '/upload/extract-metadata', '/duplication/scan'])
def test_unauthenticated_oversized_file_is_spooled_before_rejection(monkeypatch, path):
    monkeypatch.setattr(settings, 'max_upload_mb', 1)
    original_parse = MultiPartParser.parse
    observations = []

    async def observed_parse(parser):
        form = await original_parse(parser)
        for _, value in form.multi_items():
            if isinstance(value, UploadFile):
                observations.append((value.size, value.file._rolled))
        return form

    monkeypatch.setattr(MultiPartParser, 'parse', observed_parse)
    response = TestClient(app).post(
        path, data={'title': 'Audit upload'},
        files={'file': ('audit.pdf', b'x' * (2 * 1024 * 1024), 'application/pdf')},
    )
    assert response.status_code in (401, 403)
    assert observations == [(2 * 1024 * 1024, True)]


def test_public_rate_limit_is_reset_by_changing_guest_id(monkeypatch):
    monkeypatch.setattr(limiter, 'enabled', True)
    limiter.reset()
    monkeypatch.setattr(catalog, '_nested_catalog', lambda: [])
    client = TestClient(app)
    stable = {'X-Guest-ID': 'audit-guest-stable-0001'}
    assert all(client.get('/catalog/departments', headers=stable).status_code == 200 for _ in range(30))
    assert client.get('/catalog/departments', headers=stable).status_code == 429
    assert client.get('/catalog/departments', headers={'X-Guest-ID': 'audit-guest-fresh-0002'}).status_code == 200
    limiter.reset()


def test_disabled_chat_and_archive_features_do_not_restrict_api(monkeypatch):
    # Real auth dependencies run, with only the Supabase service replaced.
    profile = {'id': USER_ID, 'role': 'student', 'status': 'approved', 'department': 'CCSICT'}
    disabled = {'student': dict.fromkeys(['chat', 'archive', 'novelty', 'upload'], False)}
    db = SimpleNamespace(
        auth=SimpleNamespace(get_user=lambda _token: SimpleNamespace(user=USER)),
        table=lambda name: Query([profile] if name == 'profiles' else [{'value': disabled}] if name == 'system_settings' else []),
    )
    monkeypatch.setattr(auth, 'sb', db)
    monkeypatch.setattr(papers, 'sb', db)
    monkeypatch.setattr(chat, '_client_gone', AsyncMock(return_value=True))
    monkeypatch.setattr(chat, 'log_activity', lambda *_args, **_kwargs: None)
    headers = {'Authorization': 'Bearer validated-by-fake-supabase'}
    assert auth.get_role_features()['student']['chat'] is False
    client = TestClient(app)
    assert client.get('/papers', headers=headers).status_code == 200
    response = client.post('/chat', headers=headers, json={'question': 'Hello'})
    assert response.status_code == 200
    assert response.json()['answer']


def test_faculty_aal1_can_use_novelty_even_when_privileged_mfa_enabled(monkeypatch):
    monkeypatch.setattr(settings, 'require_privileged_mfa', True)
    monkeypatch.setattr(auth, 'get_user_role', lambda _user: 'faculty')
    monkeypatch.setattr(auth, 'get_role_features', lambda: {'faculty': {'novelty': True}})
    # Validated identity is supplied, as FastAPI does after get_current_user.
    # Invalid AAL material would fail closed if the guard checked it.
    credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials='aal1-session')
    assert auth.require_novelty_access(USER, credentials) is USER
    monkeypatch.setattr(auth, 'get_user_role', lambda _user: 'admin')
    with pytest.raises(HTTPException) as rejected:
        auth.require_novelty_access(USER, credentials)
    assert rejected.value.status_code == 403


def test_novelty_accepts_pdf_above_page_limit_without_calling_scanner(monkeypatch):
    monkeypatch.setattr(settings, 'max_pdf_pages', 1)
    monkeypatch.setattr(settings, 'malware_scan_mode', 'clamav')
    scanner = Mock(side_effect=AssertionError('Scanner must reject this synthetic case'))
    monkeypatch.setattr(malware, 'scan_pdf', scanner)
    monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_args: 'CCSICT')
    monkeypatch.setattr(duplication, 'embed_texts', lambda texts: [[0.1] * 768 for _ in texts])
    monkeypatch.setattr(duplication, '_match_chunks_against_archive', lambda *_args: ([], []))
    history = Query()
    monkeypatch.setattr(duplication, 'sb', SimpleNamespace(table=lambda _name: history))
    monkeypatch.setattr(duplication, 'log_activity', lambda *_args, **_kwargs: None)
    content = pdf_bytes(2)
    with pytest.raises(HTTPException):
        upload._validate_pdf_upload(content, 'audit.pdf', 'application/pdf')
    file = UploadFile(file=BytesIO(content), filename='audit.pdf', headers=Headers({'content-type': 'application/pdf'}))
    result = asyncio.run(inspect.unwrap(duplication.scan_duplication)(request('/duplication/scan'), file, USER))
    assert result['id'] == JOB_ID
    assert result['total_chunks'] > 0
    scanner.assert_not_called()


def test_upload_deletes_source_when_committed_queue_status_is_unavailable(monkeypatch):
    state = {'status': 'staging', 'source_exists': False}
    monkeypatch.setattr(upload, 'resolve_effective_department', lambda *_args: 'CCSICT')
    monkeypatch.setattr(upload, 'resolve_academic_selection', lambda *_args, **_kwargs: AcademicSelection('dept', None, None, '', None, 'unclassified'))
    monkeypatch.setattr(upload, '_reserve_durable_job', lambda _payload: {
        'job_id': JOB_ID, 'stored_source_path': 'uploads/audit.pdf', 'job_status': 'staging', 'created': True,
    })
    monkeypatch.setattr(upload, '_store_staged_source', lambda *_args: state.update(source_exists=True))

    def commit_then_timeout(*_args):
        state['status'] = 'queued'
        raise TimeoutError('Queue committed; response lost')

    def unavailable_status(*_args):
        raise TimeoutError('Status lookup also unavailable')

    def remove_source(*_args):
        state['source_exists'] = False
        return True

    # Models the SQL WHERE status = staging, which cannot undo a queued job.
    def fail_only_staging(*_args, **_kwargs):
        if state['status'] == 'staging':
            state['status'] = 'failed'

    monkeypatch.setattr(upload, '_queue_durable_job', commit_then_timeout)
    monkeypatch.setattr(upload, '_durable_job_status', unavailable_status)
    monkeypatch.setattr(upload, '_remove_staged_source', remove_source)
    monkeypatch.setattr(upload, '_fail_staging_job', fail_only_staging)
    file = UploadFile(file=BytesIO(pdf_bytes()), filename='audit.pdf', headers=Headers({'content-type': 'application/pdf'}))
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(inspect.unwrap(upload.upload_paper)(request('/upload/paper'), file, 'Audit manuscript', USER, thesis_category='faculty'))
    assert rejected.value.status_code == 503
    assert state == {'status': 'queued', 'source_exists': False}


def test_chat_edit_loses_old_branch_if_replacement_save_fails(monkeypatch):
    messages = [{'id': 'first'}, {'id': 'edited'}, {'id': 'later'}]

    class MessagesQuery(Query):
        def __init__(self):
            super().__init__()
            self.deleting = False
            self.ids = []
        def delete(self):
            self.deleting = True
            return self
        def in_(self, _field, ids):
            self.ids = ids
            return self
        def execute(self):
            if self.deleting:
                messages[:] = [row for row in messages if row['id'] not in self.ids]
                return SimpleNamespace(data=[])
            return SimpleNamespace(data=messages.copy())

    def failed_rpc(*_args):
        raise RuntimeError('Database write rejected')

    monkeypatch.setattr(chat, 'sb', SimpleNamespace(table=lambda _name: MessagesQuery(), rpc=failed_rpc))
    monkeypatch.setattr(chat, '_ensure_session_owner', lambda *_args: None)
    monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
    monkeypatch.setattr(chat, '_client_gone', AsyncMock(return_value=False))
    monkeypatch.setattr(chat, '_chat_impl', AsyncMock(return_value=ChatResponse(answer='Replacement [1]', session_id=SESSION_ID)))
    req = ChatRequest(question='Edited question', session_id=SESSION_ID, edit_from_turn=1)
    result = asyncio.run(inspect.unwrap(chat.chat)(req, request(), BackgroundTasks(), USER))
    assert result.history_saved is False
    assert messages == [{'id': 'first'}]


def test_guest_followup_generation_is_unbilled_when_retrieval_is_empty(monkeypatch):
    monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [])
    monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_args: [])
    monkeypatch.setattr(chat, 'find_papers_by_title_fragment', lambda *_args: [])
    monkeypatch.setattr(chat, '_capacity_limit_is_active', lambda: False)
    monkeypatch.setattr(guest_budget, 'is_exhausted', lambda: False)
    billed = Mock(return_value=guest_budget.ALLOWED_UNLIMITED)
    monkeypatch.setattr(guest_budget, 'charge', billed)
    provider = AsyncMock(return_value=SimpleNamespace(content='Which machine learning methods were evaluated?'))
    monkeypatch.setattr(chat.gemini_pool, 'arun', provider)
    monkeypatch.setattr(chat, '_retrieve_evidence', AsyncMock(return_value=(('', [], 0.0), None)))
    req = ChatRequest(question='What about its methods?', guest_history=['Tell me about machine learning in agriculture.'])
    response = asyncio.run(chat._chat_impl(req, request(), BackgroundTasks(), None, resolved_department='CCSICT'))
    assert response.no_relevant_thesis is True
    assert provider.await_count == 1
    billed.assert_not_called()


def test_gateway_ceiling_exceeds_output_reserved_by_guest_budget(monkeypatch):
    monkeypatch.setattr(settings, 'gemini_max_output_tokens', 2000)
    monkeypatch.setattr(settings, 'llm_gateway_max_output_tokens', 6000)
    monkeypatch.setattr(settings, 'llm_base_url', 'https://gateway.example.test/v1')
    assert guest_budget.estimate_charge('') == 2000
    assert chat.gemini_pool.active_output_ceiling() == 6000


def test_cors_refuses_actual_catalog_patch_method():
    response = TestClient(app).options('/catalog/programs/' + JOB_ID, headers={
        'Origin': settings.cors_origin_list[0],
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    assert response.status_code == 400
    assert 'Disallowed CORS method' in response.text


def test_deterministic_citation_repair_attaches_unrelated_source():
    sources = [{'id': JOB_ID, 'citation_id': 1, 'title': 'Library catalog usability'}]
    answer = 'The clinical experiment proved a complete cancer cure [999].'
    repaired = enforce_citation_coverage(answer, sources)
    assert repaired == 'The clinical experiment proved a complete cancer cure [1].'
    assert validate_citations(repaired, sources) == (True, [])


def test_evaluation_resumes_old_answers_after_model_configuration_changes(monkeypatch, tmp_path):
    from evaluation import run_comparison

    query = {'id': 1, 'question': 'What methods did the study use?'}
    checkpoint = tmp_path / 'same-dataset.pathways.jsonl'
    old_row = {**query, 'rag_answer': 'Answer collected under the previous model.'}
    checkpoint.write_text(json.dumps(old_row) + '\n', encoding='utf-8')
    monkeypatch.setattr(settings, 'gemini_chat_model', 'different-model-for-audit')
    fresh_run = AsyncMock(side_effect=AssertionError('Expected a fresh evaluation'))
    monkeypatch.setattr(run_comparison, '_run_query', fresh_run)
    rows = asyncio.run(run_comparison._run_pathways([query], checkpoint))
    assert rows == [old_row]
    fresh_run.assert_not_awaited()
