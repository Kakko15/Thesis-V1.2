import asyncio
import inspect
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException, Request

from models import ChatRequest, ChatResponse
from routers import chat


def run(coro):
    return asyncio.run(coro)


class _NoRequest:
    headers = {}


def request():
    return Request({
        'type': 'http', 'method': 'POST', 'path': '/chat', 'headers': [],
        'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


@asynccontextmanager
async def no_trace(*_args, **_kwargs):
    yield None


class TestEarlyChatPaths:
    def test_greeting_and_blocked_generation(self):
        greeting = run(chat._chat_impl(ChatRequest(question='Hello'), _NoRequest(), BackgroundTasks(), None))
        assert 'IskAI' in greeting.answer and greeting.sources == []
        friendly_greeting = run(chat._chat_impl(
            ChatRequest(question='hello dear'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert 'IskAI' in friendly_greeting.answer
        assert friendly_greeting.sources == []
        assert friendly_greeting.no_relevant_thesis is False
        blocked = run(chat._chat_impl(
            ChatRequest(question='Write my entire thesis methodology chapter'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert blocked.answer == chat.REFUSAL_MESSAGE

    def test_author_metadata_fast_path(self, monkeypatch):
        monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_: [{
            'id': 'p1', 'title': 'Archive Study',
            'authors': 'Ahron Barlis, Carlo Gallardo', 'track': 'Data Mining',
        }])
        response = run(chat._chat_impl(
            ChatRequest(question='Who is Carlo Gallardo?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert 'co-author' in response.answer and response.sources[0]['id'] == 'p1'

    def test_capacity_circuit_breaker(self, monkeypatch):
        monkeypatch.setattr(chat, '_capacity_limit_is_active', lambda: True)
        response = run(chat._chat_impl(
            ChatRequest(question='What methods were used?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.sources == []
        assert 'usage limit' in response.answer.lower()


class TestRetrievalAndGenerationFlow:
    def test_no_context_returns_explicit_no_result(self, monkeypatch):
        async def retrieve(*_args): return ('', [], 0.0), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='What quantum theses exist?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.no_relevant_thesis is True
        assert response.sources == []

    def test_supported_answer_uses_only_cited_sources(self, monkeypatch):
        sources = [
            {'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'},
            {'citation_id': 2, 'id': 'p2', 'chunk_id': 2, 'title': 'Two'},
        ]
        async def retrieve(*_args): return ('[1] Evidence\n[2] Other', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='The study used RAG [1].'), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='What method did the study use?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer.endswith('[1].')
        assert [source['id'] for source in response.sources] == ['p1']

    def test_invalid_answer_repairs_once(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'}]
        async def retrieve(*_args): return ('[1] Evidence', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='An uncited factual answer.'), None
        async def repair(*_args): return 'A repaired factual answer [1].'
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        monkeypatch.setattr(chat, '_repair_citations', repair)
        response = run(chat._chat_impl(
            ChatRequest(question='Explain the archived method.'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == 'A repaired factual answer [1].'

    def test_grouped_markers_from_repair_are_normalized(self, monkeypatch):
        sources = [
            {'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'},
            {'citation_id': 2, 'id': 'p1', 'chunk_id': 2, 'title': 'One'},
        ]
        async def retrieve(*_args): return ('[1] Scope\n[2] Limitations', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='An uncited scope answer.'), None
        async def repair(*_args): return 'The study has defined scope and limitations [1, 2].'
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        monkeypatch.setattr(chat, '_repair_citations', repair)
        response = run(chat._chat_impl(
            ChatRequest(question='What are the scope and limitations?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == 'The study has defined scope and limitations [1] [2].'
        assert [source['citation_id'] for source in response.sources] == [1, 2]

    def test_incomplete_ai_repair_gets_deterministic_coverage(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 5, 'title': 'One'}]
        async def retrieve(*_args): return ('[1] Scope and delimitations', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='An uncited answer.'), None
        async def repair(*_args): return 'The scope covers CCSICT [1].\n\nExternal studies are excluded.'
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        monkeypatch.setattr(chat, '_repair_citations', repair)
        response = run(chat._chat_impl(
            ChatRequest(question='What are the scope and limitations?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == (
            'The scope covers CCSICT [1].\n\nExternal studies are excluded. [1]'
        )
        assert response.sources == sources

    def test_model_no_evidence_discards_sources(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'}]
        async def retrieve(*_args): return ('[1] Evidence', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='I cannot verify that from the evidence.'), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='What unrelated claim is true?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.no_relevant_thesis and response.sources == []


class TestTracingBoundaries:
    def test_retrieve_evidence_exact_and_semantic_paths(self, monkeypatch):
        monkeypatch.setattr(chat, 'get_paper_overview_context', lambda *_: ('exact', [], 1.0))
        exact, alert = run(chat._retrieve_evidence('question', 'CCSICT', 'p1', False))
        assert exact[0] == 'exact' and alert is None

        monkeypatch.setattr(chat, 'embed_text', lambda _q: [0.1])
        monkeypatch.setattr(chat, 'search_chunks', lambda *_: ('semantic', [], 0.5))
        monkeypatch.setattr(chat, 'check_topic_duplication', lambda *_: {'flagged': True})
        semantic, alert = run(chat._retrieve_evidence('question', 'CCSICT', None, False))
        assert semantic[0] == 'semantic' and alert['flagged']

    def test_generation_helper_with_and_without_duplication(self, monkeypatch):
        class Chain:
            async def ainvoke(self, _input): return SimpleNamespace(content='Answer [1].')
        class Prompt:
            def __or__(self, _llm): return Chain()
        monkeypatch.setattr(chat, '_summarize_duplication', lambda _alert: _async_value('summary'))
        result, summary = run(chat._invoke_generation(Prompt(), {}, {'flagged': True}))
        assert result.content and summary == 'summary'
        _result, summary = run(chat._invoke_generation(Prompt(), {}, None))
        assert summary is None


class TestChatPersistence:
    def test_session_department_mismatch_is_rejected(self, monkeypatch):
        class Query:
            def select(self, *_args): return self
            def eq(self, *_args): return self
            def limit(self, *_args): return self
            def execute(self):
                return SimpleNamespace(data=[{'id': 's1', 'department': 'CAS'}])

        monkeypatch.setattr(chat, 'sb', SimpleNamespace(table=lambda _name: Query()))
        with pytest.raises(HTTPException) as mismatch:
            chat._ensure_session_owner('s1', 'u1', 'CCSICT')
        assert mismatch.value.status_code == 409

    def test_authenticated_exchange_is_saved_atomically(self, monkeypatch):
        async def implementation(*_args):
            return ChatResponse(answer='Grounded [1].', sources=[{'id': 'p1'}])

        monkeypatch.setattr(chat, '_chat_impl', implementation)
        monkeypatch.setattr(chat, 'safe_trace', no_trace)
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, '_persist_chat_exchange', lambda *_args: 'session-1')
        endpoint = inspect.unwrap(chat.chat)
        response = run(endpoint(
            ChatRequest(question='Explain the method'),
            request(),
            BackgroundTasks(),
            SimpleNamespace(id='u1'),
        ))
        assert response.session_id == 'session-1'
        assert response.history_saved is True

    def test_guest_exchange_is_never_reported_as_saved(self, monkeypatch):
        async def implementation(*_args):
            return ChatResponse(answer='No relevant thesis.', no_relevant_thesis=True)

        monkeypatch.setattr(chat, '_chat_impl', implementation)
        monkeypatch.setattr(chat, 'safe_trace', no_trace)
        endpoint = inspect.unwrap(chat.chat)
        response = run(endpoint(
            ChatRequest(question='Explain the method'),
            request(),
            BackgroundTasks(),
            None,
        ))
        assert response.session_id is None
        assert response.history_saved is False

    def test_persistence_failure_is_disclosed_to_the_client(self, monkeypatch):
        async def implementation(*_args):
            return ChatResponse(answer='Grounded [1].', sources=[{'id': 'p1'}])

        def fail(*_args):
            raise RuntimeError('database unavailable')

        monkeypatch.setattr(chat, '_chat_impl', implementation)
        monkeypatch.setattr(chat, 'safe_trace', no_trace)
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, '_persist_chat_exchange', fail)
        endpoint = inspect.unwrap(chat.chat)
        response = run(endpoint(
            ChatRequest(question='Explain the method'),
            request(),
            BackgroundTasks(),
            SimpleNamespace(id='u1'),
        ))
        assert response.session_id is None
        assert response.history_saved is False


async def _async_value(value):
    return value
