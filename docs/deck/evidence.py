"""Read every figure the deck quotes from the evidence files, never from prose.

Two sources:

* ``rag-thesis-backend/evaluation/results/comparison_20260913_064053.json`` -- the formal
  Objective 2 run. Its committed-LF sha256 is recorded in ``iso25010_evidence.md``, so the
  file is read-only here; never re-save it.
* ``rag-thesis-backend/evaluation/iso25010_evidence.md`` -- the dated revalidation block for
  Objective 4, parsed by regex so a figure the file does not contain cannot reach a slide.

``assert_quoted()`` is the third guard: every static string the deck quotes (Sonar version,
axe scan count, p95) must literally occur in the evidence file.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean

ROOT = Path(__file__).resolve().parents[2]
RESULTS_JSON = ROOT / 'rag-thesis-backend' / 'evaluation' / 'results' / 'comparison_20260913_064053.json'
EVIDENCE_MD = ROOT / 'rag-thesis-backend' / 'evaluation' / 'iso25010_evidence.md'

STRATUM_LABELS = {
    'pooled': 'Pooled',
    'present': 'present',
    'absent_topic': 'absent_topic',
    'absent_unreleased': 'absent_unreleased',
    'absent_by_design': 'absent_by_design',
}
STRATUM_PLAIN = {
    'pooled': 'all forty questions',
    'present': 'the archive can answer these',
    'absent_topic': 'no released thesis covers the topic',
    'absent_unreleased': 'the program was not released',
    'absent_by_design': 'outside the corpus by design',
}
STRATUM_ORDER = ('present', 'absent_topic', 'absent_unreleased', 'absent_by_design')


@dataclass(frozen=True)
class Stratum:
    key: str
    n: int
    baseline: float
    rag: float
    mean_diff: float
    ci_lo: float
    ci_hi: float
    p: float
    t: float
    d_z: float
    significant: bool

    @property
    def label(self) -> str:
        return STRATUM_LABELS[self.key]

    @property
    def plain(self) -> str:
        return STRATUM_PLAIN[self.key]


@dataclass(frozen=True)
class PairedRow:
    id: int
    coverage: str
    kind: str          # 'answer' | 'notice'
    baseline: float
    rag: float

    @property
    def delta(self) -> float:
        return self.rag - self.baseline


@dataclass(frozen=True)
class Comparison:
    run_id: str
    generated_at: str
    commit: str
    department: str
    formal_result: bool
    queries_scored: int
    queries_total: int
    shapiro_w: float
    shapiro_p: float
    pooled: Stratum
    strata: dict[str, Stratum]
    rows: list[PairedRow]
    models: dict[str, str]
    prompt_version: str

    @property
    def notice_rows(self) -> list[PairedRow]:
        return [r for r in self.rows if r.kind == 'notice']

    @property
    def present(self) -> Stratum:
        return self.strata['present']

    def ordered_strata(self) -> list[Stratum]:
        return [self.pooled] + [self.strata[k] for k in STRATUM_ORDER]


def _stratum(key: str, block: dict, n: int, baseline: float, rag: float) -> Stratum:
    ci = block['mean_difference_ci_95']
    return Stratum(
        key=key, n=n, baseline=baseline, rag=rag,
        mean_diff=block['mean_difference'], ci_lo=ci['lower'], ci_hi=ci['upper'],
        p=block['p_value'], t=block['statistic'],
        d_z=block['effect_size']['cohens_d_z']['value'],
        significant=bool(block['significant_at_0.05']),
    )


def load_comparison(path: Path = RESULTS_JSON) -> Comparison:
    data = json.loads(path.read_text(encoding='utf-8'))
    ac = data['statistics']['answer_correctness']
    means = data['means']['answer_correctness']
    pooled = _stratum('pooled', ac, means['n'], means['baseline'], means['rag'])
    strata = {}
    for key, block in data['by_corpus_coverage'].items():
        b = block['answer_correctness']
        strata[key] = _stratum(key, b['statistics'], b['n'], b['baseline'], b['rag'])
    rows = []
    for i, row in enumerate(data['rows']):
        rows.append(PairedRow(
            id=int(row['id']), coverage=row['corpus_coverage'], kind=row['rag_kind'],
            baseline=data['ragas']['baseline'][i]['answer_correctness'],
            rag=data['ragas']['rag'][i]['answer_correctness'],
        ))
    release = data['reproducibility']['release']
    cmp = Comparison(
        run_id=data['reproducibility']['golden_dataset_sha256'][:12],
        generated_at=data['generated_at'],
        commit=release['git_commit'][:7],
        department=data['evaluation_department'],
        formal_result=bool(data['formal_result']),
        queries_scored=int(data['queries_scored']),
        queries_total=int(data['queries_total']),
        shapiro_w=ac['shapiro_wilk']['statistic'],
        shapiro_p=ac['shapiro_wilk']['p_value'],
        pooled=pooled, strata=strata, rows=rows,
        models=release['models'], prompt_version=release['prompt_version'],
    )
    _self_check(cmp)
    return cmp


def _self_check(cmp: Comparison) -> None:
    if abs(fmean(r.delta for r in cmp.rows) - cmp.pooled.mean_diff) > 1e-9:
        raise ValueError('mean of per-row deltas does not equal the recorded mean difference')
    if sum(s.n for s in cmp.strata.values()) != cmp.pooled.n or len(cmp.rows) != cmp.pooled.n:
        raise ValueError('stratum sizes do not sum to the pooled n')
    if not cmp.formal_result or cmp.queries_scored != cmp.queries_total:
        raise ValueError('not a formal, fully scored run')
    for r in cmp.rows:
        if r.kind not in ('answer', 'notice'):
            raise ValueError(f'unexpected rag_kind {r.kind!r} on row {r.id}')


def fmt_p(p: float) -> str:
    return f'{p:.3e}' if p < 1e-3 else f'{p:.4f}'


def fmt_signed(x: float, digits: int = 4) -> str:
    return f'{x:+.{digits}f}'


def fmt_ci(lo: float, hi: float) -> str:
    return f'[{lo:+.4f}, {hi:+.4f}]'


@dataclass(frozen=True)
class IsoBlock:
    date: str
    commit: str
    backend_passed: int
    backend_skipped: int
    coverage_pct: float
    statements: int
    missed: int
    pylint: str
    fe_passed: int
    fe_suites: int
    fe_lines: float
    fe_branches: float
    fe_functions: float
    eslint_clean: bool
    playwright_passed: int | None
    raw: str


def _num(s: str) -> int:
    return int(s.replace(',', ''))


def load_iso_block(date: str = '2026-09-14', path: Path = EVIDENCE_MD) -> IsoBlock:
    text = path.read_text(encoding='utf-8')
    head = re.search(rf'^## Local revalidation - {re.escape(date)}, `([0-9a-f]+)`.*?$', text, re.M)
    if not head:
        raise ValueError(f'no "## Local revalidation - {date}" block in {path.name}')
    rest = text[head.end():]
    nxt = re.search(r'^## ', rest, re.M)
    block = rest[: nxt.start()] if nxt else rest

    def grab(pattern: str, what: str) -> re.Match:
        m = re.search(pattern, block)
        if not m:
            raise ValueError(f'{what} not found in the {date} block')
        return m

    be = grab(r'(\d[\d,]*) passed and (\d+) [^|]*?skipped; ([\d.]+)% coverage \((\d[\d,]*) statements, (\d+) missed\)', 'backend row')
    pl = grab(r'\| (10\.00/10|\d\.\d\d/10) \|', 'pylint row')
    fe = grab(r'(\d+) passed across (\d+) suites; ([\d.]+)% lines, ([\d.]+)% branches, ([\d.]+)% functions', 'frontend row')
    es = re.search(r'0 errors, 0 warnings', block)
    pw = re.search(r'Playwright[^|]*\|\s*(\d+)(?:/\d+)? passed', block)
    return IsoBlock(
        date=date, commit=head.group(1),
        backend_passed=_num(be.group(1)), backend_skipped=int(be.group(2)),
        coverage_pct=float(be.group(3)), statements=_num(be.group(4)), missed=int(be.group(5)),
        pylint=pl.group(1),
        fe_passed=int(fe.group(1)), fe_suites=int(fe.group(2)),
        fe_lines=float(fe.group(3)), fe_branches=float(fe.group(4)), fe_functions=float(fe.group(5)),
        eslint_clean=bool(es), playwright_passed=int(pw.group(1)) if pw else None,
        raw=block,
    )


def assert_quoted(strings: list[str], path: Path = EVIDENCE_MD) -> None:
    """Every static figure the deck quotes must occur literally in the evidence file."""
    text = path.read_text(encoding='utf-8')
    missing = [s for s in strings if s not in text]
    if missing:
        raise ValueError('quoted on a slide but absent from the evidence file: ' + '; '.join(missing))


if __name__ == '__main__':
    c = load_comparison()
    print(f'run {c.run_id} at {c.commit}  formal={c.formal_result}  scored {c.queries_scored}/{c.queries_total}')
    print(f'Shapiro-Wilk W={c.shapiro_w:.4f} p={c.shapiro_p:.4f}')
    for s in c.ordered_strata():
        flag = '' if s.significant else '  (not significant)'
        print(f'{s.label:18s} n={s.n:2d}  {s.baseline:.4f} -> {s.rag:.4f}  diff {fmt_signed(s.mean_diff)}'
              f'  CI {fmt_ci(s.ci_lo, s.ci_hi)}  t={s.t:.4f} p={fmt_p(s.p)} d_z={s.d_z:.4f}{flag}')
    print(f'notice rows: {[r.id for r in c.notice_rows]}')
    try:
        b = load_iso_block()
        print(f'ISO block {b.date} at {b.commit}: backend {b.backend_passed} passed / {b.backend_skipped} skipped,'
              f' {b.coverage_pct}% ({b.statements}/{b.missed}); pylint {b.pylint}; frontend {b.fe_passed}/{b.fe_suites}'
              f' {b.fe_lines}/{b.fe_branches}/{b.fe_functions}; eslint clean={b.eslint_clean}; playwright={b.playwright_passed}')
    except ValueError as exc:
        print('ISO block:', exc)
