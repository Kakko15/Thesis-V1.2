"""The admin console's Objective 2 card renders a generated file. Pin it to the run.

`src/data/objective2Summary.json` is committed so the frontend builds without the
evaluation harness present, which means nothing structural stops someone editing a
figure by hand. That is the precise failure the card it feeds used to warn about
("placeholder values ... mistaken for measured thesis findings"), so it is asserted
here instead: regenerate from the formal run and require an exact match.

The significance assertions are not redundant with the equality check. They exist so
that a *regenerated* export cannot quietly start claiming the `present` stratum is
significant -- if the source run is ever replaced with a different one, this fails and
forces the paper's Section 3.2.5 wording to be revisited in the same change.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.export_objective2_summary import (
    OUT,
    QUOTED_STRATUM,
    RUN_ID,
    SOURCE,
    build,
)

pytestmark = pytest.mark.skipif(
    not SOURCE.exists() or not OUT.exists(),
    reason='Objective 2 run artifact or generated summary is absent',
)


@pytest.fixture(scope='module')
def committed() -> dict:
    return json.loads(Path(OUT).read_text(encoding='utf-8'))


def _stratum(summary: dict, key: str) -> dict:
    return next(s for s in summary['strata'] if s['key'] == key)


def test_committed_summary_matches_the_source_run(committed):
    """The whole point: the file on disk is what the run produces, not what someone typed."""
    assert committed == build(), (
        'src/data/objective2Summary.json has drifted from the run. Regenerate with '
        'python -m scripts.export_objective2_summary'
    )


def test_summary_is_serialized_with_lf_and_trailing_newline():
    """.gitattributes mandates LF; a CRLF rewrite would churn the diff on every export."""
    raw = Path(OUT).read_bytes()
    assert b'\r' not in raw
    assert raw.endswith(b'\n')


def test_run_provenance_is_the_formal_objective_2_run(committed):
    assert committed['run']['id'] == RUN_ID
    assert committed['run']['date'] == '2026-09-13'
    assert committed['run']['formal_result'] is True
    assert committed['run']['queries_scored'] == committed['run']['queries_total'] == 40
    assert committed['run']['framework'] == 'ragas==0.4.3'


def test_pooled_result_matches_the_evidence_table(committed):
    """iso25010_evidence.md section 3.2.5: 0.2169 -> 0.3024, t=4.6990, p=3.222e-05."""
    pooled = _stratum(committed, 'pooled')
    assert pooled['baseline'] == pytest.approx(0.2169, abs=5e-5)
    assert pooled['rag'] == pytest.approx(0.3024, abs=5e-5)
    assert pooled['p_value'] == pytest.approx(3.222e-05, rel=1e-3)
    assert pooled['significant'] is True
    assert pooled['n'] == 40


def test_the_quoted_stratum_is_present_and_not_significant(committed):
    """The caveat the card is built around: +0.0601, p=0.1257, n=16, not significant.

    If this ever fails because the numbers moved, the paper's accuracy claim moved with
    them. Do not relax the assertion -- update Section 3.2.5 and the card's wording.
    """
    assert committed['quoted_stratum'] == QUOTED_STRATUM == 'present'
    present = _stratum(committed, 'present')
    assert present['quoted'] is True
    assert present['n'] == 16
    assert present['delta'] == pytest.approx(0.0601, abs=5e-5)
    assert present['p_value'] == pytest.approx(0.1257, abs=5e-5)
    assert present['significant'] is False
    lower, upper = present['ci_95']
    assert lower < 0 < upper, 'a CI excluding zero would contradict "not significant"'


def test_exactly_one_stratum_is_marked_as_quoted(committed):
    """Two gold "the figure the paper quotes" badges would be incoherent on screen."""
    assert sum(1 for s in committed['strata'] if s['quoted']) == 1


def test_every_stratum_carries_its_own_significance_flag(committed):
    """The card renders one badge per row; a missing flag would render as "not significant"."""
    assert len(committed['strata']) == 5
    for stratum in committed['strata']:
        assert isinstance(stratum['significant'], bool)
        assert stratum['n'] >= 1
        assert stratum['label'] and stratum['label'] != stratum['key'], (
            f'{stratum["key"]} has no human label; STRATUM_LABELS needs an entry'
        )


def test_small_strata_are_still_exported(committed):
    """They reach significance at n=4 and n=3 and must not be dropped to tidy the table.

    Hiding them would leave a card that shows only wins, which is the cherry-pick the
    "too small to carry a claim alone" caption exists to head off.
    """
    for key, expected_n in (('absent_unreleased', 4), ('absent_by_design', 3)):
        assert _stratum(committed, key)['n'] == expected_n
