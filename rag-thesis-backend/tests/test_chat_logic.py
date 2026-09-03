"""Functional Suitability tests — citation post-processing and duplication math."""

from routers.chat import (
    _answer_reports_no_evidence,
    _author_lookup_response,
    _archive_inventory_response,
    _conversation_response,
    _extract_author_name,
    _extract_thesis_title_fragment,
    _grounded_retrieval_fallback,
    _is_ambiguous_system_origin_question,
    _is_archive_inventory_question,
    _is_archive_count_question,
    _is_model_question,
    _is_simple_conversation,
    _is_system_origin_question,
    _looks_like_misdirected_greeting,
    _origin_response,
    filter_cited_sources,
    get_exact_paper_prompt,
    get_exact_papers_prompt,
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
        # "What can you do?" moved to the capabilities fast path: the greeting
        # says who IskAI is, not what to ask it.
        assert not _is_simple_conversation('What can you do?')

    def test_capability_and_courtesy_questions_are_local(self):
        from routers.chat import _is_capability_question, _is_courtesy_message
        assert _is_capability_question('What can you do?')
        assert _is_capability_question('how does this work')
        assert _is_capability_question('hello what can you help me with')
        assert _is_capability_question('Help')
        assert not _is_capability_question('How does the attendance system work?')
        assert not _is_capability_question('help me find theses about OCR')
        assert _is_courtesy_message('Thank you!')
        assert _is_courtesy_message('ok thanks')
        assert _is_courtesy_message('Goodbye')
        assert not _is_courtesy_message('thanks for the summary of the attendance thesis')
        assert not _is_courtesy_message('thank the authors in my acknowledgements')

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

    def test_model_response_is_transparent_without_provider_style_identifiers(self):
        from routers.chat import _model_response
        response = _model_response()
        assert 'Gemini Embedding' in response
        assert 'models/' not in response
        assert 'citation-backed answers' in response


class TestArchiveInventoryFastPath:
    def test_recognizes_direct_inventory_questions(self):
        assert _is_archive_inventory_question('What are the theses here?')
        assert _is_archive_inventory_question('How many theses are indexed?')
        assert _is_archive_inventory_question('Is there any thesis other than that?')
        assert _is_archive_inventory_question('is there any thesis than those two?')
        assert not _is_archive_inventory_question('What methodology did this thesis use?')

    def test_short_followup_requires_inventory_history(self):
        assert _is_archive_inventory_question('one only?', ['What theses are available here?'])
        assert not _is_archive_inventory_question('one only?', ['Explain the thesis methodology'])

    def test_count_followup_can_request_the_titles_with_natural_language(self):
        history = ['How many theses are on this thesis library system?']
        assert _is_archive_inventory_question('what are those, can you named it', history)
        assert _is_archive_inventory_question('I am talking about the two theses on this system', history)
        assert not _is_archive_inventory_question('what are those, can you named it')

    def test_count_confirmation_rechecks_the_live_archive_without_listing_titles(self):
        history = ['How many theses are on this thesis library system?']
        assert _is_archive_inventory_question('only two for now?', history)
        assert _is_archive_count_question('only two for now?', history)
        assert not _is_archive_count_question('only two for now?')

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

    def test_exact_papers_followup_prompt_requires_each_thesis(self):
        rendered = get_exact_papers_prompt('CCSICT').format_messages(
            context='[1] First evidence\n[2] Second evidence',
            question='What are their objectives?',
        )
        prompt_text = ' '.join(
            '\n'.join(message.content for message in rendered).split()
        )
        assert 'each thesis separately' in prompt_text
        assert 'plural request' in prompt_text


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


class TestSystemProvenanceFastPath:
    """`who developed this system` must not be answered by semantic search.

    IskAI has no evidence establishing its own authorship. Answered from the
    archive it names whichever manuscript's system chapter ranks first, which
    is correct only for as long as the archive is small enough for the right
    thesis to win by accident.
    """

    def test_self_directed_provenance_questions_are_recognized(self):
        assert _is_system_origin_question('Who developed you?')
        assert _is_system_origin_question('who made IskAI')
        assert _is_system_origin_question('Who created this assistant?')
        assert _is_system_origin_question('who built this chatbot')

    def test_the_ambiguous_form_is_kept_separate(self):
        # "this system" may mean a manuscript's system, so it is answered by
        # context in _chat_impl rather than by wording here.
        assert _is_ambiguous_system_origin_question('who developed this system?')
        assert _is_ambiguous_system_origin_question('Who created the platform')
        assert not _is_system_origin_question('who developed this system?')

    def test_research_questions_about_authorship_are_never_captured(self):
        for question in (
            'Who developed the attendance monitoring system in that thesis?',
            'Who wrote the CNN study?',
            'Which team built the YOLOv11 detector?',
        ):
            assert not _is_system_origin_question(question), question
            assert not _is_ambiguous_system_origin_question(question), question

    def test_the_reply_declines_to_name_its_own_authors(self):
        message = _origin_response()
        assert 'IskAI' in message
        assert 'archived CCSICT theses' in message
        assert 'Barlis' not in message
        assert 'Gallardo' not in message


class TestBareTitleReferenceCapture:
    """The extractor is permissive on purpose: whether a fragment names a
    thesis is decided by the archive, not by a word list here."""

    def test_a_bare_reference_is_captured_verbatim(self):
        assert _extract_thesis_title_fragment(
            'what about the A centralized ai powered',
        ) == 'the A centralized ai powered'
        assert _extract_thesis_title_fragment(
            'Tell me more about Real-Time Autonomous Pedestrian Safety?',
        ) == 'Real-Time Autonomous Pedestrian Safety'
        assert _extract_thesis_title_fragment(
            'and what about the retrieval augmented generation one',
        ) == 'the retrieval augmented generation one'

    def test_short_pronoun_followups_are_not_references(self):
        assert _extract_thesis_title_fragment('what about it?') is None
        assert _extract_thesis_title_fragment('How about that?') is None

    def test_questions_that_are_not_bare_references_are_ignored(self):
        assert _extract_thesis_title_fragment('Who wrote the CNN study?') is None
        assert _extract_thesis_title_fragment(
            'What methodology did the attendance study use?',
        ) is None
