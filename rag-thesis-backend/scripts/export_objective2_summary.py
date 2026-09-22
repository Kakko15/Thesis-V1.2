"""Export the Objective 2 comparison into the UI-ready summary the admin console renders.

Why a generator instead of typing the numbers into the React component: the original
Overview card said "no baseline-versus-RAG scores are displayed ... this prevents
placeholder values from being mistaken for measured thesis findings." Hand-copying
figures into a component is exactly the failure that warning described, because nothing
would then keep them tied to the run that produced them. Here the component renders a
generated artifact, and ``tests/test_objective2_summary_export.py`` fails if the committed
file drifts from the source run.

The export deliberately carries **every stratum with its own significance flag**, not just
the pooled headline. Section 3.2.5 of the paper commits to the ``present`` stratum, which
does not reach significance at n=16; a card showing only the pooled improvement would
misrepresent the claim. ``quoted_stratum`` marks which row the paper actually quotes so
the UI can label it.

Run from the repository root:

    rag-thesis-backend/.venv/Scripts/python.exe -m scripts.export_objective2_summary

Writes ``rag-thesis-frontend/src/data/objective2Summary.json``, which IS committed --
the frontend must build without the evaluation harness or its results present.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / 'rag-thesis-backend' / 'evaluation' / 'results'

# The formal Objective 2 run. Pinned rather than "latest file in the directory":
# the directory holds seven earlier exploratory comparisons, and picking the newest
# would silently swap the paper's result for a rehearsal run.
SOURCE = RESULTS / 'comparison_20260913_064053.json'
RUN_ID = '5e8fb7f21db6'
RUN_DATE = '2026-09-13'
EVIDENCE_PATH = 'docs/evidence/OBJECTIVE_2_COMPARISON_2026-09-13.html'

# Section 3.2.5 quotes this stratum: it is the only one with a corpus-derived ground
# truth to be accurate against. See the 2026-09-07 block in iso25010_evidence.md.
QUOTED_STRATUM = 'present'

OUT = ROOT / 'rag-thesis-frontend' / 'src' / 'data' / 'objective2Summary.json'

STRATUM_LABELS = {
    'pooled': 'Pooled',
    'present': 'Topic present in corpus',
    'absent_topic': 'Topic absent',
    'absent_unreleased': 'Absent, unreleased',
    'absent_by_design': 'Absent by design',
}


def _round(value: float | None, places: int = 4) -> float | None:
    return None if value is None else round(float(value), places)


def _stratum(key: str, baseline: float, rag: float, n: int, stats: dict) -> dict:
    """One table row. ``stats`` is the answer_correctness statistics block."""
    ci = stats.get('mean_difference_ci_95') or {}
    effect = (stats.get('effect_size') or {}).get('cohens_d_z') or {}
    return {
        'key': key,
        'label': STRATUM_LABELS.get(key, key),
        'baseline': _round(baseline),
        'rag': _round(rag),
        'n': n,
        'delta': _round(stats.get('mean_difference')),
        'p_value': stats.get('p_value'),
        'significant': bool(stats.get('significant_at_0.05')),
        'cohens_d_z': _round(effect.get('value')),
        'ci_95': [_round(ci.get('lower')), _round(ci.get('upper'))],
        'quoted': key == QUOTED_STRATUM,
    }


def build(source: Path = SOURCE) -> dict:
    run = json.loads(source.read_text(encoding='utf-8'))
    release = run['reproducibility']['release']
    means = run['means']['answer_correctness']

    strata = [_stratum(
        'pooled', means['baseline'], means['rag'], means['n'],
        run['statistics']['answer_correctness'],
    )]
    for key, block in run['by_corpus_coverage'].items():
        correctness = block['answer_correctness']
        strata.append(_stratum(
            key, correctness['baseline'], correctness['rag'],
            correctness['n'], correctness['statistics'],
        ))

    diagnostics = {
        name: {'mean': _round(block.get('mean')), 'n': block.get('n')}
        for name, block in run['rag_diagnostics'].items()
    }

    return {
        '_generated_by': 'rag-thesis-backend/scripts/export_objective2_summary.py',
        '_do_not_edit': 'Regenerate instead; tests/test_objective2_summary_export.py pins this file.',
        'run': {
            'id': RUN_ID,
            'date': RUN_DATE,
            'generated_at': run['generated_at'],
            'git_commit': release['git_commit'],
            'prompt_version': release['prompt_version'],
            'formal_result': run['formal_result'],
            'queries_scored': run['queries_scored'],
            'queries_total': run['queries_total'],
            'department': run['evaluation_department'],
            'framework': run['evaluator']['framework'],
            'judge_model': run['evaluator']['model'],
            'answer_model': run['models']['llm'],
            'metric': 'answer_correctness',
            'evidence_path': EVIDENCE_PATH,
        },
        'quoted_stratum': QUOTED_STRATUM,
        'strata': strata,
        'diagnostics': diagnostics,
    }


def main() -> int:
    if not SOURCE.exists():
        print(f'missing source run: {SOURCE}', file=sys.stderr)
        return 1
    # A wrong RUN_ID would put a plausible-but-false provenance string on screen,
    # so refuse rather than export one that has no checkpoint behind it.
    checkpoint = RESULTS / 'checkpoints' / f'{RUN_ID}.provenance.json'
    if not checkpoint.exists():
        print(f'no checkpoint for run id {RUN_ID}: {checkpoint}', file=sys.stderr)
        return 1

    payload = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8', newline='\n',
    )

    quoted = next(s for s in payload['strata'] if s['quoted'])
    pooled = next(s for s in payload['strata'] if s['key'] == 'pooled')
    print(f'wrote {OUT.relative_to(ROOT)}')
    print(f'  run {RUN_ID} ({RUN_DATE}), {payload["run"]["queries_scored"]} queries scored')
    print(f'  pooled  {pooled["baseline"]} -> {pooled["rag"]}  '
          f'p={pooled["p_value"]:.3e}  significant={pooled["significant"]}')
    print(f'  quoted  {quoted["key"]}: {quoted["baseline"]} -> {quoted["rag"]}  '
          f'p={quoted["p_value"]:.4f}  significant={quoted["significant"]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
