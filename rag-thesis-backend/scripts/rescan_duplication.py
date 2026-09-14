"""Re-screen archived theses against the archive as it stands today.

Added 2026-09-14. `services.novelty.screen_new_submission` runs once, during
ingestion, before the manuscript is indexed -- so a card only ever saw the
theses uploaded ahead of it and can never name a closer one that arrived
later. Measured over the live archive that day: all 16 cards named an earlier
upload, none named a later one, and the BLIS cluster had drifted badly because
its four theses went in one after another:

    BLIS Beyond Graduation   card  5.41%  ->  rescan 27.03%
    Exploring E-Resources    card 12.50%  ->  rescan 91.67%   (yellow -> red)
    Reader's Services        card 85.19%  ->  rescan 100.00%
    Borrower's Card          card 97.22%  ->  rescan 97.22%   (indexed last)

This rewrites only `papers.duplication_scan`. It re-uses the ingest-time
threshold, RPC, aggregation and verdict bands, and reads embeddings that are
already stored, so it calls no embedding model and moves no vector.

Dry-run is the default. Live writes require ``--apply``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Thesis titles carry typographic quotes, and a Windows console defaults to
# cp1252, so printing one as-is aborts the run mid-paper.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from services.novelty import percent, rescan_indexed_paper  # noqa: E402
from services.retriever import sb  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true',
                        help='Write the refreshed screening. Without it nothing is written.')
    parser.add_argument('--paper-id', action='append', default=[],
                        help='Rescan only this paper. Repeatable. Default: every ready paper.')
    return parser


def _summary(scan: dict) -> str:
    level = scan.get('verdict_level', 'clear')
    coverage = scan.get('matched_chunk_percentage', 0)
    top = (scan.get('matched_papers') or [{}])[0]
    named = (top.get('title') or top.get('id') or '-')[:48]
    return f"{level:<17} {coverage:>6.2f}% coverage, highest {percent(scan.get('highest_similarity')):>6.2f}%  {named}"


def rescan_paper(paper: dict, apply_changes: bool) -> dict:
    """Return a before/after report; write only when asked.

    The refreshed screening is nested under `rescan` rather than replacing the
    record. The at-upload screening is the only evidence of what the archive
    held on the day a thesis was accepted, and once the archive has grown it
    cannot be recomputed -- overwriting it would destroy a dated result this
    repository treats as evidence. It also keeps the card's own "at upload"
    label true. Re-running is idempotent: the nested `rescan` is replaced, the
    at-upload record underneath it never is.
    """
    paper_id = paper['id']
    title = (paper.get('title') or '')[:52]
    record = paper.get('duplication_scan') if isinstance(paper.get('duplication_scan'), dict) else {}
    before = {key: value for key, value in record.items() if key != 'rescan'}
    try:
        after = rescan_indexed_paper(paper_id, paper.get('department') or '')
    except Exception as error:  # noqa: BLE001 - reported per paper, never fatal
        return {'id': paper_id, 'title': title, 'status': 'error', 'reason': str(error)[:140]}

    changed = (
        before.get('verdict_level') != after.get('verdict_level')
        or before.get('matched_chunk_count') != after.get('matched_chunk_count')
        or ((before.get('matched_papers') or [{}])[0].get('id')
            != (after.get('matched_papers') or [{}])[0].get('id'))
    )
    if apply_changes:
        sb.table('papers').update({'duplication_scan': {**before, 'rescan': after}}) \
            .eq('id', paper_id).execute()
    return {'id': paper_id, 'title': title, 'status': 'applied' if apply_changes else 'planned',
            'changed': changed, 'before': before, 'after': after}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    query = sb.table('papers').select('id,title,department,duplication_scan') \
        .eq('ingestion_status', 'ready')
    if args.paper_id:
        query = query.in_('id', args.paper_id)
    papers = query.order('created_at').execute().data or []

    changed = 0
    for paper in papers:
        report = rescan_paper(paper, args.apply)
        if report['status'] == 'error':
            print(f"[error] {report['title']}: {report['reason']}")
            continue
        mark = '*' if report['changed'] else ' '
        changed += 1 if report['changed'] else 0
        print(f"{mark} {report['title']}")
        print(f"    was: {_summary(report['before'])}")
        print(f"    now: {_summary(report['after'])}")

    verb = 'rewrote' if args.apply else 'would rewrite'
    print(f"\n{verb} {changed} changed screening(s) of {len(papers)} paper(s)")
    if not args.apply and changed:
        print('Dry run. Re-run with --apply to write.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
