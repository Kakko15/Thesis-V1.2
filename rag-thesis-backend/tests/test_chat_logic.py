"""Functional Suitability tests — citation post-processing and duplication math."""

from routers.chat import (
    _answer_reports_no_evidence,
    _author_lookup_response,
    _archive_inventory_response,
    _conversation_response,
    _extract_author_name,
    _grounded_retrieval_fallback,
    _is_archive_inventory_question,
    _is_archive_count_question,
    _is_model_question,
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

    def test_model_identity_is_handled_without_archive_retrieval(self):
        assert _is_model_question('what model are you?')
        assert _is_model_question('Which AI model do you use?')
        assert not _is_model_question('What model did this thesis use?')


class TestArchiveInventoryFastPath:
    def test_recognizes_direct_inventory_questions(self):
        assert _is_archive_inventory_question('What are the theses here?')
        assert _is_archive_inventory_question('How many theses are indexed?')
        assert _is_archive_inventory_question('Is there any thesis other than that?')
        assert _is_archive_inventory_question('is there any thesis than those two?')
        assert not _is_archive_inventory_question('What methodology did this thesis use?')
        assert not _is_archive_inventory_question('How many studies were reviewed in this thesis?')
        assert not _is_archive_inventory_question('How many papers did the authors cite?')
        assert not _is_archive_inventory_question('What theses discuss archive systems?')
        assert not _is_archive_inventory_question('What studies are available on machine learning?')
        assert not _is_archive_inventory_question('What papers are here about cybersecurity?')
        assert not _is_archive_inventory_question('Are there more papers about RAG?')
        assert not _is_archive_inventory_question('Which papers are in the library for machine learning?')
        assert not _is_archive_inventory_question('What available papers deal with machine learning?')
        assert not _is_archive_inventory_question('Show papers concerning cybersecurity available here')
        assert not _is_archive_inventory_question('Which theses in the archive examine attendance?')
        assert not _is_archive_inventory_question('What papers are available in 2025?')
        assert not _is_archive_inventory_question('What theses are available by Juan Cruz?')

    def test_short_followup_requires_inventory_history(self):
        assert _is_archive_inventory_question('one only?', ['What theses are available here?'])
        assert not _is_archive_inventory_question('one only?', ['Explain the thesis methodology'])

    def test_response_uses_live_metadata_and_citations(self):
        answer = _archive_inventory_response('CCSICT', 2, [
            {'title': 'First Thesis', 'authors': 'Author One', 'track': 'Data Mining'},
            {'title': 'Second Thesis', 'authors': 'Author Two', 'year': 2025},
        ])
        assert '**2 indexed theses**' in answer
        assert 'First Thesis' in answer and '[1]' in answer
        assert 'Second Thesis' in answer and '[2]' in answer
        assert 'live indexed archive' in answer

    def test_large_inventory_is_explicitly_truncated(self):
        sources = [
            {'title': f'Thesis {index}', 'authors': f'Author {index}'}
            for index in range(1, 11)
        ]
        answer = _archive_inventory_response('CCSICT', 137, sources)
        assert '**137 indexed theses**' in answer
        assert 'first **10 of 137**' in answer
        assert 'topic, title, author, year, or category' in answer

    def test_count_question_requests_no_catalog_dump(self):
        assert _is_archive_count_question('How many theses are indexed?')
        assert not _is_archive_count_question('What theses are indexed?')
        answer = _archive_inventory_response(
            'CCSICT', 137, [{'title': 'Should not appear'}], count_only=True,
        )
        assert '**137 indexed theses**' in answer
        assert 'Should not appear' not in answer

    def test_category_inventory_is_labeled_as_a_subset(self):
        answer = _archive_inventory_response(
            'CCSICT', 3, [], count_only=True, thesis_category='faculty',
        )
        assert '**3 indexed faculty-authored theses**' in answer

    def test_other_paper_response_keeps_the_archive_total(self):
        answer = _archive_inventory_response(
            'CCSICT', 3, [], additional_only=True,
        )
        assert '**3 indexed theses**' in answer
        assert 'no additional theses' in answer

    def test_other_paper_count_does_not_report_total_as_remaining(self):
        answer = _archive_inventory_response(
            'CCSICT', 12, [{'title': 'Additional', 'authors': 'Author'}],
            count_only=True, additional_only=True, additional_total=4,
        )
        assert '**12 indexed theses**' in answer
        assert '**4 additional theses**' in answer


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
