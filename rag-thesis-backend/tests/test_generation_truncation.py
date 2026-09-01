"""A reply severed at the output ceiling must never be served as finished work.

The repair ladder in `routers/chat.py` exists to restore citation markers to an
answer that lost them. Against a *truncated* answer it does something else
entirely: the surviving units keep their markers, `enforce_citation_coverage`
staples one onto whatever is left uncited, validation passes, and the fragment
is returned as a complete, cited answer. Nothing downstream -- not the reader,
not `filter_cited_sources`, not a Ragas Answer Correctness score -- can tell it
from a genuinely short answer.

Measured on 2026-09-02 against the configured gateway, one grounded reply spent
1,920 of its 1,996 output tokens reasoning, returned `finish_reason=length`,
announced "two distinct systems", described one, and was served with citations
after two repair passes. The same question answered completely against Google in
943 tokens. The provider's own stop reason is the only signal separating the two
cases, so it is read once and acted on before the ladder runs.
"""

from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks

from models import ChatRequest
from routers import chat
from services import chat_notices
from services.llm_output import TruncatedGeneration, finish_reason, is_truncated

from .test_chat_endpoint_flows import _NoRequest, run

SOURCES = [
    {'citation_id': 1, 'id': 'p1', 'chunk_id': 1, 'title': 'Pedestrian Safety Study'},
    {'citation_id': 2, 'id': 'p2', 'chunk_id': 2, 'title': 'Thesis Library Study'},
]

# The shape the gateway actually returned when it severed a reply: a well-formed
# opening that reads as complete and stops mid-clause.
SEVERED = 'The retrieved archives detail two distinct systems [1]:\n\n- The first system'


def reply(content: str, reason: str | None):
    metadata = {} if reason is None else {'finish_reason': reason}
    return SimpleNamespace(content=content, response_metadata=metadata)


@pytest.fixture
def retrieval(monkeypatch):
    async def retrieve(*_args):
        return ('[1] Evidence one\n[2] Evidence two', SOURCES, 0.9), None
    monkeypatch.setattr(chat, '_retrieve_evidence', retrieve)


@pytest.fixture
def repair_spy(monkeypatch):
    """Records every citation-repair call the flow attempts."""
    calls = []

    async def repair(answer, _context, _sources):
        calls.append(answer)
        return 'Repaired text [1].'

    monkeypatch.setattr(chat, '_repair_citations', repair)
    return calls


class TestTruncationDetection:
    """One helper, both providers. They disagree on spelling and on case."""

    @pytest.mark.parametrize('reason', ['MAX_TOKENS', 'max_tokens', 'length', 'LENGTH'])
    def test_either_providers_ceiling_reason_is_truncation(self, reason):
        assert is_truncated(reply('text', reason)) is True

    @pytest.mark.parametrize('reason', ['STOP', 'stop', 'SAFETY', '', None])
    def test_every_other_stop_reason_reads_as_complete(self, reason):
        assert is_truncated(reply('text', reason)) is False

    def test_a_missing_or_malformed_stop_reason_is_never_truncation(self):
        """A question must not fail because a provider reported no metadata."""
        assert is_truncated(SimpleNamespace(content='text')) is False
        assert is_truncated(SimpleNamespace(content='t', response_metadata=None)) is False
        assert is_truncated(SimpleNamespace(content='t', response_metadata='length')) is False
        assert is_truncated('bare string') is False
        assert finish_reason(SimpleNamespace(content='t', response_metadata={})) == ''

    def test_the_reason_is_casefolded_for_comparison(self):
        assert finish_reason(reply('t', 'MAX_TOKENS')) == 'max_tokens'


class TestTruncatedGenerationIsDiscarded:
    def test_a_severed_reply_is_replaced_by_the_grounded_fallback(
        self, retrieval, monkeypatch,
    ):
        async def generate(*_args):
            return reply(SEVERED, 'length'), None

        monkeypatch.setattr(chat, '_invoke_generation', generate)

        response = run(chat._chat_impl(
            ChatRequest(question='Tell me about the archived systems'),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert response.answer.startswith(chat_notices.GROUNDED_FALLBACK_PREFIX)
        assert 'two distinct systems' not in response.answer
        # Retrieval succeeded, so this is not a no-evidence result and the
        # source cards stay, matching every other use of this fallback.
        assert response.no_relevant_thesis is False
        assert [source['id'] for source in response.sources] == ['p1', 'p2']

    def test_the_repair_ladder_never_sees_a_fragment(
        self, retrieval, repair_spy, monkeypatch,
    ):
        """The ladder would launder it: markers restored, fragment served."""
        async def generate(*_args):
            return reply(SEVERED, 'MAX_TOKENS'), None

        monkeypatch.setattr(chat, '_invoke_generation', generate)

        response = run(chat._chat_impl(
            ChatRequest(question='Tell me about the archived systems'),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert repair_spy == []
        assert response.answer.startswith(chat_notices.GROUNDED_FALLBACK_PREFIX)

    def test_a_complete_reply_is_untouched_by_the_new_branch(
        self, retrieval, repair_spy, monkeypatch,
    ):
        """The guard must cost a well-formed answer nothing."""
        async def generate(*_args):
            return reply('The study used RAG [1].', 'STOP'), None

        monkeypatch.setattr(chat, '_invoke_generation', generate)

        response = run(chat._chat_impl(
            ChatRequest(question='What method did the study use?'),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert response.answer == 'The study used RAG [1].'
        assert repair_spy == []
        assert [source['id'] for source in response.sources] == ['p1']


class TestTruncatedRepairIsAlsoDiscarded:
    def test_repair_raises_rather_than_returning_a_severed_repair(self, monkeypatch):
        async def arun(_llm, _kind, _call):
            return reply('Repaired but cut [1', 'length')

        monkeypatch.setattr(chat.gemini_pool, 'arun', arun)

        with pytest.raises(TruncatedGeneration):
            run(chat._repair_citations('Uncited answer.', '[1] Evidence', SOURCES))

    def test_a_complete_repair_is_returned(self, monkeypatch):
        async def arun(_llm, _kind, _call):
            return reply('  Repaired answer [1].  ', 'stop')

        monkeypatch.setattr(chat.gemini_pool, 'arun', arun)

        assert run(chat._repair_citations(
            'Uncited answer.', '[1] Evidence', SOURCES,
        )) == 'Repaired answer [1].'

    def test_the_caller_serves_the_fallback_when_a_repair_is_severed(
        self, retrieval, monkeypatch,
    ):
        """End to end: an uncited answer whose repair is itself truncated."""
        async def generate(*_args):
            return reply('An uncited claim about the archive.', 'STOP'), None

        async def arun(_llm, _kind, _call):
            return reply('Still cut off [1', 'length')

        monkeypatch.setattr(chat, '_invoke_generation', generate)
        monkeypatch.setattr(chat.gemini_pool, 'arun', arun)

        response = run(chat._chat_impl(
            ChatRequest(question='What does the archive cover?'),
            _NoRequest(), BackgroundTasks(), None,
        ))

        assert response.answer.startswith(chat_notices.GROUNDED_FALLBACK_PREFIX)


class TestTruncatedPluralRepairIsAlsoDiscarded:
    """The plural rewrite replaces the answer wholesale, so a severed one is
    strictly worse than the complete draft it would overwrite."""

    def test_repair_raises_rather_than_overwriting_with_a_fragment(self, monkeypatch):
        async def arun(_llm, _kind, _call):
            return reply('Only the first thesis is covered [1', 'length')

        monkeypatch.setattr(chat.gemini_pool, 'arun', arun)

        with pytest.raises(TruncatedGeneration):
            run(chat._repair_multi_paper_coverage(
                'A draft naming one thesis [1].', 'Compare both', '[1] Evidence', SOURCES,
            ))

    def test_a_complete_plural_repair_is_returned(self, monkeypatch):
        async def arun(_llm, _kind, _call):
            return reply('  Both theses are covered [1] [2].  ', 'STOP')

        monkeypatch.setattr(chat.gemini_pool, 'arun', arun)

        assert run(chat._repair_multi_paper_coverage(
            'A draft naming one thesis [1].', 'Compare both', '[1] Evidence', SOURCES,
        )) == 'Both theses are covered [1] [2].'
