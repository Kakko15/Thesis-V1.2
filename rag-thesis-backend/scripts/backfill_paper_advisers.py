"""Fill papers.adviser for theses indexed before the adviser was recorded.

Added 2026-09-23 with migrations/20260923_paper_adviser.sql. From that
migration on, the upload form carries the adviser and a trigger stores it on the
paper, but every thesis already in the archive was indexed without one, so the
Thesis Library would show an adviser only on new uploads.

For each ready paper that has no adviser yet, the value is taken from, in order:

  1. its upload job's request payload, which holds the adviser for any upload
     made while the application already sent the field but the migration had
     not yet been applied -- jobs expire after thirty days, so often absent;
  2. its archived PDF, read from the private `pdfs` bucket with exactly the
     extractor the upload form and the ingestion worker use
     (services/front_matter.py), so a backfilled paper and a fresh upload of
     the same manuscript agree.

It writes only `papers.adviser`, never overwrites a value that is already set,
and touches nothing retrieval reads: no chunk, vector, provenance row or
screening moves. A scanned manuscript with no text layer reports not-found,
exactly as the upload form would; OCR is the ingestion worker's stage.

Dry-run is the default. Live writes require ``--apply``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Adviser names carry accents and typographic dashes, and a Windows console
# defaults to cp1252, so printing one as-is aborts the run mid-paper.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from dependencies.auth import sb  # noqa: E402
from services.db_errors import is_missing_column  # noqa: E402
from services.front_matter import (  # noqa: E402
    FRONT_MATTER_PAGES,
    adviser_name,
    adviser_with_source,
    front_matter_texts,
)

MIGRATION_HINT = 'Apply migrations/20260923_paper_adviser.sql first.'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true',
                        help='Write the advisers found. Without it nothing is written.')
    parser.add_argument('--paper-id', action='append', default=[],
                        help='Backfill only this paper. Repeatable. Default: every ready paper.')
    return parser


def _payload_adviser(client, paper_id: str) -> str:
    """The adviser the upload request carried, if its job still exists.

    Best effort: a failed read here only means the PDF is consulted instead.
    """
    try:
        rows = (
            client.table('upload_jobs').select('request_payload')
            .eq('id', paper_id).limit(1).execute().data or []
        )
    except Exception:  # noqa: BLE001 - the archived PDF is the fallback
        return ''
    payload = rows[0].get('request_payload') if rows else None
    if not isinstance(payload, dict):
        return ''
    # Held to the same name check as the extractor, so a payload value that is
    # not a name is treated as absent rather than written.
    return adviser_name(str(payload.get('adviser') or ''))


def _pdf_adviser(client, storage_path: str) -> tuple[str, str]:
    """The adviser read off the archived PDF, and which rule found it."""
    data = client.storage.from_('pdfs').download(storage_path)
    pages = front_matter_texts(bytes(data), FRONT_MATTER_PAGES)
    return adviser_with_source(pages)


def find_adviser(client, paper: dict) -> dict:
    """Decide one paper's adviser without writing anything."""
    report = {'id': paper['id'], 'title': (paper.get('title') or '')[:60]}
    if (paper.get('adviser') or '').strip():
        return {**report, 'status': 'kept', 'adviser': paper['adviser'], 'source': 'already set'}
    adviser = _payload_adviser(client, paper['id'])
    if adviser:
        return {**report, 'status': 'found', 'adviser': adviser, 'source': 'upload payload'}
    storage_path = paper.get('storage_path')
    if not storage_path:
        return {**report, 'status': 'skipped', 'reason': 'no storage_path'}
    try:
        adviser, rule = _pdf_adviser(client, storage_path)
    except Exception as error:  # noqa: BLE001 - reported per paper, never fatal
        return {**report, 'status': 'error', 'reason': f'{type(error).__name__}: {str(error)[:100]}'}
    if not adviser:
        return {**report, 'status': 'not-found'}
    return {**report, 'status': 'found', 'adviser': adviser, 'source': rule}


def write_adviser(client, paper_id: str, adviser: str) -> None:
    """Store one adviser, and only where the column is still empty.

    The null filter is what keeps "never overwrite" true even if an upload or
    a second run fills the row between this script's read and its write.
    """
    client.table('papers').update({'adviser': adviser}).eq('id', paper_id) \
        .is_('adviser', 'null').execute()


def _load_papers(client, paper_ids: list[str]) -> list[dict]:
    query = client.table('papers').select('id,title,filename,storage_path,adviser') \
        .eq('ingestion_status', 'ready')
    if paper_ids:
        query = query.in_('id', paper_ids)
    return query.order('created_at').execute().data or []


def main(argv: list[str] | None = None, client=None) -> int:
    args = build_parser().parse_args(argv)
    client = client or sb
    try:
        papers = _load_papers(client, args.paper_id)
    except Exception as error:  # noqa: BLE001 - a missing column has one fix
        if not is_missing_column(error):
            raise
        print(f'papers.adviser does not exist. {MIGRATION_HINT}')
        return 2

    totals = {'found': 0, 'kept': 0, 'not-found': 0, 'skipped': 0, 'error': 0}
    for paper in papers:
        report = find_adviser(client, paper)
        status = report['status']
        totals[status] += 1
        if status == 'found':
            if args.apply:
                write_adviser(client, report['id'], report['adviser'])
            label = 'applied' if args.apply else 'planned'
            print(f"[{label}] {report['title']}: {report['adviser']!r} ({report['source']})")
        elif status == 'kept':
            print(f"[kept] {report['title']}: {report['adviser']!r}")
        elif status == 'not-found':
            print(f"[not-found] {report['title']}")
        else:
            print(f"[{status}] {report['title']}: {report['reason']}")

    verb = 'wrote' if args.apply else 'would write'
    print(
        f"\n{verb} {totals['found']} adviser(s) across {len(papers)} paper(s); "
        f"{totals['kept']} already set, {totals['not-found']} not found, "
        f"{totals['skipped']} skipped, {totals['error']} error(s)"
    )
    if not args.apply and totals['found']:
        print('Dry run. Re-run with --apply to write.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
