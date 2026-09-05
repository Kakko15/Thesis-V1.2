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
        identity = run(chat._chat_impl(
            ChatRequest(question='Who are you?'), _NoRequest(), BackgroundTasks(), None,
        ))
        assert identity.answer != greeting.answer
        assert 'citation-backed answers' in identity.answer
        assert greeting.notice_type == identity.notice_type == 'conversation'
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
        async def should_not_retrieve(*_args, **_kwargs):
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
        async def should_not_retrieve(*_args, **_kwargs):
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

        async def should_not_retrieve(*_args, **_kwargs):
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

        async def should_not_retrieve(*_args, **_kwargs):
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
    def test_opaque_single_token_does_not_present_unrelated_evidence(self, monkeypatch):
        from services import chat_notices

        sources = [{'id': 'p1', 'title': 'Pedestrian Safety', 'citation_id': 1}]

        async def retrieve(*_args, **_kwargs):
            return ('[1] YOLO pedestrian hazard detection.', sources, 0.62), None

        async def should_not_generate(*_args, **_kwargs):
            raise AssertionError('an opaque token must not reach generation')

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', should_not_generate)
        response = run(chat._chat_impl(
            ChatRequest(question='dsadasd'),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert response.answer == chat_notices.UNCLEAR_TOPIC_MESSAGE
        assert response.sources == []
        assert response.kind == 'notice'

    def test_no_context_returns_explicit_no_result(self, monkeypatch):
        async def retrieve(*_args, **_kwargs): return ('', [], 0.0), None
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
        async def retrieve(*_args, **_kwargs): return ('[1] Evidence\n[2] Other', sources, 0.9), None
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

        async def retrieve(*_args, **_kwargs):
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
        async def retrieve(*_args, **_kwargs): return ('[1] Evidence', sources, 0.9), None
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
        async def retrieve(*_args, **_kwargs): return ('[1] Scope\n[2] Limitations', sources, 0.9), None
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
        async def retrieve(*_args, **_kwargs): return ('[1] Scope and delimitations', sources, 0.9), None
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
        async def retrieve(*_args, **_kwargs): return ('[1] Evidence', sources, 0.9), None
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

        async def retrieve(question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
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

        async def retrieve(question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
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

        async def retrieve(*_args, **_kwargs):
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

        async def retrieve(question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
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

        async def retrieve(_question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
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

        async def retrieve(_question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
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
    def test_edit_truncates_saved_branch_before_persisting_replacement(self, monkeypatch):
        user = SimpleNamespace(id='user-1')
        response = ChatResponse(answer='Replacement [1].', sources=[{'id': 'p1'}])
        calls = []

        monkeypatch.setattr(chat, 'ensure_guest_chat_verification', lambda *_: asyncio.sleep(0))
        monkeypatch.setattr(chat, 'safe_trace', no_trace)
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_: 'CCSICT')

        async def answer(*_args, **_kwargs):
            return response

        monkeypatch.setattr(chat, '_chat_impl', answer)
        monkeypatch.setattr(
            chat,
            '_truncate_session_from_turn',
            lambda session, owner, department, turn: calls.append(
                ('truncate', session, owner, department, turn)
            ),
        )
        monkeypatch.setattr(
            chat,
            '_persist_chat_exchange',
            lambda *_: calls.append(('persist',)) or 'session-1',
        )

        run(chat.chat.__wrapped__.__wrapped__(
            ChatRequest(question='Edited first prompt', session_id='session-1', edit_from_turn=0),
            request(), BackgroundTasks(), user,
        ))

        assert calls == [
            ('truncate', 'session-1', 'user-1', 'CCSICT', 0),
            ('persist',),
        ]

    def test_edit_generation_excludes_the_replaced_and_later_history(self, monkeypatch):
        """The edit position is resolved by the loader, against the session's
        own ordered transcript.

        It used to be applied here instead, as a slice of the five newest
        ANSWER rows the loader returns -- two different coordinate systems. The
        browser counts every stored row as a turn, notices included, so on a
        session past five turns, or holding a single notice, that slice fed the
        model turns from after the edit point or the wrong prefix entirely.
        """
        captured = {}
        history = [
            {'question': 'first', 'answer': 'first answer', 'sources': []},
            {'question': 'second', 'answer': 'second answer', 'sources': []},
        ]

        def load(session_id, user_id, before_turn=None):
            captured['loader_args'] = (session_id, user_id, before_turn)
            return history if before_turn is None else history[:before_turn]

        monkeypatch.setattr(chat, '_ensure_session_owner', lambda *_: None)
        monkeypatch.setattr(chat, '_load_chat_history', load)
        monkeypatch.setattr(chat, 'resolve_effective_department', lambda *_: 'CCSICT')
        original_format = chat._format_chat_history

        def capture_history(messages):
            captured['history_messages'] = messages
            return original_format(messages)

        monkeypatch.setattr(chat, '_format_chat_history', capture_history)

        async def retrieve(question, *_args, **_kwargs):
            captured['question'] = question
            return ('', [], 0.0), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        run(chat._chat_impl(
            ChatRequest(
                question='edited second', session_id='session-1', edit_from_turn=1,
            ),
            _NoRequest(), BackgroundTasks(), SimpleNamespace(id='user-1'),
        ))

        assert captured['question'] == 'edited second'
        # Forwarded, not applied here.
        assert captured['loader_args'] == ('session-1', 'user-1', 1)
        assert captured['history_messages'] == history[:1]

    def test_the_loader_counts_notices_as_turns_when_resolving_an_edit(self, monkeypatch):
        """`before_turn` indexes the FULL transcript, notices included.

        The browser renders every stored row, so the turn it reports counts
        them. The model context must not, which is why the notice below is a
        boundary for counting and never becomes an exchange.
        """
        rows = [
            {'question': 'q1', 'answer': 'a1', 'sources': [], 'kind': 'answer'},
            {'question': 'q2', 'answer': 'a notice', 'sources': [], 'kind': 'notice'},
            {'question': 'q3', 'answer': 'a3', 'sources': [], 'kind': 'answer'},
        ]

        class Query:
            def select(self, *_args): return self
            def eq(self, *_args): return self
            def order(self, *_args, **_kwargs): return self
            def execute(self): return SimpleNamespace(data=rows)

        monkeypatch.setattr(chat, 'sb', SimpleNamespace(table=lambda _name: Query()))
        first = {'question': 'q1', 'answer': 'a1', 'sources': []}
        third = {'question': 'q3', 'answer': 'a3', 'sources': []}

        assert chat._history_before_turn('s1', 3) == [first, third]
        assert chat._history_before_turn('s1', 1) == [first]
        # The notice occupies turn 1, so turn 2 adds a boundary and no exchange.
        assert chat._history_before_turn('s1', 2) == [first]
        assert chat._history_before_turn('s1', 0) == []

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


class TestReportedTranscriptRegressions:
    """Two defects observed in a live 2026-09-02 guest transcript."""

    REMEMBERED = 'Real-Time Autonomous Pedestrian Safety and Hazard Detection Using YOLOv11'
    NAMED = 'A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation'

    def test_a_partial_title_switches_away_from_the_remembered_thesis(self, monkeypatch):
        """A bare partial title used to pin the previous turn's paper and report
        that *it* contains no centralized AI-powered system -- a confident
        answer about the wrong manuscript."""
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [
            {'id': 'p2', 'title': self.REMEMBERED},
        ])
        monkeypatch.setattr(chat, 'find_papers_by_title', lambda *_args: [])
        monkeypatch.setattr(chat, 'find_papers_by_title_fragment', lambda *_args: [
            {'id': 'p1', 'title': self.NAMED, 'authors': 'Barlis, Gallardo'},
        ])
        monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_args: [])
        captured = {}

        async def retrieve(question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
            captured.update(question=question, paper_id=paper_id, is_overview=is_overview)
            return ('[1] Centralized library evidence', [{
                'citation_id': 1, 'id': 'p1', 'chunk_id': 3, 'title': self.NAMED,
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='The library indexes CCSICT theses [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(
                question='what about the A centralized ai powered',
                # The prior turn is what made this a regression: with history
                # present the ambiguous-follow-up branch pins reference_sources[0]
                # — the YOLOv11 paper — unless the fragment resolves first.
                guest_history=['tell me about the objectives of Real Time Autonomous'],
                guest_source_ids=['p2'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert captured['paper_id'] == 'p1'
        # A bare reference carries no question of its own, so it is treated as
        # an overview request exactly like a numbered reference.
        assert captured['is_overview'] is True
        assert self.NAMED in captured['question']
        assert response.sources[0]['id'] == 'p1'

    def test_an_unresolvable_fragment_leaves_followup_handling_untouched(self, monkeypatch):
        """The fragment path must not swallow ordinary follow-ups: when the
        archive does not make the wording unique, the remembered paper is still
        the right referent."""
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [
            {'id': 'p2', 'title': self.REMEMBERED},
        ])
        monkeypatch.setattr(chat, 'find_papers_by_title', lambda *_args: [])
        monkeypatch.setattr(chat, 'find_papers_by_title_fragment', lambda *_args: [])
        # `what about their ...` also reaches the author fast path, which
        # resolves to nothing here and falls through.
        monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_args: [])
        captured = {}

        async def retrieve(question, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
            captured.update(question=question, paper_id=paper_id, is_overview=is_overview)
            return ('[1] evidence', [{
                'citation_id': 1, 'id': 'p2', 'chunk_id': 4, 'title': self.REMEMBERED,
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='It fused KITTI data with urban footage [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        run(chat._chat_impl(
            ChatRequest(
                question='what about their dataset preparation',
                # A follow-up needs a prior turn; without one
                # `is_ambiguous_followup` declines and nothing would be
                # resolved against, fragment or not.
                guest_history=['tell me about the objectives of the YOLOv11 thesis'],
                guest_source_ids=['p2'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert captured['paper_id'] == 'p2'

    def test_a_failed_fragment_lookup_degrades_instead_of_failing_the_turn(self, monkeypatch):
        def unavailable(*_args):
            raise RuntimeError('archive unavailable')

        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [])
        monkeypatch.setattr(chat, 'find_papers_by_title', lambda *_args: [])
        monkeypatch.setattr(chat, 'find_papers_by_title_fragment', unavailable)

        async def retrieve(_question, _department, paper_id, _is_overview, _category=None, per_paper_cap=None):
            assert paper_id is None
            return ('[1] evidence', [{
                'citation_id': 1, 'id': 'p9', 'chunk_id': 5, 'title': 'Some thesis',
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='One archived study is relevant [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='what about the A centralized ai powered'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.sources[0]['id'] == 'p9'

    def test_self_directed_provenance_never_searches_the_archive(self, monkeypatch):
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError('provenance questions must not run vector retrieval')

        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='Who developed you?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == chat.chat_notices.SYSTEM_ORIGIN_MESSAGE
        assert response.sources == []
        assert response.no_relevant_thesis is False

    def test_this_system_is_provenance_only_when_nothing_else_can_be_meant(self, monkeypatch):
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError('provenance questions must not run vector retrieval')

        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [])
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='who developed this system?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == chat.chat_notices.SYSTEM_ORIGIN_MESSAGE

    def test_this_system_stays_a_research_question_once_a_thesis_is_on_the_table(self, monkeypatch):
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: [
            {'id': 'p2', 'title': self.REMEMBERED},
        ])
        captured = {}

        async def retrieve(_question, _department, paper_id, _is_overview, _category=None, per_paper_cap=None):
            captured.update(paper_id=paper_id)
            return ('[1] evidence', [{
                'citation_id': 1, 'id': 'p2', 'chunk_id': 6, 'title': self.REMEMBERED,
            }], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='The detector was built on YOLOv11 [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(
                question='who developed this system?',
                guest_history=['tell me about the objectives of the YOLOv11 thesis'],
                guest_source_ids=['p2'],
            ),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert response.answer != chat.chat_notices.SYSTEM_ORIGIN_MESSAGE
        # "this system" resolved to the manuscript under discussion, which is
        # what the provenance intercept must never take away.
        assert captured['paper_id'] == 'p2'


class TestTheResponseCarriesItsKindLive:
    """The `kind` field on ChatResponse (stamped by `_chat_impl`).

    Before it, a live capacity apology or refusal was visually identical to a
    research answer: `chat_messages.kind` classified the row only at persist
    time, so the distinction appeared after a reload and never for guests.
    The stamp uses the same classifier persistence uses, so the live field and
    the stored column can never disagree.
    """

    def test_a_grounded_answer_is_stamped_as_an_answer(self, monkeypatch):
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'}]
        async def retrieve(*_args, **_kwargs): return ('[1] Evidence', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='The study used RAG [1].'), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='What method did the study use?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.kind == 'answer'

    def test_fast_path_notices_are_stamped_as_notices(self):
        # The model-identity reply is deliberately absent: it is a dynamic
        # string, not a notice constant, so persistence stores it as an
        # answer, and the live stamp must agree with persistence exactly.
        for question in ('Hello', 'Write my entire thesis methodology chapter'):
            response = run(chat._chat_impl(
                ChatRequest(question=question),
                _NoRequest(), BackgroundTasks(), None,
            ))
            assert response.kind == 'notice', question

    def test_an_empty_retrieval_is_stamped_as_a_notice(self, monkeypatch):
        async def retrieve(*_args, **_kwargs): return ('', [], 0.0), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='What methods were used?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.no_relevant_thesis is True
        assert response.kind == 'notice'

    def test_the_stamp_matches_what_persistence_would_store(self, monkeypatch):
        from services import chat_notices
        sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'}]
        async def retrieve(*_args, **_kwargs): return ('[1] Evidence', sources, 0.9), None
        async def generate(*_args): return SimpleNamespace(content='Grounded [1].'), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        response = run(chat._chat_impl(
            ChatRequest(question='What method did the study use?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.kind == chat_notices.response_kind(response)

    def test_the_model_defaults_to_answer_for_old_payloads(self):
        assert ChatResponse(answer='x').kind == 'answer'


class TestQuestionTypeReachesRetrievalAndPrompt:
    """An aggregate question samples distinct theses and gets its TASK block."""

    def test_aggregate_question_caps_one_chunk_per_paper(self, monkeypatch):
        captured = {}

        async def retrieve(question, department, referenced, is_overview,
                           category=None, per_paper_cap=None):
            captured['per_paper_cap'] = per_paper_cap
            sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'}]
            return ('[1] Evidence', sources, 0.9), None

        async def generate(prompt_template, *_args):
            captured['system'] = prompt_template.messages[0].prompt.template
            return SimpleNamespace(content='Of the retrieved studies, one uses CNN [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        run(chat._chat_impl(
            ChatRequest(question='Which technique is most commonly used in the theses?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert captured['per_paper_cap'] == 1
        from services import prompts
        assert prompts.QUESTION_TYPE_TASKS['aggregate'] in captured['system']

    def test_a_plain_question_keeps_the_untyped_pipeline(self, monkeypatch):
        captured = {}

        async def retrieve(question, department, referenced, is_overview,
                           category=None, per_paper_cap=None):
            captured['per_paper_cap'] = per_paper_cap
            sources = [{'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'One'}]
            return ('[1] Evidence', sources, 0.9), None

        async def generate(prompt_template, *_args):
            captured['system'] = prompt_template.messages[0].prompt.template
            return SimpleNamespace(content='The study used RAG [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        run(chat._chat_impl(
            ChatRequest(question='Tell me about thesis research on flood prediction.'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert captured['per_paper_cap'] is None
        assert 'TASK:' not in captured['system']


class TestCapabilityAndCourtesyFastPaths:
    """Both answer deterministically: no retrieval, no generation, kind='notice'."""

    def test_capability_question_answers_without_rag(self, monkeypatch):
        from services import chat_notices
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError('capability questions must not run vector retrieval')
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='What can you do?'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == chat_notices.CAPABILITIES_MESSAGE
        assert response.sources == []
        assert response.kind == 'notice'
        assert response.notice_type == 'conversation'

    def test_courtesy_message_answers_without_rag(self, monkeypatch):
        from services import chat_notices
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError('a thank-you must not run vector retrieval')
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='Thank you!'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == chat_notices.COURTESY_MESSAGE
        assert response.sources == []
        assert response.kind == 'notice'
        assert response.notice_type == 'conversation'

    def test_farewell_has_a_distinct_local_response(self, monkeypatch):
        from services import chat_notices
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError('a goodbye must not run vector retrieval')
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)
        response = run(chat._chat_impl(
            ChatRequest(question='Goodbye'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert response.answer == chat_notices.FAREWELL_MESSAGE
        assert response.answer != chat_notices.COURTESY_MESSAGE
        assert response.sources == []
        assert response.kind == 'notice'
        assert response.notice_type == 'conversation'

    def test_repeated_farewells_rotate_without_generation(self, monkeypatch):
        from services import chat_notices
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError('a goodbye must not run vector retrieval')
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)

        first = run(chat._chat_impl(
            ChatRequest(question='Goodbye'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        second = run(chat._chat_impl(
            ChatRequest(question='Goodbye', conversation_replies=[first.answer]),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert first.answer == chat_notices.FAREWELL_MESSAGES[0]
        assert second.answer == chat_notices.FAREWELL_MESSAGES[1]
        assert first.answer != second.answer

    def test_apostrophe_farewell_never_searches_the_archive(self, monkeypatch):
        from services import chat_notices
        async def should_not_retrieve(*_args, **_kwargs):
            raise AssertionError("that's all must not run vector retrieval")
        monkeypatch.setattr(chat, '_retrieve_evidence', should_not_retrieve)

        response = run(chat._chat_impl(
            ChatRequest(question="That's all"),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert response.answer in chat_notices.FAREWELL_MESSAGES
        assert response.sources == []
        assert response.kind == 'notice'
        assert response.notice_type == 'conversation'

    def test_a_research_question_mentioning_help_still_retrieves(self, monkeypatch):
        called = {}
        async def retrieve(*_args, **_kwargs):
            called['yes'] = True
            return ('', [], 0.0), None
        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        run(chat._chat_impl(
            ChatRequest(question='help me find theses about OCR accuracy'),
            _NoRequest(), BackgroundTasks(), None,
        ))
        assert called.get('yes') is True


class TestNumberedReferenceInsideAQuestion:
    """The 2026-09-04 transcript: after an inventory listing two theses, "what
    are the objectives of number 2" answered about thesis [1] and read
    "number 2" as its second objective. The reference must select thesis [2]
    and vanish from the wording the model sees."""

    REFERENCES = [
        {'id': 'p1', 'title': 'A Centralized AI-Powered Thesis Library Using RAG',
         'authors': 'Ahron John F. Barlis, Carlo Rossi P. Gallardo'},
        {'id': 'p2', 'title': 'Real-Time Autonomous Pedestrian Safety and Hazard Detection Using YOLOv11',
         'authors': 'Franklyn Bugauisan, William Respicio'},
    ]

    def _run(self, monkeypatch, question):
        captured = {}
        monkeypatch.setattr(chat, 'find_papers_by_ids', lambda *_args: self.REFERENCES)
        monkeypatch.setattr(chat, 'find_papers_by_title', lambda *_args: [])
        monkeypatch.setattr(chat, 'find_papers_by_title_fragment', lambda *_args: [])
        monkeypatch.setattr(chat, 'find_papers_by_author', lambda *_args: [])

        async def retrieve(q, _department, paper_id, is_overview, _category=None, per_paper_cap=None):
            captured.update(question=q, paper_id=paper_id, is_overview=is_overview)
            return ('[1] Evidence', [{'citation_id': 1, 'id': 'p2', 'chunk_id': 1, 'title': 'x'}], 1.0), None

        async def generate(*_args):
            return SimpleNamespace(content='The objectives are stated [1].'), None

        monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)
        monkeypatch.setattr(chat, '_invoke_generation', generate)
        run(chat._chat_impl(
            ChatRequest(question=question, guest_history=['what are the theses on this system?'],
                        guest_source_ids=['p1', 'p2']),
            _NoRequest(), BackgroundTasks(), None,
        ))
        return captured

    def test_the_transcript_question_selects_the_second_listed_thesis(self, monkeypatch):
        captured = self._run(monkeypatch, 'what are the objectives of number 2')
        assert captured['paper_id'] == 'p2'
        assert captured['is_overview'] is False, 'a specific question, not an overview'
        assert 'YOLOv11' in captured['question']
        assert 'number 2' not in captured['question'].lower()
        assert 'Centralized' not in captured['question']

    def test_an_ordinal_inside_a_question_resolves_the_same_way(self, monkeypatch):
        captured = self._run(monkeypatch, 'What methodology did the second thesis use?')
        assert captured['paper_id'] == 'p2'
        assert 'YOLOv11' in captured['question']
        assert 'second thesis' not in captured['question'].lower()

    def test_an_ambiguous_followup_after_several_theses_answers_for_each(self, monkeypatch):
        # No thesis singled out: answer for both, labelled, rather than
        # silently picking the first.
        captured = self._run(monkeypatch, 'what are the objectives?')
        assert captured['paper_id'] == ['p1', 'p2']
        assert captured['question'] == 'what are the objectives?'

    def test_what_is_that_thesis_about_after_several_gives_each_an_overview(self, monkeypatch):
        captured = self._run(monkeypatch, 'what is that thesis about?')
        assert captured['paper_id'] == ['p1', 'p2']
        assert captured['is_overview'] is True
        assert 'YOLOv11' in captured['question'] and 'Centralized' in captured['question']
