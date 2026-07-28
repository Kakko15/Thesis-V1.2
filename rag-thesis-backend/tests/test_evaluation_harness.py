"""Regression tests for the defense-critical Objective 2 evaluation harness."""

from copy import deepcopy

from evaluation.run_comparison import (
    _ranked_contexts,
    sanitize_evaluation_rows,
    statistical_treatment,
    validate_formal_dataset,
)


def _valid_dataset() -> dict:
    return {
        'validated_by_faculty_panel': True,
        'validation': {
            'panel': [
                {'name': f'Faculty {index}', 'position': 'Professor', 'date_validated': '2026-08-01'}
                for index in range(1, 4)
            ],
        },
        'queries': [
            {
                'id': index,
                'question': f'Question {index}',
                'ground_truth': f'Faculty-verified answer {index}',
                'source_thesis': f'Thesis {index}, Author, 2026',
            }
            for index in range(1, 31)
        ],
    }


def test_formal_dataset_validation_accepts_complete_three_faculty_dataset():
    assert validate_formal_dataset(_valid_dataset()) == []


def test_formal_dataset_validation_rejects_placeholders_and_incomplete_signoff():
    dataset = deepcopy(_valid_dataset())
    dataset['validated_by_faculty_panel'] = False
    dataset['queries'][0]['ground_truth'] = 'REPLACE: pending'
    dataset['validation']['panel'][2]['date_validated'] = ''
    dataset['validation']['panel'][1]['name'] = 'Faculty 1'

    issues = validate_formal_dataset(dataset)

    assert any('unverified ground_truth' in issue for issue in issues)
    assert 'validated_by_faculty_panel is not true' in issues
    assert 'all three faculty validator records must be complete' in issues


def test_formal_dataset_validation_requires_distinct_people_and_iso_dates():
    dataset = _valid_dataset()
    dataset['validation']['panel'][1]['name'] = 'Faculty 1'
    dataset['validation']['panel'][2]['date_validated'] = 'August 1, 2026'

    issues = validate_formal_dataset(dataset)

    assert 'the three faculty validators must be distinct people' in issues
    assert 'faculty validation dates must use ISO format YYYY-MM-DD' in issues


def test_ranked_contexts_restores_similarity_order_after_prompt_reordering():
    reordered = (
        '[1] Title: First\nMost relevant evidence\n\n'
        '[3] Title: Third\nThird-ranked evidence\n\n'
        '[2] Title: Second\nSecond-ranked evidence'
    )

    assert _ranked_contexts(reordered) == [
        'Most relevant evidence',
        'Second-ranked evidence',
        'Third-ranked evidence',
    ]


def test_statistical_treatment_rejects_too_few_pairs():
    result = statistical_treatment([0.2, 0.4], [0.3, 0.5])
    assert 'At least three complete score pairs' in result['note']


def test_sanitized_evaluation_rows_never_export_archived_context():
    sanitized = sanitize_evaluation_rows([{
        'id': 1,
        'rag_answer': 'Grounded answer [1].',
        'rag_context': '[1] private manuscript text',
        'rag_contexts': ['private manuscript text'],
    }])

    assert 'rag_context' not in sanitized[0]
    assert 'rag_contexts' not in sanitized[0]
    assert sanitized[0]['retrieved_context_count'] == 1
    assert sanitized[0]['retrieved_context_sha256'] != ['private manuscript text']
