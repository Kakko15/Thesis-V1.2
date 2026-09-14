"""Functional Suitability tests — citation post-processing and duplication math."""

import pytest

from routers.chat import (
    _GREETINGS_ALL,
    _GREETINGS_BY_LENGTH,
    _answer_reports_no_evidence,
    _author_lookup_response,
    _archive_inventory_response,
    _conversation_response,
    _extract_author_name,
    _extract_followup_author_token,
    _extract_thesis_title_fragment,
    _grounded_retrieval_fallback,
    _is_ambiguous_system_origin_question,
    _archive_listing_cursor,
    _is_archive_continuation_question,
    _is_capability_question,
    _is_identity_question,
    _is_courtesy_message,
    _is_farewell_message,
    _longest_greeting_prefix,
    _last_turn_was_a_listing,
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
        assert _is_simple_conversation('Hello sdad')
        assert _is_simple_conversation('Hey, IskAI!')
        assert _is_simple_conversation('hello.. who are you?')
        # "What can you do?" moved to the capabilities fast path: the greeting
        # says who IskAI is, not what to ask it.
        assert not _is_simple_conversation('What can you do?')

    def test_capability_and_courtesy_questions_are_local(self):
        from routers.chat import (
            _is_capability_question, _is_courtesy_message, _is_farewell_message,
        )
        assert _is_capability_question('What can you do?')
        assert _is_capability_question('how does this work')
        assert _is_capability_question('hello what can you help me with')
        assert _is_capability_question('Help')
        assert not _is_capability_question('How does the attendance system work?')
        assert not _is_capability_question('help me find theses about OCR')
        assert _is_courtesy_message('Thank you!')
        assert _is_courtesy_message('ok thanks')
        assert _is_courtesy_message('Goodbye')
        assert _is_courtesy_message("That's all")
        assert not _is_farewell_message('Thank you!')
        assert _is_farewell_message('Goodbye')
        assert _is_farewell_message("That's all")
        assert _is_farewell_message("That's all for now")
        assert not _is_courtesy_message('thanks for the summary of the attendance thesis')
        assert not _is_courtesy_message('thank the authors in my acknowledgements')

    def test_research_question_still_uses_rag(self):
        assert not _is_simple_conversation('Hello, what theses used machine learning?')
        assert not _is_simple_conversation('Hello machine learning')
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


class TestUnsupportedSingleTokenQuery:
    def test_opaque_token_is_rejected_when_evidence_has_no_lexical_support(self):
        from routers.chat import _is_unsupported_single_token_query

        assert _is_unsupported_single_token_query(
            'dsadasd',
            '[1] Real-time pedestrian hazard detection with YOLO.',
            [{'title': 'Pedestrian Safety', 'track': 'Data Mining'}],
        )

    def test_real_single_word_topic_remains_searchable(self):
        from routers.chat import _is_unsupported_single_token_query

        assert not _is_unsupported_single_token_query(
            'blockchain',
            '[1] A blockchain-based credential verification system.',
            [{'title': 'Credential Verification'}],
        )

    def test_short_acronym_is_left_to_semantic_retrieval(self):
        from routers.chat import _is_unsupported_single_token_query

        assert not _is_unsupported_single_token_query('OCR', 'optical character recognition', [])


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

    def test_recognizes_requests_to_continue_a_listing(self):
        # Unambiguous forms mean the list whether or not the page is the turn above.
        for question in (
            'provide me the remaining 6',
            'what are the remaining theses?',
            'give me the rest of them',
            'the other 6',
            'any others?',
            'next 6',
            'are there more titles?',
        ):
            assert _is_archive_continuation_question(question, False), question

    def test_ambiguous_forms_need_the_listing_directly_above_them(self):
        # After an answer about one thesis, "more" asks for more of that answer.
        for question in ('show more', 'more', 'continue', 'show the rest', 'what else?'):
            assert _is_archive_continuation_question(question, True), question
            assert not _is_archive_continuation_question(question, False), question

    def test_a_reference_to_one_listed_thesis_is_not_a_continuation(self):
        # "more" is shared by "show me more" and "tell me more about number 3";
        # only the first asks for the next page.
        for question in (
            'tell me more about number 3',
            'tell me more about it',
            'what is the second thesis about',
            'summarize the objectives of number 2',
            'what other framework did they consider besides django',
            'tell me the rest of the methodology',
        ):
            assert not _is_archive_continuation_question(question, True), question

    def test_last_turn_detection_reads_answers_then_falls_back_to_questions(self):
        listing = {
            'question': 'what are the theses on this system',
            'answer': 'This count comes from the live indexed archive, not from claims '
                      'inside a thesis document.',
            'sources': [{'id': 'p1'}],
        }
        assert _last_turn_was_a_listing([listing])
        assert not _last_turn_was_a_listing([listing, {
            'question': 'what methodology did it use', 'answer': 'It used a survey.', 'sources': [],
        }])
        # Guest transcripts carry questions only.
        assert _last_turn_was_a_listing([{'question': 'what are the theses here?'}])
        assert not _last_turn_was_a_listing([{'question': 'explain the methodology'}])
        assert not _last_turn_was_a_listing([])

    def test_cursor_counts_distinct_titles_already_listed(self):
        page = {
            'question': 'what are the theses on this system',
            'answer': 'The CCSICT archive currently has **16 indexed theses**:\n1. ...\n\n'
                      'This count comes from the live indexed archive, not from claims '
                      'inside a thesis document.',
            'sources': [{'id': f'p{index}'} for index in range(1, 11)],
        }
        assert _archive_listing_cursor([page], []) == 10
        # Asking for the list twice re-shows page one; it does not advance a page.
        assert _archive_listing_cursor([page, page], []) == 10
        assert _archive_listing_cursor([{'question': 'explain the methodology'}], ['p1']) == 0

    def test_cursor_falls_back_to_guest_source_ids(self):
        # A guest transcript replays questions plus the newest answer's ids only.
        assert _archive_listing_cursor(
            [{'question': 'what are the theses on this system'}],
            [f'p{index}' for index in range(1, 11)],
        ) == 10

    def test_continuation_page_is_numbered_from_one_and_says_what_it_completes(self):
        page = [
            {'id': f'p{index}', 'title': f'Thesis {index}', 'authors': f'Author {index}'}
            for index in range(11, 17)
        ]
        answer = _archive_inventory_response('CCSICT', 16, page, offset=10)
        assert 'remaining **6** of the **16**' in answer
        # Numbered from 1 because "number 2" indexes the sources this answer ships.
        assert '1. **Thesis 11**' in answer and '[1]' in answer
        assert '6. **Thesis 16**' in answer and '[6]' in answer
        assert 'completes all **16** titles' in answer
        assert 'first **' not in answer

    def test_middle_page_reports_progress_instead_of_completion(self):
        page = [
            {'id': f'p{index}', 'title': f'Thesis {index}', 'authors': f'Author {index}'}
            for index in range(11, 21)
        ]
        answer = _archive_inventory_response('CCSICT', 137, page, offset=10)
        assert 'next **10** of the **137**' in answer
        assert '**20 of 137** titles so far' in answer

    def test_exhausted_listing_says_so_instead_of_repeating_page_one(self):
        answer = _archive_inventory_response('CCSICT', 16, [], offset=16)
        assert 'All **16** titles have already been listed' in answer
        assert 'live indexed archive' in answer

    def test_count_of_what_is_left_subtracts_what_was_shown(self):
        answer = _archive_inventory_response('CCSICT', 16, [], count_only=True, offset=10)
        assert 'already been shown **10**' in answer
        assert '**6** are left to list' in answer


class TestGroundingGuards:
    def test_extracts_direct_author_question(self):
        assert _extract_author_name('who is carlo gallardo') == 'Carlo Gallardo'
        assert _extract_author_name('Who is carlo rossi p. gallardo?') == 'Carlo Rossi P. Gallardo'
        assert _extract_author_name('What about Ahron John F. Barlis?') == 'Ahron John F. Barlis'
        assert _extract_author_name('and what about ahron barlis?') == 'Ahron Barlis'
        assert _extract_author_name('What about the methodology?') is None
        assert _extract_author_name('Who is the author?') is None
        assert _extract_author_name('Who is IskAI?') is None

    def test_extracts_one_word_followup_author_reference(self):
        assert _extract_followup_author_token('what about enoy?') == 'Enoy'
        assert _extract_followup_author_token('and what about Enoy') == 'Enoy'
        assert _extract_followup_author_token('How about Barlis?') == 'Barlis'
        # Two-part names stay with the stricter pattern.
        assert _extract_followup_author_token('what about ahron barlis?') is None
        # Conversational references are never person lookups.
        assert _extract_followup_author_token('what about them?') is None
        assert _extract_followup_author_token('what about the others?') is None
        # `who is` keeps its two-part contract so its not-found notice stays safe.
        assert _extract_followup_author_token('who is enoy?') is None

    def test_one_word_author_answer_quotes_the_archived_line(self):
        answer = _author_lookup_response('Enoy', [{
            'title': 'ISU-CANNER',
            'authors': 'Aquino, Rainier, Enoy, Kurt Robin, Fallaria, Chris Lloyd',
            'year': 2025,
            'track': 'Web and Mobile Application Development',
        }])
        # Surname-first metadata must not be split into invented groupmates.
        assert 'co-author' not in answer
        assert 'Aquino, Rainier, Enoy, Kurt Robin, Fallaria, Chris Lloyd' in answer
        assert 'ISU-CANNER' in answer and answer.endswith('[1].')

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

    def test_the_reply_uses_documented_project_provenance(self):
        message = _origin_response()
        assert 'IskAI' in message
        assert 'Ahron John F. Barlis' in message
        assert 'Carlo Rossi P. Gallardo' in message
        assert 'Isabela State University Echague' in message


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


class TestFilipinoAndIlocanoConversation:
    """2026-09-14: "magandang araw" was answered with two cited unrelated theses.

    Every conversational set matched English exact phrases only, so a Filipino
    or Ilocano pleasantry missed all five fast paths and reached vector
    retrieval, which duly found something and cited it.
    """

    def _route(self, question):
        if _is_capability_question(question):
            return 'capability'
        if _is_courtesy_message(question):
            return 'farewell' if _is_farewell_message(question) else 'thanks'
        if _is_identity_question(question):
            return 'identity'
        if _is_simple_conversation(question):
            return 'greeting'
        return 'retrieval'

    @pytest.mark.parametrize('question', [
        'magandang araw', 'magandang umaga', 'gandang gabi', 'maganda hapon',
        'kumusta', 'kamusta ka', 'musta na', 'mabuhay', 'good day', 'uy',
        'naimbag nga aldaw', 'naimbag a bigat', 'naimbag nga rabii', 'naimbag aldaw',
    ])
    def test_local_greetings_never_reach_retrieval(self, question):
        assert self._route(question) == 'greeting'

    @pytest.mark.parametrize('question,expected', [
        ('sino ka', 'identity'),
        ('ano ang pangalan mo', 'identity'),
        ('siasino ka', 'identity'),
        ('ania ti naganmo', 'identity'),
        ('ano ang magagawa mo', 'capability'),
        ('paano ka gumagana', 'capability'),
        ('tulong', 'capability'),
        ('ania ti kabaelam', 'capability'),
        ('salamat', 'thanks'),
        ('maraming salamat sa tulong', 'thanks'),
        ('agyamanak', 'thanks'),
        ('dios ti agngina', 'thanks'),
        ('paalam', 'farewell'),
        ('ingat ka', 'farewell'),
        ('wala na akong tanong', 'farewell'),
        ('agpakadaakon', 'farewell'),
    ])
    def test_local_courtesy_identity_and_capability_route_locally(self, question, expected):
        assert self._route(question) == expected

    @pytest.mark.parametrize('question,expected', [
        # "po"/"ho" attach anywhere, so the sets hold one canonical entry and
        # the stripper does the rest -- including for the English entries.
        ('magandang araw po', 'greeting'),
        ('kumusta po', 'greeting'),
        ('hello po', 'greeting'),
        ('good morning po', 'greeting'),
        ('salamat po', 'thanks'),
        ('salamat ho', 'thanks'),
        ('thanks po', 'thanks'),
        ('paalam po', 'farewell'),
        ('sino ka po', 'identity'),
        ('ano po ang pangalan mo', 'identity'),
        ('tulong po', 'capability'),
        # ...and a term of address may close any of them.
        ('magandang hapon po iskai', 'greeting'),
        ('kumusta po kabsat', 'greeting'),
        ('good day po sir', 'greeting'),
        ('salamat po iskai', 'thanks'),
        ('agyamanak unay', 'thanks'),
        ('naimbag a bigat apo', 'greeting'),
    ])
    def test_politeness_particles_and_addressees_are_stripped(self, question, expected):
        assert self._route(question) == expected

    @pytest.mark.parametrize('question', [
        # Greeting-then-topic is ordinary Filipino word order, so the English
        # "greeting + one word" shortcut must not extend to the local stems.
        'magandang araw ocr',
        'magandang araw blockchain',
        'kumusta ocr',
        # Both halves of each greeting pattern are closed alternations.
        'magandang sistema', 'magandang topic', 'magandang resulta',
        'magandang thesis', 'gandang sistema', 'naimbag nga panagadal',
        'naimbag a sistema',
        # fullmatch, not search.
        'ano ang magandang araw para mag defense',
        'ano ang magandang topic para sa thesis',
        # Real research questions that open with the same interrogatives.
        'ano ang metodolohiya ng pag aaral na ito',
        'ano ang machine learning',
        'paano gumawa ng attendance system',
        'sino ang may akda ng findme',
        'ano ang isinulat nila tungkol sa ocr',
        # The particle stripper must not manufacture a match out of a question
        # that merely contains the letters "po".
        'ano ang gamit ng po sa system',
    ])
    def test_real_questions_are_never_swallowed(self, question):
        assert self._route(question) == 'retrieval'

    def test_a_bare_particle_matches_nothing(self):
        # Stripping "po" from "po" would leave an empty string, which must not
        # be allowed to match some set's shortest member.
        for question in ('po', 'ho'):
            assert self._route(question) == 'retrieval'


class TestGreetingMatchIsDeterministic:
    """`hi` and `hi there` are both prefixes of `hi there friend`.

    The prefix scan used to iterate `_GREETINGS`, a set, and return inside the
    loop, so whichever prefix came out first won -- and set order depends on
    PYTHONHASHSEED, which Python randomizes per process and which nothing in
    this repo pins. Measured 2026-09-14 on the real module: `hi there friend`
    was True under seeds 0/2/7 and False under 1/3. The same user got a
    different answer to the same greeting after a server restart.
    """

    def test_the_scan_order_is_longest_first(self):
        lengths = [len(greeting) for greeting in _GREETINGS_BY_LENGTH]
        assert lengths == sorted(lengths, reverse=True)
        assert set(_GREETINGS_BY_LENGTH) == _GREETINGS_ALL

    def test_the_longest_matching_greeting_wins(self):
        assert _longest_greeting_prefix('hi there friend') == 'hi there'
        assert _longest_greeting_prefix('hey there iskai') == 'hey there'
        assert _longest_greeting_prefix('kamusta ka na po') == 'kamusta ka na'
        assert _longest_greeting_prefix('what theses used cnn') is None

    def test_overlapping_prefixes_resolve_the_same_way_every_time(self):
        for question in ('hi there friend', 'hey there iskai', 'hello there who are you'):
            assert _is_simple_conversation(question) or _is_identity_question(question), question
