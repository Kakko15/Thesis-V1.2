"""Functional Suitability — cross-lingual query preparation.

The archive is English. Routing keeps greetings, identity, capability, origin
and catalog questions away from retrieval at zero token cost; what reaches the
embedder is a genuine research question, and in Filipino or Ilocano it embeds
into a conversational region of the vector space and matches formal capstone
prose poorly.

Only the query is translated. The generation prompt still receives the question
as asked, so services/prompts.py and PROMPT_VERSION are untouched.
"""

import pytest

from services.query_translation import (
    looks_non_english,
    translation_prompt,
    usable_translation,
)

NEEDS_TRANSLATION = (
    'ano ang mga tesis tungkol sa computer vision',
    'anong pamamaraan ang ginamit sa pag-aaral ng mangga',
    'sino ang sumulat ng tesis tungkol sa OCR',
    'ilang pag-aaral ang gumamit ng YOLO',
    'adda kadi thesis maipapan iti inventory',
    'ania daytoy nga sistema nga ar-aramaten',
    'kasano ti panagadal maipapan iti attendance',
)

# English must never reach the model call: it is the common case, and paying a
# round trip for it would put a second request in front of most turns.
STAYS_AS_ASKED = (
    'what theses used computer vision',
    'which studies applied YOLO for object detection',
    'summarize the methodology of the mango classification thesis',
    'who are the authors of FindMe',
    'how many theses are indexed',
    'compare the two attendance systems',
    'OCR',
    'what is retrieval augmented generation',
)


@pytest.mark.parametrize('question', NEEDS_TRANSLATION)
def test_local_language_questions_are_translated_before_embedding(question):
    assert looks_non_english(question), question


@pytest.mark.parametrize('question', STAYS_AS_ASKED)
def test_english_questions_never_pay_for_a_translation(question):
    assert not looks_non_english(question), question


def test_an_empty_question_is_not_translated():
    assert not looks_non_english('')
    assert not looks_non_english('   ')


class TestRewriteAcceptance:
    """A refusal or an explanation must never become the embedded text."""

    def test_a_plain_query_is_accepted(self):
        assert usable_translation('theses about computer vision', 'ORIG') == (
            'theses about computer vision'
        )

    def test_surrounding_quotes_are_stripped(self):
        assert usable_translation('"theses about OCR"', 'ORIG') == 'theses about OCR'

    @pytest.mark.parametrize('candidate', [
        'I cannot help with that',
        'Answer: theses about OCR',
        'Response: something',
        'Query: something',
        'x',
        '',
        'line one\nline two',
        'w' * 500,
    ])
    def test_anything_unexpected_falls_back_to_the_question_as_asked(self, candidate):
        assert usable_translation(candidate, 'ORIG') == 'ORIG'


def test_the_prompt_carries_the_question_and_forbids_answering():
    prompt = translation_prompt('ano ang mga tesis tungkol sa OCR')
    assert 'ano ang mga tesis tungkol sa OCR' in prompt
    assert 'Do not answer it' in prompt
    assert 'ONLY the rewritten query' in prompt
