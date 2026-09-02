"""Regression tests for the defense-critical Objective 2 evaluation harness."""

import asyncio
import importlib.util
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest

from evaluation import run_comparison
from evaluation.run_comparison import (
    _load_checkpoint,
    _rank_biserial_correlation,
    _ranked_contexts,
    _run_pathways,
    is_unattempted,
    sanitize_evaluation_rows,
    statistical_treatment,
    summarize_rag_diagnostics,
    validate_formal_dataset,
)
from services import chat_notices

# scipy is an evaluation extra, not a production dependency:
# evaluation/requirements-eval.txt pins it and says to keep it out of the
# image, and CI installs requirements.lock with --require-hashes so that the
# test job holds the same bytes the container does. Adding scipy there would
# weaken that guarantee for a dependency only the comparison harness needs.
#
# So the statistical helpers are exercised wherever the extras are installed --
# which is any machine that can actually run the comparison -- and skipped
# elsewhere, the same opt-in shape as the disposable-Supabase integration
# tests. `find_spec` rather than an import, so collection stays cheap.
requires_scipy = pytest.mark.skipif(
    importlib.util.find_spec('scipy') is None,
    reason='scipy ships with evaluation/requirements-eval.txt, not the production lock',
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


# --- Provider outages must never be scored as wrong answers ----------------


def test_only_outage_notices_count_as_unattempted():
    """The distinction the whole guard rests on.

    A capacity or guest-allowance notice means the provider never processed the
    question. "No relevant thesis was found" means the retrieval threshold did
    its job, and for the negative-control queries it is the expected, correct
    answer -- retrying or discarding it would corrupt the instrument.
    """
    assert is_unattempted(chat_notices.CAPACITY_MESSAGE)
    assert is_unattempted(chat_notices.GUEST_BUDGET_MESSAGE)

    assert not is_unattempted(
        f'{chat_notices.NO_RELEVANT_PREFIX} CCSICT archive for that query.'
    )
    assert not is_unattempted(
        f'{chat_notices.GROUNDED_FALLBACK_PREFIX} from the retrieved thesis text.'
    )
    assert not is_unattempted(chat_notices.REFUSAL_MESSAGE)
    assert not is_unattempted('The 2023 attendance study used a CNN classifier [1].')
    assert not is_unattempted('')


def _skip_backoff(monkeypatch):
    """Collapse the retry backoff so the tests do not wait minutes.

    The real `asyncio.sleep` is captured first: `run_comparison.asyncio` is the
    asyncio module itself, so a replacement that called `asyncio.sleep` would
    call whatever it had just been replaced with.
    """
    real_sleep = asyncio.sleep
    monkeypatch.setattr(run_comparison.asyncio, 'sleep', lambda _seconds: real_sleep(0))


def _fake_rag(answer: str):
    return (
        SimpleNamespace(answer=answer),
        {'context': '[1] Title: T\nbody', 'sources': [], 'top_similarity': 0.5},
        1.0,
    )


def _patch_pathways(monkeypatch, answers: list[str]):
    """Drive `_run_query` through a scripted sequence of RAG answers."""
    calls = {'n': 0}

    async def fake_attempt(_question, _department):
        answer = answers[min(calls['n'], len(answers) - 1)]
        calls['n'] += 1
        return ('baseline text', 0.5), _fake_rag(answer)

    monkeypatch.setattr(run_comparison, '_attempt_pathways', fake_attempt)
    _skip_backoff(monkeypatch)
    return calls


QUERY = {'id': 1, 'question': 'What did the 2023 study find?', 'ground_truth': 'It found X.'}


def test_a_capacity_notice_is_retried_and_the_recovered_answer_is_kept(monkeypatch):
    calls = _patch_pathways(monkeypatch, [
        chat_notices.CAPACITY_MESSAGE,
        chat_notices.CAPACITY_MESSAGE,
        'The study reported 94.2% accuracy [1].',
    ])
    rows = asyncio.run(_run_pathways([QUERY]))
    assert calls['n'] == 3
    assert rows[0]['rag_answer'] == 'The study reported 94.2% accuracy [1].'
    assert rows[0]['rag_unattempted'] is False
    assert rows[0]['attempts'] == 3


def test_a_persistent_outage_is_flagged_rather_than_scored(monkeypatch):
    _patch_pathways(monkeypatch, [chat_notices.CAPACITY_MESSAGE])
    rows = asyncio.run(_run_pathways([QUERY]))
    assert rows[0]['rag_unattempted'] is True
    # The notice is retained for the audit trail; what matters is that the row
    # is marked so the paired test and `formal_result` both exclude it.
    assert is_unattempted(rows[0]['rag_answer'])


def test_a_no_relevant_thesis_answer_is_never_retried(monkeypatch):
    """The negative controls depend on this exact behaviour."""
    message = f'{chat_notices.NO_RELEVANT_PREFIX} CCSICT archive for that query.'
    calls = _patch_pathways(monkeypatch, [message, 'should never be reached'])
    rows = asyncio.run(_run_pathways([QUERY]))
    assert calls['n'] == 1
    assert rows[0]['rag_answer'] == message
    assert rows[0]['rag_unattempted'] is False


def test_the_retry_clears_the_process_wide_capacity_cooldown(monkeypatch):
    """Without this the retry replays the notice instead of calling the provider.

    `_chat_impl` short-circuits to the capacity notice for as long as the
    cooldown holds, so a retry issued inside that window never reaches Gemini.
    """
    seen = []

    async def fake_attempt(_question, _department):
        seen.append(chat_notices.capacity_limit_is_active())
        chat_notices.mark_capacity_limited()
        return ('baseline', 0.5), _fake_rag(chat_notices.CAPACITY_MESSAGE)

    monkeypatch.setattr(run_comparison, '_attempt_pathways', fake_attempt)
    _skip_backoff(monkeypatch)
    try:
        asyncio.run(_run_pathways([QUERY]))
    finally:
        chat_notices.reset_capacity_limit()
    assert seen and not any(seen), 'every attempt must start with the cooldown cleared'


# --- A long run must survive an interruption -------------------------------


def test_completed_queries_are_checkpointed_and_resumed(monkeypatch, tmp_path):
    checkpoint = tmp_path / 'run.pathways.jsonl'
    queries = [dict(QUERY, id=index, question=f'Q{index}') for index in (1, 2)]

    _patch_pathways(monkeypatch, ['answer one [1]'])
    asyncio.run(_run_pathways(queries[:1], checkpoint))
    assert _load_checkpoint(checkpoint).keys() == {1}

    # A second pass over both queries must reuse query 1 from disk and only
    # call the provider for query 2.
    calls = _patch_pathways(monkeypatch, ['answer two [1]'])
    rows = asyncio.run(_run_pathways(queries, checkpoint))
    assert calls['n'] == 1
    assert [row['id'] for row in rows] == [1, 2]
    assert rows[0]['rag_answer'] == 'answer one [1]'
    assert rows[1]['rag_answer'] == 'answer two [1]'
    assert len(checkpoint.read_text(encoding='utf-8').strip().splitlines()) == 2


def test_a_checkpoint_round_trips_as_json_lines(tmp_path):
    checkpoint = tmp_path / 'scores.jsonl'
    checkpoint.write_text(
        json.dumps({'id': 7, 'baseline': {'answer_correctness': 0.1}}) + chr(10),
        encoding='utf-8',
    )
    assert _load_checkpoint(checkpoint)[7]['baseline']['answer_correctness'] == 0.1
    assert _load_checkpoint(tmp_path / 'missing.jsonl') == {}


def test_a_persistent_provider_error_is_excluded_rather_than_fatal(monkeypatch):
    """One provider hiccup must not end a 40-query run.

    The row is still excluded from the paired test and still forces
    `formal_result: false`, so a silent partial result remains impossible.
    """
    async def always_fails(_question, _department):
        raise RuntimeError('ServerError: upstream unavailable')

    monkeypatch.setattr(run_comparison, '_attempt_pathways', always_fails)
    _skip_backoff(monkeypatch)
    rows = asyncio.run(_run_pathways([QUERY, dict(QUERY, id=2, question='Q2')]))

    assert [row['id'] for row in rows] == [1, 2], 'the run continued past the failure'
    assert all(row['rag_unattempted'] for row in rows)
    assert 'ServerError' in rows[0]['failure']


# --- A p-value alone is not a reportable result ----------------------------


@requires_scipy
def test_the_paired_test_reports_an_effect_size_and_an_interval():
    """Expected values computed by hand, not read back from the function.

    diffs = [0.2, 0.3, 0.1, 0.4]; mean 0.25; sample sd sqrt(0.05/3) = 0.1290994.
    d_z = 0.25 / 0.1290994 = 1.9364917. SE = 0.1290994 / 2 = 0.0645497, and
    t(0.975, 3) = 3.182446, so the half-width is 0.2054260.
    """
    result = statistical_treatment([0.1, 0.2, 0.3, 0.4], [0.3, 0.5, 0.4, 0.8])

    assert result['n_pairs'] == 4
    assert result['mean_difference'] == pytest.approx(0.25)
    assert result['effect_size']['cohens_d_z']['value'] == pytest.approx(1.9364917, abs=1e-6)
    assert result['mean_difference_ci_95']['lower'] == pytest.approx(0.0445740, abs=1e-6)
    assert result['mean_difference_ci_95']['upper'] == pytest.approx(0.4554260, abs=1e-6)
    # Every reported statistic names its own definition, so a reader does not
    # have to guess which of the several "Cohen's d" conventions was used.
    assert 'sd(rag - baseline)' in result['effect_size']['cohens_d_z']['definition']
    assert 'W+' in result['effect_size']['rank_biserial_correlation']['definition']
    assert 't interval' in result['mean_difference_ci_95']['method']


@requires_scipy
def test_the_interval_is_centred_on_the_mean_difference_and_signed_toward_rag():
    better = statistical_treatment([0.1, 0.2, 0.3, 0.4], [0.3, 0.5, 0.4, 0.8])
    worse = statistical_treatment([0.3, 0.5, 0.4, 0.8], [0.1, 0.2, 0.3, 0.4])

    # Positive favours the RAG arm, matching the direction both tests are given.
    assert better['mean_difference'] > 0
    assert better['effect_size']['cohens_d_z']['value'] > 0
    assert worse['mean_difference'] == pytest.approx(-better['mean_difference'])
    assert worse['effect_size']['cohens_d_z']['value'] == pytest.approx(
        -better['effect_size']['cohens_d_z']['value'],
    )

    interval = better['mean_difference_ci_95']
    midpoint = (interval['lower'] + interval['upper']) / 2
    assert midpoint == pytest.approx(better['mean_difference'])
    assert interval['lower'] < better['mean_difference'] < interval['upper']


@requires_scipy
@pytest.mark.parametrize(('diffs', 'expected'), [
    ([0.1, 0.2, 0.3], 1.0),          # every pair favours RAG
    ([-0.1, -0.2, -0.3], -1.0),      # every pair favours the baseline
    ([0.1, 0.2, -0.3], 0.0),         # ranks 1 + 2 against 3: balanced
    ([0.0, 0.0], None),              # nothing to rank
])
def test_rank_biserial_correlation_is_bounded_and_signed(diffs, expected):
    """The signed-rank effect size, for the branch where d_z is weakest.

    Wilcoxon is chosen precisely when the differences are not normal, and d_z
    presumes they sit on a meaningful interval scale, so the rank-based figure
    is the one that belongs beside that test.
    """
    assert _rank_biserial_correlation(diffs) == expected


def test_a_run_too_small_to_test_reports_no_effect_size():
    """The note must not be accompanied by statistics that were never computed."""
    result = statistical_treatment([0.2, 0.4], [0.3, 0.5])

    assert 'At least three complete score pairs' in result['note']
    for absent in ('effect_size', 'mean_difference', 'mean_difference_ci_95', 'n_pairs'):
        assert absent not in result


@requires_scipy
def test_the_original_statistical_contract_is_unchanged():
    """Section 3.2.5's own wording depends on these keys."""
    result = statistical_treatment([0.1, 0.2, 0.3, 0.4], [0.3, 0.5, 0.4, 0.8])

    assert result['test'] in ('paired-samples t-test', 'Wilcoxon Signed-Rank test')
    assert result['shapiro_wilk']['normal'] is True
    assert isinstance(result['significant_at_0.05'], bool)
    assert 0.0 <= result['p_value'] <= 1.0


# --- Notices must not be silently pooled with research answers -------------


def _diagnostic_rows():
    """Two research answers, one notice, and one query that never ran."""
    rows = [
        {'id': 1, 'rag_kind': chat_notices.KIND_ANSWER},
        {'id': 2, 'rag_kind': chat_notices.KIND_ANSWER},
        {'id': 3, 'rag_kind': chat_notices.KIND_NOTICE},
        {'id': 4, 'rag_kind': None},
    ]
    rag_scores = [
        {'faithfulness': 0.9, 'context_precision': 0.8},
        {'faithfulness': 0.7, 'context_precision': 0.6},
        # A no-evidence notice scores zero on both while still holding contexts.
        {'faithfulness': 0.0, 'context_precision': 0.0},
        {'faithfulness': None, 'context_precision': None},
    ]
    return rows, rag_scores


def test_rag_diagnostics_report_answers_apart_from_notices():
    summary = summarize_rag_diagnostics(*_diagnostic_rows())
    faithfulness = summary['faithfulness']

    # The whole point: pooling the notice moves the headline figure by 0.27,
    # for a reason that is neither a retrieval nor a grounding failure.
    assert faithfulness['mean'] == pytest.approx((0.9 + 0.7 + 0.0) / 3)
    assert faithfulness['answers_only']['mean'] == pytest.approx(0.8)
    assert faithfulness['answers_only']['n'] == 2
    assert faithfulness['notices_only']['mean'] == pytest.approx(0.0)
    assert faithfulness['notices_only']['n'] == 1

    precision = summary['context_precision']
    assert precision['answers_only']['mean'] == pytest.approx(0.7)
    assert precision['notices_only']['mean'] == pytest.approx(0.0)


def test_the_pooled_diagnostic_figure_is_unchanged_by_the_split():
    """Earlier artifacts quote `mean`, so it has to keep its old meaning."""
    summary = summarize_rag_diagnostics(*_diagnostic_rows())

    for metric in ('faithfulness', 'context_precision'):
        entry = summary[metric]
        assert entry['n'] == 3, 'a non-finite score must stay excluded'
        assert entry['not_applicable'] == 1
        # A query the provider never served belongs to neither population.
        assert entry['answers_only']['n'] + entry['notices_only']['n'] == entry['n']


def test_a_metric_with_no_usable_scores_reports_none_rather_than_zero():
    rows = [{'id': 1, 'rag_kind': chat_notices.KIND_ANSWER}]
    summary = summarize_rag_diagnostics(rows, [{'faithfulness': None, 'context_precision': None}])

    assert summary['faithfulness']['mean'] is None
    assert summary['faithfulness']['n'] == 0
    assert summary['faithfulness']['answers_only']['mean'] is None


def test_the_row_records_whether_the_rag_arm_answered_or_only_noticed(monkeypatch):
    """Classified from the response object, the way production classifies it."""
    _patch_pathways(monkeypatch, ['The study reported 94.2% accuracy [1].'])
    answered = asyncio.run(_run_pathways([QUERY]))
    assert answered[0]['rag_kind'] == chat_notices.KIND_ANSWER

    notice = f'{chat_notices.NO_RELEVANT_PREFIX} CCSICT archive for that query.'
    _patch_pathways(monkeypatch, [notice])
    refused = asyncio.run(_run_pathways([QUERY]))
    # Still scored and never retried — but not a research answer.
    assert refused[0]['rag_kind'] == chat_notices.KIND_NOTICE
    assert refused[0]['rag_unattempted'] is False
