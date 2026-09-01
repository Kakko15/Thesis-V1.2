"""Error-path and fallback coverage for the two most complex routers.

Targets the branches identified during the 2026-07-28 production audit as the
least-tested code: citation repair ladders, capacity cooldowns, follow-up
rewriting, author fast paths, upload validation rejects, schema fallbacks, and
cancellation outcomes. Test-only — no production behavior changes.
"""

import asyncio
from types import SimpleNamespace

import fitz
import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient

from dependencies.auth import require_upload_access
from main import app
from models import ChatRequest
from routers import chat, upload
from services import chat_notices


def run(coro):
    return asyncio.run(coro)


class _NoRequest:
    headers = {}


class _Chain:
    """Chainable Supabase table stub: every method returns self, execute() returns data."""

    def __init__(self, data):
        self._data = data

    def execute(self):
        return SimpleNamespace(data=self._data)

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self


class _TableRouter:
    def __init__(self, tables, rpc_data=None):
        self.tables = tables
        self.rpc_data = rpc_data

    def table(self, name):
        return _Chain(self.tables.get(name, []))

    def rpc(self, _name, _params=None):
        return _Chain(self.rpc_data)


def _fake_llm(replies):
    """Async LLM stub cycling through canned replies (or raising them)."""
    queue = list(replies)

    async def ainvoke(_prompt):
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(content=item)

    return SimpleNamespace(ainvoke=ainvoke)


@pytest.fixture(autouse=True)
def reset_capacity_state():
    yield
    chat_notices.reset_capacity_limit()


# ---------------------------------------------------------------------------
# chat.py — pure helpers
# ---------------------------------------------------------------------------

class TestChatHelpers:
    def test_long_questions_never_take_the_greeting_fast_path(self):
        assert chat._is_simple_conversation('hello ' + 'x' * 90) is False

    def test_author_extraction_rejects_generic_subjects(self):
        assert chat._extract_author_name('Who is the adviser of this study?') is None
        assert chat._extract_author_name('What color is the sky?') is None

    def test_format_names_handles_two_and_three_authors(self):
        assert chat._format_names(['Ana Cruz']) == 'Ana Cruz'
        assert chat._format_names(['Ana Cruz', 'Ben Reyes']) == 'Ana Cruz and Ben Reyes'
        assert chat._format_names(['Ana', 'Ben', 'Carla']) == 'Ana, Ben, and Carla'

    def test_author_lookup_response_not_found_single_and_multiple(self):
        assert 'could not verify' in chat._author_lookup_response('Ana Cruz', [])
        single = chat._author_lookup_response('Ana Cruz', [{
            'id': 'p1', 'title': 'Archive Study', 'authors': 'Ana Cruz, Ben Reyes',
            'year': 2026, 'track': 'Data Mining',
        }])
        assert 'co-author' in single and '[1]' in single and 'Ben Reyes' in single
        multiple = chat._author_lookup_response('Ana Cruz', [
            {'id': 'p1', 'title': 'First Study', 'year': 2025, 'track': 'WMAD'},
            {'id': 'p2', 'title': 'Second Study'},
        ])
        assert 'First Study' in multiple and '[2]' in multiple

    def test_grounded_fallback_lists_unique_titles_with_locations(self):
        sources = [
            {'id': 'p1', 'citation_id': 1, 'title': 'Alpha', 'section': 'Methodology'},
            {'id': 'p1', 'citation_id': 2, 'title': 'Alpha duplicate'},
            {'id': 'p2', 'citation_id': 3, 'title': 'Beta', 'page_start': 4, 'page_end': 6},
            {'id': 'p3', 'citation_id': 4, 'title': 'Gamma', 'page_start': 9, 'page_end': 9},
            {'id': 'p4', 'citation_id': 5, 'title': 'Delta'},
        ]
        message = chat._grounded_retrieval_fallback(sources, 'CCSICT')
        assert 'Methodology' in message
        assert 'pages 4–6' in message
        assert 'page 9' in message
        assert 'Alpha duplicate' not in message  # same paper deduplicated
        assert 'Delta' not in message            # capped at three studies

    def test_grounded_fallback_without_sources_is_the_no_result_message(self):
        assert chat._grounded_retrieval_fallback([], 'CCSICT') == chat.get_no_relevant_message('CCSICT')

    def test_capacity_cooldown_marks_and_expires(self, monkeypatch):
        assert chat._is_capacity_error(RuntimeError('429 RESOURCE_EXHAUSTED: quota exceeded'))
        assert not chat._is_capacity_error(RuntimeError('boom'))
        chat._mark_capacity_limited()
        assert chat._capacity_limit_is_active() is True

    def test_coerce_answer_joins_content_blocks(self):
        result = SimpleNamespace(content=[{'text': 'Part one. '}, 'Part two.'])
        assert chat._coerce_answer(result) == 'Part one. Part two.'

    def test_format_chat_history_strips_citation_markers(self):
        history = chat._format_chat_history([
            {'question': 'What was studied?', 'answer': 'A RAG system [1] was built [2].'},
            {'question': 'Unanswered follow-up'},
        ])
        assert '[1]' not in history and '[2]' not in history
        assert 'Human: Unanswered follow-up' in history

    def test_referenced_thesis_resolution_requires_sources_and_intent(self):
        source = [{'id': 'p1', 'title': 'Archive Study', 'authors': 'Ana Cruz'}]
        assert chat._resolve_referenced_thesis('what is it about', []) is None
        assert chat._resolve_referenced_thesis('what color is the sky', source) is None
        resolved = chat._resolve_referenced_thesis('what is it about', source)
        assert 'Archive Study' in resolved and 'Ana Cruz' in resolved


class TestChatDbHelpers:
    def test_load_chat_history_rejects_non_owned_session(self, monkeypatch):
        monkeypatch.setattr(chat, 'sb', _TableRouter({'chat_sessions': []}))
        with pytest.raises(HTTPException) as caught:
            chat._load_chat_history('session-1', 'user-1')
        assert caught.value.status_code == 404

    def test_load_chat_history_returns_oldest_first(self, monkeypatch):
        monkeypatch.setattr(chat, 'sb', _TableRouter({
            'chat_sessions': [{'id': 'session-1'}],
            'chat_messages': [{'question': 'newest'}, {'question': 'oldest'}],
        }))
        history = chat._load_chat_history('session-1', 'user-1')
        assert [m['question'] for m in history] == ['oldest', 'newest']

    def test_ensure_session_owner_missing_session_is_404(self, monkeypatch):
        monkeypatch.setattr(chat, 'sb', _TableRouter({'chat_sessions': []}))
        with pytest.raises(HTTPException) as caught:
            chat._ensure_session_owner('session-1', 'user-1', 'CCSICT')
        assert caught.value.status_code == 404

    def test_persist_chat_exchange_returns_session_id(self, monkeypatch):
        monkeypatch.setattr(chat, 'sb', _TableRouter({}, rpc_data='session-42'))
        response = chat.ChatResponse(answer='Answer [1].', sources=[], session_id=None)
        session_id = chat._persist_chat_exchange(
            ChatRequest(question='Q' * 60), response, SimpleNamespace(id='user-1'), 'CCSICT',
        )
        assert session_id == 'session-42'


class TestChatLlmHelpers:
    def test_followup_rewrite_accepts_a_clean_single_line(self, monkeypatch):
        monkeypatch.setattr(chat, 'llm', _fake_llm(['What is the scope of the archived RAG thesis?']))
        rewritten = run(chat._rewrite_followup('what about its scope?', ['Tell me about the RAG thesis'],
                                               [{'title': 'RAG Thesis', 'authors': 'Ana Cruz'}]))
        assert rewritten == 'What is the scope of the archived RAG thesis?'

    def test_followup_rewrite_falls_back_on_multiline_or_error(self, monkeypatch):
        monkeypatch.setattr(chat, 'llm', _fake_llm(['Answer: line one\nline two']))
        fallback = run(chat._rewrite_followup('and its scope?', ['Prior question']))
        assert fallback == chat.fallback_standalone_question('and its scope?', ['Prior question'])
        monkeypatch.setattr(chat, 'llm', _fake_llm([RuntimeError('provider down')]))
        fallback = run(chat._rewrite_followup('and its scope?', ['Prior question']))
        assert fallback == chat.fallback_standalone_question('and its scope?', ['Prior question'])

    def test_repair_citations_returns_model_output(self, monkeypatch):
        monkeypatch.setattr(chat, 'llm', _fake_llm(['Repaired claim [1].']))
        repaired = run(chat._repair_citations('Claim.', '[1] Evidence', [{'citation_id': 1}]))
        assert repaired == 'Repaired claim [1].'

    def test_duplication_summary_survives_provider_failure(self, monkeypatch):
        alert = {'matched_paper': {'title': 'Existing Study', 'department': 'CCSICT'}}
        monkeypatch.setattr(chat, 'llm', _fake_llm(['A concise summary.']))
        assert run(chat._summarize_duplication(alert)) == 'A concise summary.'
        monkeypatch.setattr(chat, 'llm', _fake_llm([RuntimeError('quota')]))
        assert run(chat._summarize_duplication(alert)) == ''


# ---------------------------------------------------------------------------
# chat.py — _chat_impl branch coverage
# ---------------------------------------------------------------------------

def _impl(question, monkeypatch, *, retrieve=None, generate=None, user=None, **request_kwargs):
    if retrieve is not None:
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
    if generate is not None:
        monkeypatch.setattr(chat, '_invoke_generation', generate)
    return run(chat._chat_impl(
        ChatRequest(question=question, **request_kwargs),
        _NoRequest(), BackgroundTasks(), user,
    ))


class TestChatImplBranches:
    def test_guest_reference_lookup_failure_never_blocks_retrieval(self, monkeypatch):
        def broken_lookup(*_args):
            raise RuntimeError('archive down')
        monkeypatch.setattr(chat, 'find_papers_by_ids', broken_lookup)

        async def retrieve(*_args):
            return ('', [], 0.0), None
        response = _impl(
            'What theses discuss networks?', monkeypatch, retrieve=retrieve,
            guest_history=['Earlier question'], guest_source_ids=['p1'],
        )
        assert response.no_relevant_thesis is True

    def test_author_fast_path_database_outage_is_503(self, monkeypatch):
        def broken(*_args):
            raise RuntimeError('metadata store down')
        monkeypatch.setattr(chat, 'find_papers_by_author', broken)
        with pytest.raises(HTTPException) as caught:
            _impl('Who is Ana Cruz?', monkeypatch)
        assert caught.value.status_code == 503

    def test_explicit_author_question_with_no_match_is_deterministic(self, monkeypatch):
        monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_: [])
        response = _impl('Who is Ana Cruz?', monkeypatch)
        assert 'could not verify Ana Cruz' in response.answer

    def test_retrieval_capacity_error_starts_cooldown(self, monkeypatch):
        async def retrieve(*_args):
            raise RuntimeError('429 quota exceeded')
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve)
        assert 'usage limit' in response.answer.lower()
        assert chat._capacity_limit_is_active() is True

    def test_retrieval_generic_error_is_503(self, monkeypatch):
        async def retrieve(*_args):
            raise RuntimeError('database exploded')
        with pytest.raises(HTTPException) as caught:
            _impl('What methods were used?', monkeypatch, retrieve=retrieve)
        assert caught.value.status_code == 503

    def test_generation_capacity_error_starts_cooldown(self, monkeypatch):
        async def retrieve(*_args):
            return ('[1] Evidence', [{'citation_id': 1, 'id': 'p1'}], 0.9), None

        async def generate(*_args):
            raise RuntimeError('rate limit reached')
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        assert 'usage limit' in response.answer.lower()

    def test_generation_generic_error_is_502(self, monkeypatch):
        async def retrieve(*_args):
            return ('[1] Evidence', [{'citation_id': 1, 'id': 'p1'}], 0.9), None

        async def generate(*_args):
            raise RuntimeError('model returned garbage')
        with pytest.raises(HTTPException) as caught:
            _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        assert caught.value.status_code == 502

    def test_misdirected_greeting_never_reaches_the_user(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'title': 'Alpha Study'}]

        async def retrieve(*_args):
            return ('[1] Evidence', sources, 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content="Hello! I'm IskAI, happy to help."), None
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        # A greeting degrades to the grounded fallback, which keeps its
        # citations. It is deliberately NOT flagged `no_relevant_thesis`:
        # retrieval succeeded and the sources are real, exactly as
        # `chat_notices.GROUNDED_FALLBACK_PREFIX` documents.
        #
        # This previously asserted the opposite, because the no-evidence
        # phrase detector ran a second time on the fallback text and matched
        # its own opening words -- `GROUNDED_FALLBACK_PREFIX` begins
        # "I could not verify a direct answer" and "could not verify" is the
        # first phrase in that list. The detector now runs once, on the
        # model's own output, so a system-authored fallback can no longer
        # trip it.
        assert 'hello' not in response.answer.lower()
        assert response.answer.startswith(chat_notices.GROUNDED_FALLBACK_PREFIX)
        assert response.no_relevant_thesis is False
        assert response.sources == sources

    def test_repair_ladder_accepts_ai_repaired_answer(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'Alpha'}]

        async def retrieve(*_args):
            return ('[1] Evidence', sources, 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content='A claim without any citation.'), None

        async def repair(*_args):
            return 'A repaired claim [1].'
        monkeypatch.setattr(chat, '_repair_citations', repair)
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        assert response.answer == 'A repaired claim [1].'

    def test_repair_ladder_uses_deterministic_coverage_when_ai_repair_fails(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'Alpha'}]

        async def retrieve(*_args):
            return ('[1] Evidence', sources, 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content='A claim without any citation.'), None

        async def bad_repair(*_args):
            return 'Still no citation anywhere.'
        monkeypatch.setattr(chat, '_repair_citations', bad_repair)
        monkeypatch.setattr(chat, 'enforce_citation_coverage', lambda answer, s: 'Coverage enforced [1].')
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        assert response.answer == 'Coverage enforced [1].'

    def test_repair_ladder_falls_back_when_everything_fails(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'Alpha'}]

        async def retrieve(*_args):
            return ('[1] Evidence', sources, 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content='A claim without any citation.'), None

        async def bad_repair(*_args):
            return 'Still no citation anywhere.'
        monkeypatch.setattr(chat, '_repair_citations', bad_repair)
        monkeypatch.setattr(chat, 'enforce_citation_coverage', lambda answer, s: 'Also uncited.')
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        assert 'Alpha' in response.answer and 'could not verify' in response.answer

    def test_repair_ladder_survives_repair_exceptions(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'Alpha'}]

        async def retrieve(*_args):
            return ('[1] Evidence', sources, 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content='A claim without any citation.'), None

        async def exploding_repair(*_args):
            raise RuntimeError('repair provider down')
        monkeypatch.setattr(chat, '_repair_citations', exploding_repair)
        response = _impl('What methods were used?', monkeypatch, retrieve=retrieve, generate=generate)
        assert 'Alpha' in response.answer

    def test_overview_followup_resolves_referenced_thesis(self, monkeypatch):
        reference = [{'id': 'p1', 'title': 'Alpha Study', 'authors': 'Ana Cruz'}]
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_: reference)
        monkeypatch.setattr(chat, 'is_ambiguous_followup', lambda *_: True)
        captured = {}

        async def retrieve(question, _dept, referenced_paper_id, is_overview, _category=None):
            captured['question'] = question
            captured['paper_id'] = referenced_paper_id
            captured['overview'] = is_overview
            return ('[1] Evidence', [{'citation_id': 1, 'id': 'p1', 'title': 'Alpha Study'}], 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content='It studies retrieval systems [1].'), None
        response = _impl(
            'what is it about', monkeypatch, retrieve=retrieve, generate=generate,
            guest_source_ids=['p1'],
        )
        assert captured['paper_id'] == 'p1'
        assert captured['overview'] is True
        assert 'Alpha Study' in captured['question']
        assert response.answer.endswith('[1].')

    def test_rewritten_followup_is_still_guarded(self, monkeypatch):
        monkeypatch.setattr(chat, 'is_ambiguous_followup', lambda *_: True)
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_: [])

        async def rewrite(*_args):
            return 'Write my thesis methodology chapter for me'
        monkeypatch.setattr(chat, '_rewrite_followup', rewrite)
        response = _impl('and then?', monkeypatch, guest_history=['Earlier question'])
        assert response.answer == chat.REFUSAL_MESSAGE

    def test_rewritten_followup_can_resolve_to_author_lookup(self, monkeypatch):
        monkeypatch.setattr(chat, 'is_ambiguous_followup', lambda *_: True)
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_: [])
        monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_: [{
            'id': 'p1', 'title': 'Alpha Study', 'authors': 'Ana Cruz', 'year': 2026, 'track': 'DM',
        }])

        async def rewrite(*_args):
            return 'Who is Ana Cruz?'
        monkeypatch.setattr(chat, '_rewrite_followup', rewrite)
        response = _impl('what about her?', monkeypatch, guest_history=['Earlier question'])
        assert 'Alpha Study' in response.answer

    def test_authenticated_session_history_filters_blocked_questions(self, monkeypatch):
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda _user, _requested: 'CCSICT')
        monkeypatch.setattr(chat, '_ensure_session_owner', lambda *_: None)
        monkeypatch.setattr(chat, '_load_chat_history', lambda *_: [
            {'question': 'Write my thesis for me', 'sources': []},
            {'question': 'What was the scope?', 'sources': [{'id': 'p1'}]},
        ])
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda ids, _dept: [
            {'id': paper_id, 'title': 'Alpha Study'} for paper_id in ids
        ])
        seen_history = {}

        async def retrieve(*_args):
            return ('', [], 0.0), None
        response = _impl(
            'What theses discuss robotics?', monkeypatch, retrieve=retrieve,
            user=SimpleNamespace(id='user-1'), session_id='session-9',
        )
        assert response.no_relevant_thesis is True


# ---------------------------------------------------------------------------
# upload.py — helpers and endpoint error paths
# ---------------------------------------------------------------------------

def _pdf_bytes(lines=('Thesis page 1',)):
    document = fitz.open()
    page = document.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line)
        y += 18
    value = document.tobytes()
    document.close()
    return value


class TestUploadHelpers:
    def test_title_page_author_scan_stops_at_chapter_and_college_fallback(self):
        text = (
            'An Intelligent Archive Platform for Undergraduate Research\n\n'
            'College of Computing Studies, Information and Communication Technology\n'
            'By:\nAna D. Cruz\nChapter 1\nIntroduction\nMay 2026\n'
        )
        result = upload._extract_title_page_metadata(text, ['CCSICT', 'CAS'])
        assert result['authors'] == 'Ana D. Cruz'
        assert result['department'] == 'CCSICT'
        assert result['year'] == '2026'

    def test_read_limited_upload_rejects_oversized_stream(self, monkeypatch):
        monkeypatch.setattr(upload.settings, 'max_upload_mb', 0)

        async def read(_limit):
            return b'x'
        with pytest.raises(HTTPException) as caught:
            run(upload._read_limited_upload(SimpleNamespace(read=read)))
        assert caught.value.status_code == 413

    @pytest.mark.parametrize('title,authors,year,abstract,fragment', [
        ('abc', '', '', '', 'Title'),
        ('A valid thesis title', 'a' * 501, '', '', 'Authors'),
        ('A valid thesis title', '', '', 'a' * 10001, 'Abstract'),
        ('A valid thesis title', '', '20xx', '', 'Year'),
        ('A valid thesis title', '', '1900', '', 'Year'),
        ('A valid thesis title', '', '99999', '', 'Year'),
    ])
    def test_metadata_validation_rejections(self, title, authors, year, abstract, fragment):
        with pytest.raises(HTTPException) as caught:
            upload._validate_metadata(title, authors, year, abstract)
        assert fragment in caught.value.detail

    def test_metadata_validation_accepts_reasonable_values(self):
        upload._validate_metadata('A valid thesis title', 'Ana Cruz', '2026', 'Short abstract')

    def test_rpc_shape_helpers_accept_list_dict_and_empty(self):
        assert upload._reserved_job([{'job_id': 'j1'}]) == {'job_id': 'j1'}
        assert upload._reserved_job([]) == {}
        assert upload._reserved_job({'job_id': 'j2'}) == {'job_id': 'j2'}
        assert upload._reserved_job(None) == {}
        assert upload._rpc_boolean([True]) is True
        assert upload._rpc_boolean([]) is False
        assert upload._rpc_boolean(True) is True


class _StatusTable:
    """upload_jobs stub whose extended-column select fails like a legacy schema."""

    def __init__(self, job, legacy_schema=False, always_fail=False):
        self.job = job
        self.legacy_schema = legacy_schema
        self.always_fail = always_fail
        self.fields = ''

    def select(self, fields):
        self.fields = fields
        return self

    def execute(self):
        if self.always_fail:
            raise RuntimeError('database gone')
        if self.legacy_schema and 'cancel_requested_at' in self.fields:
            raise RuntimeError('column upload_jobs.cancel_requested_at does not exist')
        return SimpleNamespace(data=[self.job] if self.job else [])

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self


def _status_sb(job, legacy_schema=False, always_fail=False, events=()):
    jobs = _StatusTable(job, legacy_schema=legacy_schema, always_fail=always_fail)

    class _Sb:
        @staticmethod
        def table(name):
            if name == 'upload_jobs':
                return jobs
            return _Chain(list(events))
    return _Sb()


@pytest.fixture()
def upload_client():
    app.dependency_overrides[require_upload_access] = lambda: SimpleNamespace(id='user-1')
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    app.dependency_overrides.pop(require_upload_access, None)


_JOB = {
    'id': 'job-1', 'owner_id': 'user-1', 'department': 'CCSICT', 'status': 'queued',
    'stage': 'queued', 'progress': 5, 'message': 'Queued', 'paper_id': None,
    'chunks': None, 'duplication': None, 'error': None, 'attempt_count': 0,
    'max_attempts': 3, 'next_retry_at': None, 'created_at': 'x', 'updated_at': 'x',
}


class TestUploadStatusEndpoint:
    def test_legacy_schema_falls_back_to_reduced_columns(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _status_sb(_JOB, legacy_schema=True))
        response = upload_client.get('/upload/status/job-1')
        assert response.status_code == 200
        body = response.json()
        assert body['status'] == 'queued'
        assert body['cancel_requested'] is False
        assert body['can_cancel'] is True

    def test_database_outage_is_503(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _status_sb(_JOB, always_fail=True))
        assert upload_client.get('/upload/status/job-1').status_code == 503

    def test_unknown_job_is_404(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _status_sb(None))
        assert upload_client.get('/upload/status/job-1').status_code == 404


class _CancelSb:
    def __init__(self, outcome, rpc_error=None):
        self.outcome = outcome
        self.rpc_error = rpc_error

    def table(self, _name):
        return _Chain([{'role': 'student', 'department': 'CCSICT'}])

    def rpc(self, _name, _params=None):
        if self.rpc_error:
            raise self.rpc_error
        return _Chain([{'outcome': self.outcome, 'status': 'cancelled', 'cancelled_at': None}])


class TestUploadCancelEndpoint:
    def test_missing_operations_migration_gives_actionable_503(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _CancelSb('', rpc_error=RuntimeError('PGRST202: could not find the function')))
        response = upload_client.post('/upload/jobs/job-1/cancel', json={'reason': None})
        assert response.status_code == 503
        assert 'operations migration' in response.json()['detail']

    def test_generic_rpc_outage_is_503(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _CancelSb('', rpc_error=RuntimeError('connection refused')))
        assert upload_client.post('/upload/jobs/job-1/cancel', json={'reason': None}).status_code == 503

    def test_not_found_and_forbidden_outcomes(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _CancelSb('not_found'))
        assert upload_client.post('/upload/jobs/job-1/cancel', json={'reason': None}).status_code == 404
        monkeypatch.setattr(upload, 'sb', _CancelSb('forbidden'))
        assert upload_client.post('/upload/jobs/job-1/cancel', json={'reason': None}).status_code == 403

    def test_cancelled_outcome_survives_security_event_failure(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _CancelSb('cancelled'))

        def broken_event(*_args, **_kwargs):
            raise RuntimeError('audit store down')
        monkeypatch.setattr(upload, 'record_security_event', broken_event)
        response = upload_client.post('/upload/jobs/job-1/cancel', json={'reason': 'changed my mind'})
        assert response.status_code == 200
        assert response.json()['cancel_requested'] is True


class _FakeMetadataLLM:
    def __init__(self, reply):
        self.reply = reply

    async def ainvoke(self, _prompt):
        # The handler awaits the model so the call does not occupy a worker
        # thread for the full Gemini timeout.
        if isinstance(self.reply, Exception):
            raise self.reply
        return SimpleNamespace(content=self.reply)


class TestExtractMetadataEndpoint:
    def _post(self, client, pdf):
        return client.post(
            '/upload/extract-metadata',
            files={'file': ('thesis.pdf', pdf, 'application/pdf')},
        )

    def test_blank_pdf_returns_empty_fields_without_llm(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))
        document = fitz.open()
        document.new_page()
        blank = document.tobytes()
        document.close()
        response = self._post(upload_client, blank)
        assert response.status_code == 200
        assert response.json() == {'title': '', 'authors': ''}

    def test_complete_title_page_skips_the_llm(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))

        def forbidden(*_args, **_kwargs):
            raise AssertionError('LLM must not be called when local extraction is complete')
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', forbidden)
        pdf = _pdf_bytes((
            'An Intelligent Archive Platform for Undergraduate Research',
            'CCSICT',
            'By:',
            'Ana D. Cruz',
            'May 2026',
        ))
        response = self._post(upload_client, pdf)
        assert response.status_code == 200
        body = response.json()
        assert body['title'] == 'An Intelligent Archive Platform for Undergraduate Research'
        assert body['authors'] == 'Ana D. Cruz'
        assert body['year'] == '2026'
        assert body['department'] == 'CCSICT'

    def test_llm_fills_missing_fields_but_title_page_owns_the_year(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', lambda **_kwargs: _FakeMetadataLLM(
            '{"title": "AI-Assisted Platform", "authors": "Ana D. Cruz", "year": "1999", "department": "CCSICT"}',
        ))
        pdf = _pdf_bytes(('Some cover line', 'More text mentioning a 1999 citation elsewhere'))
        response = self._post(upload_client, pdf)
        assert response.status_code == 200
        body = response.json()
        assert body['title'] == 'AI-Assisted Platform'
        # The AI year appears on the title page here, so it is accepted.
        assert body['year'] == '1999'

    def test_llm_failure_degrades_to_local_extraction(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', lambda **_kwargs: _FakeMetadataLLM(
            RuntimeError('provider down'),
        ))
        pdf = _pdf_bytes(('An Intelligent Archive Platform for Undergraduate Research',))
        response = self._post(upload_client, pdf)
        assert response.status_code == 200
        assert response.json()['title'] == 'An Intelligent Archive Platform for Undergraduate Research'
