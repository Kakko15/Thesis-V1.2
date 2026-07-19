import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request, UploadFile

from models import ChatRequest
from routers import duplication
from services.document_processor import ExtractedDocument, ExtractedPage


class Query:
    def __init__(self, data): self.data = data; self.payload = None
    def select(self, *_args): return self
    def eq(self, *_args): return self
    def in_(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def update(self, payload): self.payload = payload; return self
    def insert(self, payload): self.payload = payload; return self
    def execute(self): return SimpleNamespace(data=self.data)


class Client:
    def __init__(self, rpc_rows, table_rows):
        self.rpc_rows = list(rpc_rows)
        self.table_rows = {name: list(values) for name, values in table_rows.items()}
    def rpc(self, _name, _args): return Query(self.rpc_rows.pop(0))
    def table(self, name): return Query(self.table_rows[name].pop(0))


def upload_file():
    return UploadFile(filename='draft.pdf', file=__import__('io').BytesIO(b'%PDF-dummy'))


def request():
    return Request({
        'type': 'http', 'method': 'POST', 'path': '/duplication/scan',
        'headers': [], 'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


async def run_scan(file, department, user):
    endpoint = getattr(duplication.scan_duplication, '__wrapped__', duplication.scan_duplication)
    return await endpoint(request(), file, department, user)


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


class TestNoveltyScan:
    def test_clear_scan_has_deterministic_metrics(self, monkeypatch):
        prepare(monkeypatch)
        client = Client([[]], {'scan_history': [[]]})
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
            'scan_history': [[]],
        })
        monkeypatch.setattr(duplication, 'sb', client)
        monkeypatch.setattr(duplication, 'llm', SimpleNamespace(invoke=lambda _prompt: SimpleNamespace(content='Faculty review advised.')))
        response = asyncio.run(run_scan(upload_file(), None, SimpleNamespace(id='u1')))
        assert response['highest_similarity'] == 90
        assert response['matched_chunk_percentage'] == 100
        assert response['verdict_level'] == 'high_overlap'
        assert response['verdict_summary'] == 'Faculty review advised.'
        assert 'matched_chunks' not in response

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
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[scan]]}))
        monkeypatch.setattr(duplication, 'log_activity', lambda *_args, **_kwargs: None)
        blocked = run_chat(
            duplication.DuplicationChatReq(scan_id='x', question='Write my thesis chapter'), user,
        )
        assert blocked['answer'] == duplication.REFUSAL_MESSAGE

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

    def test_history_is_owner_scoped(self, monkeypatch):
        monkeypatch.setattr(duplication, 'sb', Client([], {'scan_history': [[{'id': 's1'}]]}))
        assert duplication.get_history(SimpleNamespace(id='u1')) == [{'id': 's1'}]
