import asyncio
from io import BytesIO
from types import SimpleNamespace

import fitz
import pytest
from fastapi import HTTPException, Request, UploadFile

from models import ChatRequest
from routers import duplication
from services.document_processor import ExtractedDocument, ExtractedPage


class Query:
    """Stub builder whose `insert` echoes the row back, as PostgREST does.

    It previously returned the scripted `data` for an insert, and the scan tests
    scripted that as `[]` — so they exercised the id-less fallback path rather
    than the real one, which is exactly why finding 17 went unnoticed. Echoing
    the payload plus a generated id keeps the assertions honest.
    """

    def __init__(self, data): self.data = data; self.payload = None
    def select(self, *_args): return self
    def eq(self, *_args): return self
    def in_(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self
    def delete(self): return self
    def update(self, payload): self.payload = payload; return self

    def insert(self, payload):
        self.payload = payload
        scripted = self.data[0] if isinstance(self.data, list) and self.data else {}
        self.data = [{**payload, **scripted}]
        return self

    def execute(self): return SimpleNamespace(data=self.data)


class Client:
    def __init__(self, rpc_rows, table_rows):
        self.rpc_rows = list(rpc_rows)
        self.table_rows = {name: list(values) for name, values in table_rows.items()}
    def rpc(self, _name, _args): return Query(self.rpc_rows.pop(0))
    def table(self, name): return Query(self.table_rows[name].pop(0))


def delete_request(path='/duplication/history'):
    """slowapi's wrapper needs a real Request, so the rate-limited history
    deletions cannot be called with a stand-in object."""
    return Request({
        'type': 'http', 'method': 'DELETE', 'path': path, 'headers': [],
        'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


def _pdf_bytes(pages=1):
    """A real PDF, built the way tests/test_security_upload_hardening.py does.

    The scan endpoint now applies the ingestion pipeline's structural checks
    before extraction -- PyMuPDF must be able to open the file, it must not be
    encrypted, and its page count must sit inside `max_pdf_pages` -- so the
    `b'%PDF-dummy'` stand-in this used to send is refused as malformed. That
    refusal is correct and is covered on its own below; it is not what these
    scan tests are about, so they carry a document that actually parses.
    """
    document = fitz.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 72), f'Draft page {index + 1}')
    value = document.tobytes()
    document.close()
    return value


def upload_file():
    return UploadFile(filename='draft.pdf', file=BytesIO(_pdf_bytes()))


def fake_llm(reply=None, *, fail_with=None):
    """The scan awaits the model, so the double exposes ainvoke, not invoke."""
    async def ainvoke(_prompt):
        if fail_with is not None:
            fail_with()
        return SimpleNamespace(content=reply)
    return SimpleNamespace(ainvoke=ainvoke)


def request():
    return Request({
        'type': 'http', 'method': 'POST', 'path': '/duplication/scan',
        'headers': [], 'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


async def run_scan(file, department, user):
    endpoint = getattr(duplication.scan_duplication, '__wrapped__', duplication.scan_duplication)
    return await endpoint(request(), file, user=user, department=department)


def run_chat(body, user):
    endpoint = getattr(duplication.duplication_chat, '__wrapped__', duplication.duplication_chat)
    return endpoint(body, request(), user)


def prepare(monkeypatch):
    document = ExtractedDocument([ExtractedPage(1, 'Clean proposed research content')])
    monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_: 'CCSICT')
    monkeypatch.setattr(duplication, 'extract_document', lambda *_: document)
    monkeypatch.setattr(duplication, 'split_document', lambda *_: [{
        'content': 'Clean proposed research content', 'chunk_index': 0,
        'page_start': 1, 'page_end': 1, 'section': 'Introduction',
    }])
    monkeypatch.setattr(duplication, 'is_noise_chunk', lambda *_: False)
    monkeypatch.setattr(duplication, 'embed_texts', lambda *_: [[0.1] * 768])
    monkeypatch.setattr(duplication, 'log_activity', lambda *_args, **_kwargs: None)


class TestScanUploadIsHardenedLikeIngestion:
    """The scan path used to trust an extension, a MIME type and a `%PDF-` prefix.

    Everything it accepted then went through PyMuPDF and the OCR fallback with
    no page ceiling, and no file reaching it was ever scanned for malware --
    while the ingestion pipeline applied all three checks to the very same kind
    of manuscript, and production refuses to start without ClamAV precisely so
    that nothing uploaded goes unscanned. Audited 2026-09-12.
    """

    def test_a_file_pymupdf_cannot_open_is_refused_before_extraction(self, monkeypatch):
        monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_: 'CCSICT')
        monkeypatch.setattr(duplication, 'extract_document', lambda *_: (_ for _ in ()).throw(
            AssertionError('a malformed PDF must never reach extraction'),
        ))
        malformed = UploadFile(filename='draft.pdf', file=BytesIO(b'%PDF-dummy'))
        with pytest.raises(HTTPException) as refused:
            asyncio.run(run_scan(malformed, None, SimpleNamespace(id='u1')))
        assert refused.value.status_code == 422

    def test_a_manuscript_past_the_page_ceiling_is_refused(self, monkeypatch):
        monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_: 'CCSICT')
        monkeypatch.setattr(duplication.settings, 'max_pdf_pages', 2)
        monkeypatch.setattr(duplication, 'extract_document', lambda *_: (_ for _ in ()).throw(
            AssertionError('an oversized manuscript must never reach extraction'),
        ))
        oversized = UploadFile(filename='draft.pdf', file=BytesIO(_pdf_bytes(pages=3)))
        with pytest.raises(HTTPException) as refused:
            asyncio.run(run_scan(oversized, None, SimpleNamespace(id='u1')))
        assert refused.value.status_code == 422

    def test_malware_is_refused_and_an_unavailable_scanner_fails_closed(self, monkeypatch):
        monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_: 'CCSICT')
        monkeypatch.setattr(duplication, 'extract_document', lambda *_: (_ for _ in ()).throw(
            AssertionError('an unscanned manuscript must never reach extraction'),
        ))

        def infected(_payload):
            raise duplication.MalwareDetected('infected')

        monkeypatch.setattr(duplication, 'scan_pdf', infected)
        with pytest.raises(HTTPException) as detected:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert detected.value.status_code == 422

        def unavailable(_payload):
            raise duplication.MalwareScannerUnavailable('down')

        monkeypatch.setattr(duplication, 'scan_pdf', unavailable)
        with pytest.raises(HTTPException) as offline:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        # Fails closed, as ingestion does: unscanned is not a substitute for clean.
        assert offline.value.status_code == 503

    def test_the_scanner_sees_the_file_before_pymupdf_does(self, monkeypatch):
        pdf = _pdf_bytes()
        order = []
        monkeypatch.setattr(duplication, 'scan_pdf', lambda *_args: order.append('scan'))
        real_open = duplication.fitz.open

        def recording_open(*args, **kwargs):
            order.append('parse')
            return real_open(*args, **kwargs)

        monkeypatch.setattr(duplication.fitz, 'open', recording_open)
        duplication._reject_unsafe_scan_upload(pdf, 'pdf')
        assert order == ['scan', 'parse']

    def test_a_manuscript_with_too_many_passages_is_refused_before_embedding(self, monkeypatch):
        # One passage = one embedding + one archive lookup; a 25 MB .txt once
        # meant ~8,000 of each in a single request (2026-11-25 review).
        prepare(monkeypatch)
        monkeypatch.setattr(duplication.settings, 'max_novelty_scan_chunks', 3)
        monkeypatch.setattr(duplication, 'split_document', lambda *_: [{
            'content': f'Clean passage {n}', 'chunk_index': n,
            'page_start': 1, 'page_end': 1, 'section': 'Introduction',
        } for n in range(4)])
        monkeypatch.setattr(duplication, 'embed_texts', lambda *_: pytest.fail('embedded an over-long file'))
        with pytest.raises(HTTPException) as refused:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert refused.value.status_code == 413
        assert '4 passages' in refused.value.detail


class TestNoveltyScan:
    def test_clear_scan_has_deterministic_metrics(self, monkeypatch):
        prepare(monkeypatch)
        client = Client([[]], {'scan_history': [[{'id': 'scan-1'}]]})
        monkeypatch.setattr(duplication, 'sb', client)
        response = asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert response['verdict_level'] == 'clear'
        assert response['matched_chunk_count'] == 0
        assert response['total_chunks'] == 1

    def test_matching_scan_uses_advisory_ai_explanation(self, monkeypatch):
        prepare(monkeypatch)
        match = {
            'paper_id': 'p1', 'content': 'Archived content', 'similarity': 0.9,
            'page_start': 2, 'page_end': 2, 'section': 'Introduction',
        }
        client = Client([[match]], {
            'papers': [[{'id': 'p1', 'title': 'Existing', 'authors': 'A', 'year': 2025, 'track': 'Data Mining', 'department': 'CCSICT'}]],
            'scan_history': [[{'id': 'scan-1'}]],
        })
        monkeypatch.setattr(duplication, 'sb', client)
        monkeypatch.setattr(duplication, 'llm', fake_llm('Faculty review advised.'))
        response = asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert response['highest_similarity'] == 90
        assert response['matched_chunk_percentage'] == 100
        assert response['verdict_level'] == 'high_overlap'
        assert response['verdict_summary'] == 'Faculty review advised.'
        assert 'matched_chunks' not in response

    def test_matched_passages_show_only_the_reviewers_own_text(self, monkeypatch):
        # 2026-11-25 user testing: the Matches tab had no passages at all. They
        # are now served, but the archived side is citation metadata only.
        prepare(monkeypatch)
        match = {
            'paper_id': 'p1', 'content': 'SECRET ARCHIVED WORDING', 'similarity': 0.9,
            'page_start': 7, 'page_end': 8, 'section': 'Methodology',
        }
        prompts_seen = []

        async def ainvoke(prompt):
            prompts_seen.append(prompt)
            return SimpleNamespace(content='Explained.')

        client = Client([[match]], {
            'papers': [[{'id': 'p1', 'title': 'ISU-CANNER', 'authors': 'A', 'year': 2025, 'track': 'AI', 'department': 'CCSICT'}]],
            'scan_history': [[{'id': 'scan-1'}]],
        })
        monkeypatch.setattr(duplication, 'sb', client)
        monkeypatch.setattr(duplication, 'llm', SimpleNamespace(ainvoke=ainvoke))
        response = asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))

        [passage] = response['matched_passages']
        assert passage['title'] == 'ISU-CANNER'
        assert passage['year'] == 2025
        assert passage['excerpt'] == 'Clean proposed research content'
        assert passage['archived_section'] == 'Methodology'
        assert (passage['archived_page_start'], passage['archived_page_end']) == (7, 8)
        assert 'SECRET ARCHIVED WORDING' not in str(response)
        # The model is handed the label the report shows, never the raw enum.
        assert 'High overlap (faculty review required)' in prompts_seen[0]
        assert 'high_overlap' not in prompts_seen[0]
        assert 'Do not use tables' in prompts_seen[0]

    def test_public_passages_cap_the_excerpt_and_tolerate_missing_metadata(self):
        scan = {
            'top_matches': [{'id': 'p1', 'title': 'Known', 'year': 2024}, 'junk'],
            'matched_chunks': [
                {'paper_id': 'p1', 'uploaded_text': 'word ' * 200, 'database_text': 'hidden', 'similarity': 88.0},
                {'paper_id': 'gone', 'uploaded_text': 'mine', 'database_text': 'hidden', 'section': 'Objectives'},
                'junk',
            ],
        }
        first, second = duplication._public_passages(scan)  # pylint: disable=protected-access
        assert len(first['excerpt']) <= 281 and first['excerpt'].endswith('…')
        assert second['title'] == 'Archived thesis' and second['year'] is None
        assert second['section'] == 'Objectives'
        assert 'hidden' not in str([first, second])
        assert duplication._advisory_label('mystery_level') == 'Mystery level'  # pylint: disable=protected-access

    def test_scan_survives_every_matched_paper_being_deleted(self, monkeypatch):
        # The vector search returns a paper id, then the papers fetch comes back
        # empty because the row was deleted in between. Indexing the top-matches
        # list crashed with IndexError here, so faculty saw a 500 at the exact
        # moment a matched thesis had just been removed.
        prepare(monkeypatch)
        match = {
            'paper_id': 'p1', 'content': 'Archived content', 'similarity': 0.9,
            'page_start': 2, 'page_end': 2, 'section': 'Introduction',
        }
        client = Client([[match]], {'papers': [[]], 'scan_history': [[{'id': 'scan-1'}]]})
        monkeypatch.setattr(duplication, 'sb', client)
        # The verdict must not need the LLM: there are no excerpts left to compare.
        monkeypatch.setattr(duplication, 'llm', fake_llm(fail_with=lambda: pytest.fail(
            'must not call the model with no matched papers',
        )))

        response = asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))

        # The deterministic half of the scan is still true and still reported.
        assert response['highest_similarity'] == 90
        assert response['matched_chunk_percentage'] == 100
        assert response['verdict_level'] == 'high_overlap'
        assert response['top_matches'] == []
        assert 'no longer in the archive' in response['verdict_summary']

    def test_embedding_capacity_is_a_retryable_503_not_a_500(self, monkeypatch):
        # Batch scanning sends manuscripts back to back, so the embedding quota
        # is reachable in normal use; a bare 500 gave the client nothing to act on.
        prepare(monkeypatch)
        def exhausted(*_args):
            raise RuntimeError('429 RESOURCE_EXHAUSTED: quota exceeded for embed_content')
        monkeypatch.setattr(duplication, 'embed_texts', exhausted)
        monkeypatch.setattr(duplication, 'sb', Client([], {}))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert caught.value.status_code == 503
        assert caught.value.headers == {'Retry-After': str(duplication.settings.gemini_capacity_cooldown_seconds)}
        assert 'usage limit' in caught.value.detail

    def test_a_transient_embedding_failure_is_a_short_retryable_503(self, monkeypatch):
        prepare(monkeypatch)
        def overloaded(*_args):
            raise RuntimeError('503 UNAVAILABLE: The model is overloaded. Please try again later.')
        monkeypatch.setattr(duplication, 'embed_texts', overloaded)
        monkeypatch.setattr(duplication, 'sb', Client([], {}))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert caught.value.status_code == 503
        assert caught.value.headers == {'Retry-After': '20'}
        assert 'temporarily unavailable' in caught.value.detail

    def test_other_embedding_failures_are_a_502(self, monkeypatch):
        prepare(monkeypatch)
        def broken(*_args):
            raise ValueError('unexpected embedding payload')
        monkeypatch.setattr(duplication, 'embed_texts', broken)
        monkeypatch.setattr(duplication, 'sb', Client([], {}))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert caught.value.status_code == 502

    def test_an_archive_search_outage_is_a_retryable_503(self, monkeypatch):
        prepare(monkeypatch)

        class TimingOutClient(Client):
            def rpc(self, _name, _args):
                raise RuntimeError('canceling statement due to statement timeout')

        monkeypatch.setattr(duplication, 'sb', TimingOutClient([], {}))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert caught.value.status_code == 503
        assert caught.value.headers == {'Retry-After': '30'}

    def test_a_deterministic_archive_search_error_is_not_turned_into_a_503(self, monkeypatch):
        # A retryable 503 here makes a batch client re-embed the manuscript on
        # every retry for an error that will never clear.
        prepare(monkeypatch)

        class BrokenClient(Client):
            def rpc(self, _name, _args):
                raise KeyError('content')

        monkeypatch.setattr(duplication, 'sb', BrokenClient([], {}))
        with pytest.raises(KeyError):
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))

    def test_extraction_and_empty_content_fail_cleanly(self, monkeypatch):
        monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_: 'CCSICT')
        monkeypatch.setattr(duplication, 'extract_document', lambda *_: (_ for _ in ()).throw(ValueError('bad')))
        with pytest.raises(HTTPException) as invalid:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert invalid.value.status_code == 400
        monkeypatch.setattr(duplication, 'extract_document', lambda *_: ExtractedDocument([]))
        with pytest.raises(HTTPException) as empty:
            asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert empty.value.status_code == 400


class TestDuplicationChat:
    def test_missing_and_blocked_scan_chat(self, monkeypatch):
        user = SimpleNamespace(id='u1')
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[]]}))
        with pytest.raises(HTTPException) as missing:
            run_chat(duplication.DuplicationChatReq(scan_id='x', question='Explain'), user)
        assert missing.value.status_code == 404

        scan = {'chat_log': [], 'matched_chunks': []}
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[scan], []]}))
        monkeypatch.setattr(duplication, 'log_activity', lambda *_args, **_kwargs: None)
        blocked = run_chat(
            duplication.DuplicationChatReq(scan_id='x', question='Write my thesis chapter'), user,
        )
        assert blocked['answer'] == duplication.REFUSAL_MESSAGE
        # Finding 12: the refusal used to be rendered and never written back, so
        # reloading the scan lost both the question and the refusal.
        assert [turn['role'] for turn in blocked['chat_log']] == ['user', 'ai']
        assert blocked['chat_log'][0]['content'] == 'Write my thesis chapter'

    def test_grounded_followup_updates_owned_scan(self, monkeypatch):
        scan = {
            'chat_log': [{'role': 'user', 'content': 'Previous'}],
            'verdict_summary': 'Review overlap.',
            'matched_chunks': [{'uploaded_text': '<draft>', 'database_text': '<archive>'}],
        }
        client = Client([], {'scan_history': [[scan], []]})
        monkeypatch.setattr(duplication, 'sb', client)
        monkeypatch.setattr(duplication, 'llm', SimpleNamespace(invoke=lambda _prompt: SimpleNamespace(content='Grounded answer.')))
        response = run_chat(
            duplication.DuplicationChatReq(scan_id='x', question='Explain overlap'),
            SimpleNamespace(id='u1'),
        )
        assert response['answer'] == 'Grounded answer.'
        assert response['chat_log'][-1]['role'] == 'ai'

    def test_followup_names_the_matched_study_instead_of_a_placeholder(self, monkeypatch):
        # 2026-11-25 user testing: with excerpts but no titles, the reviewer
        # wrote "Isabela State University – Main Campus study (20xx)".
        scan = {
            'chat_log': [],
            'verdict_summary': 'Review overlap.',
            'top_matches': [{'id': 'p1', 'title': 'ISU-CANNER', 'authors': 'Dela Cruz, J.', 'year': 2025,
                             'match_count': 3, 'similarity': 91.2}],
            'matched_chunks': [
                {'paper_id': 'p1', 'uploaded_text': 'draft', 'database_text': 'archive', 'archived_section': 'Methodology'},
                {'paper_id': 'gone', 'uploaded_text': 'draft 2', 'database_text': 'archive 2'},
            ],
        }
        seen = []
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[scan], []]}))
        monkeypatch.setattr(duplication, 'llm', SimpleNamespace(
            invoke=lambda prompt: seen.append(prompt) or SimpleNamespace(content='ok')))
        run_chat(duplication.DuplicationChatReq(scan_id='x', question='Which study?'), SimpleNamespace(id='u1'))
        prompt = seen[0]
        assert '"ISU-CANNER" (Dela Cruz, J., 2025): 3 matched passage(s), highest similarity 91.2%' in prompt
        assert 'EXCERPT 1 (from "ISU-CANNER" (Dela Cruz, J., 2025), Methodology)' in prompt
        assert 'EXCERPT 2 (from an archived thesis)' in prompt
        assert 'Never invent' in prompt

    def test_followup_without_matches_says_so(self, monkeypatch):
        scan = {'chat_log': [], 'verdict_summary': 'Clear.', 'matched_chunks': []}
        seen = []
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[scan], []]}))
        monkeypatch.setattr(duplication, 'llm', SimpleNamespace(
            invoke=lambda prompt: seen.append(prompt) or SimpleNamespace(content='ok')))
        run_chat(duplication.DuplicationChatReq(scan_id='x', question='Any overlap?'), SimpleNamespace(id='u1'))
        assert '(no archived study reached the threshold)' in seen[0]

    def test_history_serves_passages_but_never_archived_text(self, monkeypatch):
        row = {
            'id': 's1', 'top_matches': [{'id': 'p1', 'title': 'Known'}],
            'matched_chunks': [{'paper_id': 'p1', 'uploaded_text': 'mine', 'database_text': 'ARCHIVED'}],
        }
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[row]]}))
        [served] = duplication.get_history(SimpleNamespace(id='u1'))
        assert 'matched_chunks' not in served
        assert served['matched_passages'][0]['excerpt'] == 'mine'
        assert 'ARCHIVED' not in str(served)

    def test_history_is_owner_scoped(self, monkeypatch):
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[{'id': 's1'}]]}))
        assert duplication.get_history(SimpleNamespace(id='u1')) == [{'id': 's1'}]

    def test_history_is_bounded_to_the_most_recent_scans(self, monkeypatch):
        # Unbounded, the reply grew with every scan ever run, each row carrying
        # its full write-up and chat log.
        calls = []

        class RecordingQuery(Query):
            def eq(self, *args): calls.append(('eq', args)); return self
            def order(self, *args, **kwargs): calls.append(('order', args, kwargs)); return self
            def limit(self, *args): calls.append(('limit', args)); return self

        class RecordingClient(Client):
            def table(self, name): return RecordingQuery(self.table_rows[name].pop(0))

        monkeypatch.setattr(duplication, 'sb', RecordingClient([], {'scan_history': [[], []]}))
        duplication.get_history(SimpleNamespace(id='u1'))
        assert ('eq', ('user_id', 'u1')) in calls
        assert ('order', ('created_at',), {'desc': True}) in calls
        assert ('limit', (duplication.HISTORY_LIMIT,)) in calls
        duplication.get_history(SimpleNamespace(id='u1'), limit=5)
        assert calls[-1] == ('limit', (5,))

    def test_the_history_limit_is_validated_at_the_http_boundary(self):
        from fastapi.testclient import TestClient  # pylint: disable=import-outside-toplevel
        from main import app  # pylint: disable=import-outside-toplevel
        app.dependency_overrides[duplication.require_novelty_access] = lambda: SimpleNamespace(id='u1')
        try:
            client = TestClient(app)
            assert client.get('/duplication/history', params={'limit': 0}).status_code == 422
            assert client.get('/duplication/history', params={'limit': duplication.HISTORY_LIMIT_MAX + 1}).status_code == 422
        finally:
            app.dependency_overrides.pop(duplication.require_novelty_access, None)

    def test_delete_scan_removes_owned_record(self, monkeypatch):
        client = Client([], {'scan_history': [[{'id': 's1'}], []]})
        monkeypatch.setattr(duplication, 'sb', client)
        result = duplication.delete_scan(delete_request(), 's1', SimpleNamespace(id='u1'))
        assert result == {'deleted': True, 'id': 's1'}

    def test_delete_scan_missing_raises_404(self, monkeypatch):
        client = Client([], {'scan_history': [[]]})
        monkeypatch.setattr(duplication, 'sb', client)
        with pytest.raises(HTTPException) as exc:
            duplication.delete_scan(delete_request(), 'missing', SimpleNamespace(id='u1'))
        assert exc.value.status_code == 404

    def test_delete_scan_reads_a_malformed_id_as_absent(self, monkeypatch):
        """`scan_history.id` is a uuid column, so a mistyped path segment is
        rejected by Postgres instead of matching no rows. That is a 404, not the
        500 the route answered before the guard was added."""
        class Rejecting:
            def table(self, _name): return self
            def select(self, *_a): return self
            def eq(self, *_a): return self
            def limit(self, *_a): return self
            def execute(self):
                raise RuntimeError(
                    'invalid input syntax for type uuid: "not-a-uuid"'
                )

        monkeypatch.setattr(duplication, 'sb', Rejecting())
        with pytest.raises(HTTPException) as exc:
            duplication.delete_scan(delete_request(), 'not-a-uuid', SimpleNamespace(id='u1'))
        assert exc.value.status_code == 404

    def test_delete_scan_still_raises_an_unrelated_database_error(self, monkeypatch):
        """Only the invalid-identifier reading is downgraded; a real outage
        must not be reported to the researcher as a missing record."""
        class Broken:
            def table(self, _name): return self
            def select(self, *_a): return self
            def eq(self, *_a): return self
            def limit(self, *_a): return self
            def execute(self): raise RuntimeError('connection refused')

        monkeypatch.setattr(duplication, 'sb', Broken())
        with pytest.raises(RuntimeError):
            duplication.delete_scan(delete_request(), 's1', SimpleNamespace(id='u1'))

    def test_clear_scan_history_deletes_all_owned_records(self, monkeypatch):
        client = Client([], {'scan_history': [[]]})
        monkeypatch.setattr(duplication, 'sb', client)
        result = duplication.clear_scan_history(delete_request(), SimpleNamespace(id='u1'))
        assert result == {'deleted': True}
