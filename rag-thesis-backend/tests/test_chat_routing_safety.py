"""Functional Suitability / Performance Efficiency — catalog routing safety.

Two defects found in the 2026-11-25 review, both in the catalog fast-path
classifiers that run synchronously on the event loop before any model call:

* Catastrophic backtracking. A word accepted by two alternatives of a repeated
  group can be split two ways per occurrence, so a failed match explored 2^n
  paths: "how many theses " + "currently " * 20 + "zz" took 0.31 s and
  "ilan " + "nga " * 22 + "zz" took 1.9 s, each multiplying by ~3.5-4 for every
  two more words. One short guest question could freeze the API for minutes.
* A Filipino topic question was answered with the archive's first page because
  the adjacency patterns ignored everything after the catalog noun.

The timing bounds below are deliberately loose (the fixed code answers in well
under a millisecond); they exist to fail loudly if exponential behaviour returns.
"""

import time

import pytest

from routers.chat import (
    _CATALOG_QUESTION_MAX_CHARS,
    _is_archive_continuation_question,
    _is_archive_count_question,
    _is_archive_inventory_question,
    _matches_english_inventory,
    _matches_local_count,
    _matches_local_inventory,
)

BOUND_SECONDS = 0.25


def _elapsed(fn, *args):
    started = time.perf_counter()
    fn(*args)
    return time.perf_counter() - started


@pytest.mark.parametrize('word', ['currently', 'total', 'the', 'all', 'now'])
@pytest.mark.parametrize('opener', [
    'how many theses', 'what is the number of theses', 'list the theses',
    'what theses do you have', 'which theses are',
])
def test_english_catalog_matcher_has_no_exponential_backtracking(opener, word):
    adversarial = f'{opener} ' + f'{word} ' * 60 + 'zz'
    assert _elapsed(_matches_english_inventory, adversarial) < BOUND_SECONDS


@pytest.mark.parametrize('word', ['nga', 'available', 'po', 'na', 'a', 'dagiti', 'ang', 'sa'])
@pytest.mark.parametrize('opener', ['ilan', 'ilang', 'ano', 'anong', 'ilista', 'ilista mo', 'ania', 'mano'])
def test_local_catalog_matchers_have_no_exponential_backtracking(opener, word):
    adversarial = f'{opener} ' + f'{word} ' * 48 + 'zz'
    assert _elapsed(_matches_local_inventory, adversarial) < BOUND_SECONDS
    assert _elapsed(_matches_local_count, adversarial) < BOUND_SECONDS


def test_long_replayed_guest_history_cannot_stall_the_classifier():
    history = ['any thesis ' * 363] * 5
    question = 'how many theses ' + 'currently ' * 300 + 'zz'
    assert _elapsed(_is_archive_inventory_question, question, history) < BOUND_SECONDS
    assert _elapsed(_is_archive_count_question, question, history) < BOUND_SECONDS
    assert _elapsed(_is_archive_continuation_question, question, True) < BOUND_SECONDS


def test_overlong_questions_go_to_retrieval_not_the_catalog():
    padded = 'how many theses are there ' + 'in the archive ' * 20
    assert len(padded) > _CATALOG_QUESTION_MAX_CHARS
    assert not _is_archive_inventory_question(padded)
    assert not _is_archive_count_question(padded)


@pytest.mark.parametrize('question', [
    'how many theses are there currently',
    'how many theses in total',
    'how many theses are currently indexed in the archive',
    'what is the total number of theses',
    'how many theses are there right now',
])
def test_removing_duplicate_scope_words_keeps_their_meaning(question):
    assert _is_archive_inventory_question(question)


@pytest.mark.parametrize('question', [
    'Anong mga pag-aaral sa archive ang gumagamit ng QR code o mobile app?',
    'ano ang mga tesis dito na gumagamit ng mobile app',
    'ilang tesis ang meron dito na may kinalaman sa agrikultura',
    'ania dagiti tesis ditoy nga agusar iti computer vision',
    'may iba pa bang tesis na gumagamit ng arduino',
])
def test_a_topic_after_the_catalog_noun_keeps_the_question_on_retrieval(question):
    assert not _is_archive_inventory_question(question)


@pytest.mark.parametrize('question', [
    'anong mga pag-aaral ang meron dito',
    'ano ang mga tesis na available dito po',
    'anong mga pamagat ng tesis ang nasa archive',
    'anu-ano ang mga tesis nandito sa sistema',
    'ania dagiti tesis nga adda ditoy',
    'meron pa bang ibang tesis dito',
])
def test_whole_archive_questions_still_reach_the_catalog(question):
    assert _is_archive_inventory_question(question)


# --- topic proposals (2026-11-25 user testing) --------------------------------

from routers.chat import _is_topic_proposal, _with_proposal_advisory  # noqa: E402

_ARCHIVED = {
    'title': 'ISU-CANNER: A Document Monitoring and Tracking System Using QR Code',
    'year': 2025, 'similarity': 0.71,
}
_OTHER = {'title': 'FindMe: A Computer Vision-based Detector for Missing Person', 'year': 2024, 'similarity': 0.42}


@pytest.mark.parametrize('question', [
    'I want to propose a thesis about a document monitoring and tracking system using QR code',
    'We are planning to develop a mobile app for library borrowing as our capstone project',
    'Is it okay to propose a study on QR attendance?',
    'My thesis topic is an alumni tracer using web scraping',
    'thesis idea about crop disease detection',
    'Gusto kong gumawa ng thesis tungkol sa QR code',
])
def test_topic_proposals_are_recognised(question):
    assert _is_topic_proposal(question)


@pytest.mark.parametrize('question', [
    'Which studies used machine learning?',
    'What methodology did ISU-CANNER use?',
    'What system did the thesis propose?',
    'Compare the two alumni studies.',
])
def test_research_questions_are_not_proposals(question):
    assert not _is_topic_proposal(question)


def test_proposal_answer_gains_a_novelty_note_naming_the_closest_study():
    answer = _with_proposal_advisory('Build on the archived work [1].', 'I want to propose a thesis about QR tracking',
                                     [_OTHER, _ARCHIVED])
    assert answer.startswith('Build on the archived work [1].\n\n---\n\n')
    assert '“ISU-CANNER: A Document Monitoring and Tracking System Using QR Code” (2025)' in answer
    assert 'Novelty Check' in answer and '85% duplication threshold' in answer
    assert 'do not present its title as a new one' not in answer


def test_reusing_an_archived_title_as_a_suggestion_is_called_out():
    draft = '**Possible thesis title**  “ISU-CANNER: A Document Monitoring and Tracking System Using QR Code” [1].'
    answer = _with_proposal_advisory(draft, 'I want to propose a thesis about QR tracking', [_ARCHIVED])
    assert 'do not present its title as a new one' in answer


def test_ordinary_answers_and_sourceless_answers_are_unchanged():
    assert _with_proposal_advisory('Answer [1].', 'Which studies used QR codes?', [_ARCHIVED]) == 'Answer [1].'
    assert _with_proposal_advisory('Answer.', 'I want to propose a thesis about QR', []) == 'Answer.'


def test_proposal_pattern_is_linear_on_long_input():
    adversarial = 'i want to propose ' + 'thesis ' * 600 + 'zz'
    assert _elapsed(_is_topic_proposal, adversarial) < BOUND_SECONDS
    assert _elapsed(_is_topic_proposal, 'we are ' * 600) < BOUND_SECONDS