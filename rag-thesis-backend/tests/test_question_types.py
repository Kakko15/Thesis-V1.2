"""The deterministic question-type classifier behind prompt v4.

The classification decides two real behaviors: an aggregate question retrieves
at most one chunk per thesis, and the grounded prompt gains a TASK block
matched to the question's shape. Both are pinned here the way the guards are
pinned: exact inputs, exact outputs, no fuzz.
"""

import pytest

from services import question_types
from services.question_types import (
    AGGREGATE,
    COMPARISON,
    DEFAULT,
    ENUMERATION,
    FACTUAL,
    classify_question,
)


class TestAggregateQuestions:
    """The shape that was structurally unanswerable before the per-paper cap.

    The first four wordings mirror golden-dataset items 3, 11, 18 and 37,
    which the fidelity audit called out as unanswerable with five chunks from
    one or two theses.
    """

    @pytest.mark.parametrize('question', [
        'Which machine learning technique is most commonly used in CCSICT theses?',
        'What data collection method is most often applied across the theses?',
        'Which framework is most frequently chosen for web-based systems?',
        'What evaluation metric appears most often across all studies?',
        'What percentage of theses use quantitative methods?',
        'What are the overall trends in thesis topics?',
        'Across the archive, how often is OCR used?',
        'What is the dominant research design?',
    ])
    def test_corpus_wide_wordings_classify_aggregate(self, question):
        assert classify_question(question) == AGGREGATE

    def test_aggregate_wins_over_enumeration_wording(self):
        # "which theses" alone is enumeration; "most commonly" makes the
        # question corpus-wide, and the corpus-wide reading must win.
        assert classify_question(
            'Which theses use the most commonly applied technique?') == AGGREGATE


class TestOtherTypes:
    @pytest.mark.parametrize('question', [
        'Compare the attendance monitoring thesis with the enrollment system thesis.',
        'What is the difference between the two OCR approaches?',
        'How does the 2023 study differ from the 2024 one?',
        'CNN versus SVM in the archived studies?',
    ])
    def test_comparison(self, question):
        assert classify_question(question) == COMPARISON

    @pytest.mark.parametrize('question', [
        'List the theses about network security.',
        'Name all the studies that used Arduino.',
        'Which theses cover recommendation systems?',
        'What are the objectives of the attendance study?',
    ])
    def test_enumeration(self, question):
        assert classify_question(question) == ENUMERATION

    @pytest.mark.parametrize('question', [
        'What year was the attendance monitoring thesis published?',
        'Who wrote the campus security study?',
        'What dataset did the rice disease study use?',
        'What accuracy did the classifier reach?',
        'How many respondents did the survey have?',
    ])
    def test_factual(self, question):
        assert classify_question(question) == FACTUAL


class TestDefaultIsTheSafeFallthrough:
    @pytest.mark.parametrize('question', [
        'Hello',
        'Tell me about thesis research on flood prediction.',
        'What methods were used in "Smart Attendance Monitoring"?',
        'Is there a thesis about mango grading?',
        'Explain the methodology of the chatbot study.',
        '',
        '   ',
    ])
    def test_untyped_questions_stay_default(self, question):
        assert classify_question(question) == DEFAULT

    def test_none_is_default(self):
        assert classify_question(None) == DEFAULT

    def test_the_vocabulary_is_closed(self):
        # Everything the classifier can emit has a TASK block or is DEFAULT;
        # a new type added without deciding its prompt is a bug, not a feature.
        from services.prompts import QUESTION_TYPE_TASKS
        emittable = {AGGREGATE, COMPARISON, ENUMERATION, FACTUAL, DEFAULT}
        assert set(QUESTION_TYPE_TASKS) == emittable - {DEFAULT}
        assert question_types.DEFAULT not in QUESTION_TYPE_TASKS
