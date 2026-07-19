"""Functional Suitability tests — citation post-processing and duplication math."""

from routers.chat import (
    _answer_reports_no_evidence,
    _author_lookup_response,
    _conversation_response,
    _extract_author_name,
    _grounded_retrieval_fallback,
    _is_simple_conversation,
    _looks_like_misdirected_greeting,
    filter_cited_sources,
    get_exact_paper_prompt,
    get_overview_prompt,
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
        assert _is_simple_conversation('hello dear')
        assert _is_simple_conversation('Hey, IskAI!')
        assert _is_simple_conversation('hello.. who are you?')
        assert _is_simple_conversation('What can you do?')

    def test_research_question_still_uses_rag(self):
        assert not _is_simple_conversation('Hello, what theses used machine learning?')
        assert not _is_simple_conversation('Hello dear, what theses used machine learning?')
        assert not _is_simple_conversation('Who are the authors of the CNN study?')

    def test_fast_response_uses_chatbot_brand(self):
        assert 'IskAI' in _conversation_response()


class TestGroundingGuards:
    def test_extracts_direct_author_question(self):
        assert _extract_author_name('who is carlo gallardo') == 'Carlo Gallardo'
        assert _extract_author_name('Who is carlo rossi p. gallardo?') == 'Carlo Rossi P. Gallardo'
        assert _extract_author_name('What about Ahron John F. Barlis?') == 'Ahron John F. Barlis'
        assert _extract_author_name('and what about ahron barlis?') == 'Ahron Barlis'
        assert _extract_author_name('What about the methodology?') is None
        assert _extract_author_name('Who is the author?') is None
        assert _extract_author_name('Who is IskAI?') is None

    def test_author_answer_is_derived_from_metadata(self):
        answer = _author_lookup_response('Carlo Gallardo', [{
            'title': 'A Centralized AI-Powered Thesis Library',
            'authors': 'Ahron John F. Barlis, Carlo Rossi P. Gallardo',
            'year': 2026,
            'track': 'Data Mining',
        }])
        assert 'Carlo Rossi P. Gallardo' in answer
        assert 'with Ahron John F. Barlis' in answer
        assert 'A Centralized AI-Powered Thesis Library' in answer
        assert answer.endswith('[1].')

    def test_rejects_misdirected_chatbot_greeting(self):
        assert _looks_like_misdirected_greeting("Hello! I'm IskAI. Ask me about research.")
        assert not _looks_like_misdirected_greeting('Carlo Gallardo is an archived thesis author [1].')

    def test_explicit_no_evidence_answer_is_detected(self):
        assert _answer_reports_no_evidence(
            'The retrieved thesis text does not contain attendance-monitoring studies.'
        )
        assert _answer_reports_no_evidence(
            'The archived studies do not provide information about attendance methodologies.'
        )
        assert _answer_reports_no_evidence(
            'The archived theses do not contain information on attendance studies.'
        )
        assert not _answer_reports_no_evidence(
            'The study used interviews and usability testing [1].'
        )

    def test_fallback_lists_each_paper_once(self):
        answer = _grounded_retrieval_fallback([
            {'id': 'p1', 'title': 'Repeated', 'citation_id': 1},
            {'id': 'p1', 'title': 'Repeated', 'citation_id': 2},
            {'id': 'p2', 'title': 'Second', 'citation_id': 3, 'section': 'Methodology'},
        ])
        assert answer.count('“Repeated”') == 1
        assert '“Second” — Methodology [3]' in answer

    def test_exact_thesis_overview_prompt_requires_supported_summary(self):
        rendered = get_overview_prompt('CCSICT').format_messages(
            context='[1] Verified thesis evidence',
            question='Explain this thesis.',
        )
        prompt_text = ' '.join(
            '\n'.join(message.content for message in rendered).split()
        )
        assert 'research problem and purpose' in prompt_text
        assert 'instead of rejecting the entire question' in prompt_text
        assert '[1, 2]' in prompt_text

    def test_exact_paper_followup_prompt_answers_specific_question(self):
        rendered = get_exact_paper_prompt('CCSICT').format_messages(
            context='[1] The study objectives include accurate retrieval.',
            question='What are the objectives?',
        )
        prompt_text = ' '.join(
            '\n'.join(message.content for message in rendered).split()
        )
        assert 'specific question' in prompt_text
        assert 'instead of rejecting' in prompt_text


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
