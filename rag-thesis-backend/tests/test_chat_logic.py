"""Functional Suitability tests — citation post-processing and duplication math."""

from routers.chat import (
    _author_lookup_response,
    _conversation_response,
    _extract_author_name,
    _is_simple_conversation,
    _looks_like_misdirected_greeting,
    filter_cited_sources,
)
from routers.duplication import compute_duplication_percentage


class TestCitationFiltering:
    SOURCES = [
        {'id': 'p1', 'title': 'First'},
        {'id': 'p2', 'title': 'Second'},
        {'id': 'p3', 'title': 'Third'},
    ]

    def test_only_cited_sources_returned(self):
        answer = 'The study [1] used CNNs while [3] used SVMs.'
        result = filter_cited_sources(answer, self.SOURCES)
        assert [s['id'] for s in result] == ['p1', 'p3']

    def test_no_citations_returns_empty(self):
        assert filter_cited_sources('General remark with no citations.', self.SOURCES) == []

    def test_out_of_range_citations_ignored(self):
        result = filter_cited_sources('See [1] and [9].', self.SOURCES)
        assert [s['id'] for s in result] == ['p1']

    def test_duplicate_citations_deduplicated(self):
        result = filter_cited_sources('First [1], again [1], and [2].', self.SOURCES)
        assert [s['id'] for s in result] == ['p1', 'p2']


class TestConversationFastPath:
    def test_greeting_and_identity_question_are_local(self):
        assert _is_simple_conversation('Hello!')
        assert _is_simple_conversation('hello.. who are you?')
        assert _is_simple_conversation('What can you do?')

    def test_research_question_still_uses_rag(self):
        assert not _is_simple_conversation('Hello, what theses used machine learning?')
        assert not _is_simple_conversation('Who are the authors of the CNN study?')

    def test_fast_response_uses_chatbot_brand(self):
        assert 'IskAI' in _conversation_response()


class TestGroundingGuards:
    def test_extracts_direct_author_question(self):
        assert _extract_author_name('who is carlo gallardo') == 'Carlo Gallardo'
        assert _extract_author_name('Who is the author?') is None
        assert _extract_author_name('Who is IskAI?') is None

    def test_author_answer_is_derived_from_metadata(self):
        answer = _author_lookup_response('Carlo Gallardo', [{
            'title': 'A Centralized AI-Powered Thesis Library',
            'year': 2026,
            'track': 'Data Mining',
        }])
        assert 'Carlo Gallardo' in answer
        assert 'A Centralized AI-Powered Thesis Library' in answer
        assert answer.endswith('[1].')

    def test_rejects_misdirected_chatbot_greeting(self):
        assert _looks_like_misdirected_greeting("Hello! I'm IskAI. Ask me about research.")
        assert not _looks_like_misdirected_greeting('Carlo Gallardo is an archived thesis author [1].')


class TestDuplicationPercentage:
    def test_paper_threshold_configuration(self):
        from config import settings
        assert settings.duplication_threshold == 0.85  # paper-mandated 85%

    def test_percentage_math(self):
        assert compute_duplication_percentage(0, 10) == 0
        assert compute_duplication_percentage(5, 10) == 50
        assert compute_duplication_percentage(10, 10) == 100

    def test_zero_total_chunks(self):
        assert compute_duplication_percentage(0, 0) == 0
