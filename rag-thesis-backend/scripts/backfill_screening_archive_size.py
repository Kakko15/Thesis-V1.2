"""Estimate how large the archive was when each thesis was screened.

Added 2026-09-14. Screenings only began recording `archive_size` that day, so
every earlier card shows its figures with nothing saying which archive produced
them -- and a screening taken against two theses is not comparable to one taken
against fifteen. The count can be derived from upload order: the theses in the
same department that were already indexed when this one arrived.

It is an estimate, not a measurement, and it is written under its own key so
nothing can read it as one. Three ways it can be wrong:

  * a thesis deleted since is no longer there to count,
  * a thesis that was still ingesting at that moment is counted anyway,
  * a thesis that failed then succeeded later is counted from its first row.

`archive_size` therefore keeps its meaning of "recorded at screening time" and
is never overwritten here; `archive_size_estimated` is only ever filled in when
the real figure is missing, and the UI labels it as an estimate.

Dry-run is the default. Live writes require ``--apply``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from services.retriever import sb  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true',
                        help='Write the estimates. Without it nothing is written.')
    return parser


def estimate_archive_sizes(papers: list[dict]) -> dict[str, int]:
    """Map paper id -> how many same-department theses preceded it.

    `papers` must be every ready paper, ordered by creation. Ties are resolved
    by not counting them: two theses committed in the same instant did not see
    each other, and the screen that ran first certainly did not.
    """
    counts: dict[str, int] = {}
    for paper in papers:
        department = paper.get('department') or ''
        created = paper.get('created_at') or ''
        counts[paper['id']] = sum(
            1 for other in papers
            if other['id'] != paper['id']
            and (other.get('department') or '') == department
            and (other.get('created_at') or '') < created
        )
    return counts


def plan_backfill(papers: list[dict]) -> list[tuple[dict, int]]:
    """The papers whose at-upload record has no recorded size, with its estimate."""
    estimates = estimate_archive_sizes(papers)
    planned = []
    for paper in papers:
        record = paper.get('duplication_scan')
        if not isinstance(record, dict) or not record:
            continue
        if record.get('archive_size') is not None:
            continue
        planned.append((paper, estimates[paper['id']]))
    return planned


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    papers = sb.table('papers').select('id,title,department,created_at,duplication_scan') \
        .eq('ingestion_status', 'ready').order('created_at').execute().data or []

    planned = plan_backfill(papers)
    for paper, estimate in planned:
        already = paper['duplication_scan'].get('archive_size_estimated')
        note = '' if already is None else f' (was {already})'
        print(f"  {(paper.get('title') or '')[:58]:<60} about {estimate} preceding thesis/theses{note}")
        if args.apply:
            sb.table('papers').update({
                'duplication_scan': {**paper['duplication_scan'], 'archive_size_estimated': estimate},
            }).eq('id', paper['id']).execute()

    verb = 'estimated' if args.apply else 'would estimate'
    print(f"\n{verb} the archive size for {len(planned)} of {len(papers)} paper(s)")
    if not args.apply and planned:
        print('Dry run. Re-run with --apply to write.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
