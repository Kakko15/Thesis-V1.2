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

    def test_model_identity_does_not_search_the_archive(self, monkeypatch):
        async def should_not_retrieve(*_args):
            raise AssertionError('model identity must not run vector retrieval')
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='what model are you?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert chat.settings.gemini_chat_model in response.answer
        assert response.sources == []

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

    def test_archive_inventory_uses_live_metadata_without_rag(self, monkeypatch):
        papers = [
            {
                'citation_id': 1, 'id': 'p1', 'title': 'Archive Study One',
                'authors': 'Author One', 'track': 'Data Mining', 'department': 'CCSICT',
            },
            {
                'citation_id': 2, 'id': 'p2', 'title': 'Archive Study Two',
                'authors': 'Author Two', 'year': 2025, 'department': 'CCSICT',
            },
        ]
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, 'list_archive_papers', lambda *_args: (len(papers), papers))
        async def should_not_retrieve(*_args):
            raise AssertionError('inventory requests must not run vector retrieval')
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)

        response = run(chat._chat_impl(
            ChatRequest(question='Is there any thesis other than that?'),
            _NoRequest(), BackgroundTasks(), SimpleNamespace(id='u1'),
        ))

        assert '**2 indexed theses**' in response.answer
        assert [source['id'] for source in response.sources] == ['p1', 'p2']

    def test_count_followup_lists_theses_instead_of_retrieving_prior_manuscript(self, monkeypatch):
        papers = [
            {'citation_id': 1, 'id': 'p1', 'title': 'Archive Study One', 'authors': 'Author One'},
            {'citation_id': 2, 'id': 'p2', 'title': 'Archive Study Two', 'authors': 'Author Two'},
        ]
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, 'list_archive_papers', lambda *_args: (len(papers), papers))

        async def should_not_retrieve(*_args):
            raise AssertionError('count follow-ups must list the live archive, not retrieve a manuscript')

        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(
                question='what are those, can you named it',
                guest_history=['How many theses are on this thesis library system?'],
                guest_source_ids=['p1'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert 'Archive Study One' in response.answer
        assert 'Archive Study Two' in response.answer
        assert [source['id'] for source in response.sources] == ['p1', 'p2']

    def test_count_confirmation_rechecks_live_total_without_manuscript_retrieval(self, monkeypatch):
        papers = [
            {'citation_id': 1, 'id': 'p1', 'title': 'Archive Study One', 'authors': 'Author One'},
            {'citation_id': 2, 'id': 'p2', 'title': 'Archive Study Two', 'authors': 'Author Two'},
        ]
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, 'list_archive_papers', lambda *_args: (len(papers), papers))

        async def should_not_retrieve(*_args):
            raise AssertionError('count confirmations must read live metadata, not a manuscript')

        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(
                question='only two for now?',
                guest_history=['How many theses are on this thesis library system?'],
                guest_source_ids=['p1', 'p2'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert '**2 indexed theses**' in response.answer
        assert 'Archive Study One' not in response.answer
        assert response.sources == []


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
        assert response.archive_current is True

    def test_repeated_question_uses_newly_available_current_evidence(self, monkeypatch):
        calls = 0

        async def retrieve(*_args):
            nonlocal calls
            calls += 1
            paper_id = 'p1' if calls == 1 else 'p2'
            title = 'Earlier Thesis' if calls == 1 else 'Newly Indexed Thesis'
            return ('[1] Current evidence', [{
                'citation_id': 1, 'id': paper_id, 'chunk_id': calls, 'title': title,
            }], 0.9), None

        async def generate(*_args):
            return SimpleNamespace(content='The current evidence supports this finding [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        first = run(chat._chat_impl(
            ChatRequest(question='What systems support campus safety?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        second = run(chat._chat_impl(
            ChatRequest(question='What systems support campus safety?'),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert calls == 2
        assert first.sources[0]['id'] == 'p1'
        assert second.sources[0]['id'] == 'p2'
        assert second.archive_current is True

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

    def test_uncited_no_evidence_answer_falls_back_to_the_generic_notice(self, monkeypatch):
        """An answer that reports no evidence AND cites nothing has nothing worth
        keeping, so it still becomes the generic message with no sources. The
        cited case is covered in tests/test_prompt_contracts.py.
        """
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

    def test_numbered_guest_followup_retrieves_the_selected_thesis(self, monkeypatch):
        references = [
            {'id': 'p1', 'title': 'First Thesis', 'authors': 'Author One'},
            {'id': 'p2', 'title': 'Second Thesis', 'authors': 'Author Two'},
        ]
        captured = {}
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: references)

        async def retrieve(question, _department, paper_id, is_overview, _category=None):
            captured.update(question=question, paper_id=paper_id, is_overview=is_overview)
            return ('[1] Second thesis evidence', [{
                'citation_id': 1, 'id': 'p2', 'chunk_id': 1, 'title': 'Second Thesis',
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='Second Thesis evaluates a verified system [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='tell me about number 2', guest_source_ids=['p1', 'p2']),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert captured['paper_id'] == 'p2'
        assert captured['is_overview'] is True
        assert 'Second Thesis' in captured['question']
        assert response.sources[0]['id'] == 'p2'

    def test_plural_guest_followup_retrieves_and_cites_both_presented_theses(self, monkeypatch):
        references = [
            {'id': 'p1', 'title': 'First Thesis', 'authors': 'Author One'},
            {'id': 'p2', 'title': 'Second Thesis', 'authors': 'Author Two'},
        ]
        captured = {}
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: references)

        async def retrieve(question, _department, paper_id, is_overview, _category=None):
            captured.update(question=question, paper_id=paper_id, is_overview=is_overview)
            return ('[1] First objective\n[2] Second objective', [
                {'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'First Thesis'},
                {'citation_id': 2, 'id': 'p2', 'chunk_id': 2, 'title': 'Second Thesis'},
            ], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content=(
                'First Thesis has objective A [1].\n\nSecond Thesis has objective B [2].'
            )), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(
                question='what are their general objectives?',
                guest_source_ids=['p1', 'p2'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert captured['paper_id'] == ['p1', 'p2']
        assert captured['is_overview'] is False
        assert [source['id'] for source in response.sources] == ['p1', 'p2']

    def test_plural_answer_is_repaired_when_generation_uses_only_the_first_thesis(self, monkeypatch):
        references = [
            {'id': 'p1', 'title': 'First Thesis'},
            {'id': 'p2', 'title': 'Second Thesis'},
        ]
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: references)

        async def retrieve(*_args):
            return ('[1] First evidence\n[2] Second evidence', [
                {'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'First Thesis'},
                {'citation_id': 2, 'id': 'p2', 'chunk_id': 2, 'title': 'Second Thesis'},
            ], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='Only First Thesis was answered [1].'), None

        async def repair(*_args):
            return 'First Thesis has one program [1].\n\nSecond Thesis has another program [2].'

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        monkeypatch.setattr(chat, '_repair_multi_paper_coverage', repair)
        response = run(chat._chat_impl(
            ChatRequest(
                question='those two theses, what course and program are they for?',
                guest_source_ids=['p1', 'p2'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert [source['id'] for source in response.sources] == ['p1', 'p2']
        assert 'Second Thesis' in response.answer

    def test_explicit_title_overrides_the_latest_remembered_thesis(self, monkeypatch):
        title = 'Real-Time Autonomous Pedestrian Safety and Hazard Detection Using YOLOv11'
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [{
            'id': 'p1', 'title': 'A Centralized AI-Powered Thesis Library',
        }])
        monkeypatch.setattr(chat, 'find_papers_by_title', lambda *_args: [{
            'id': 'p2', 'title': title,
        }])
        captured = {}

        async def retrieve(question, _department, paper_id, is_overview, _category=None):
            captured.update(question=question, paper_id=paper_id, is_overview=is_overview)
            return ('[1] YOLOv11 evidence', [{
                'citation_id': 1, 'id': 'p2', 'chunk_id': 2, 'title': title,
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='The named thesis detects pedestrian hazards [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(
                question=f'what about the other thesis "{title}"?',
                guest_source_ids=['p1'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert captured['paper_id'] == 'p2'
        assert captured['is_overview'] is False
        assert response.sources[0]['id'] == 'p2'

    def test_numbered_session_followup_uses_the_last_answer_source_order(self, monkeypatch):
        references = [
            {'id': 'p1', 'title': 'First Thesis', 'authors': 'Author One'},
            {'id': 'p2', 'title': 'Second Thesis', 'authors': 'Author Two'},
        ]
        captured = {}
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, '_ensure_session_owner', lambda *_args: None)
        monkeypatch.setattr(chat, '_load_chat_history', lambda *_args: [{
            'question': 'What are the theses on this system?',
            'answer': '1. First Thesis [1]\n2. Second Thesis [2]',
            'sources': references,
        }])
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: references)

        async def retrieve(_question, _department, paper_id, is_overview, _category=None):
            captured.update(paper_id=paper_id, is_overview=is_overview)
            return ('[1] Second thesis evidence', [{
                'citation_id': 1, 'id': 'p2', 'chunk_id': 1, 'title': 'Second Thesis',
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='Second Thesis evaluates a verified system [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='tell me about the second thesis', session_id='s1'),
            _NoRequest(), BackgroundTasks(), SimpleNamespace(id='u1'),
        ))

        assert captured == {'paper_id': 'p2', 'is_overview': True}
        assert response.sources[0]['id'] == 'p2'

    def test_numbered_session_followup_ignores_sources_from_older_answers(self, monkeypatch):
        latest_reference = {'id': 'p2', 'title': 'Latest Thesis', 'authors': 'Author Two'}
        captured = {}
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(chat, '_ensure_session_owner', lambda *_args: None)
        monkeypatch.setattr(chat, '_load_chat_history', lambda *_args: [
            {'question': 'Older list', 'answer': 'First Thesis [1]', 'sources': [{'id': 'p1'}]},
            {'question': 'Latest answer', 'answer': 'Latest Thesis [1]', 'sources': [latest_reference]},
        ])

        def find_references(ids, _department):
            captured['source_ids'] = ids
            return [latest_reference]

        monkeypatch.setattr(chat, 'find_papers_by_ids', find_references)

        async def retrieve(_question, _department, paper_id, is_overview, _category=None):
            captured.update(paper_id=paper_id, is_overview=is_overview)
            return ('[1] Latest thesis evidence', [{
                'citation_id': 1, 'id': 'p2', 'chunk_id': 1, 'title': 'Latest Thesis',
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='Latest Thesis evaluates a verified system [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='tell me about number 1', session_id='s1'),
            _NoRequest(), BackgroundTasks(), SimpleNamespace(id='u1'),
        ))

        assert captured['source_ids'] == ['p2']
        assert captured['paper_id'] == 'p2'
        assert captured['is_overview'] is True
        assert response.sources[0]['id'] == 'p2'


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

    def test_retrieve_evidence_merges_multiple_exact_papers_with_unique_citations(self, monkeypatch):
        def exact_context(paper_id, *_args):
            return (
                '[1] Evidence',
                [{'citation_id': 1, 'id': paper_id, 'chunk_id': paper_id, 'title': paper_id}],
                1.0,
            )

        monkeypatch.setattr(chat, 'get_paper_overview_context', exact_context)
        result, alert = run(chat._retrieve_evidence('question', 'CCSICT', ['p1', 'p2'], False))

        assert alert is None
        assert result[0] == '[1] Evidence\n\n[2] Evidence'
        assert [(source['id'], source['citation_id']) for source in result[1]] == [('p1', 1), ('p2', 2)]

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
        async def implementation(*_args, **_kwargs):
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
        async def implementation(*_args, **_kwargs):
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
        async def implementation(*_args, **_kwargs):
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
