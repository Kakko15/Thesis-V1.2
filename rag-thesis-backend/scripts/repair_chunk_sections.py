"""Re-derive stored chunk section labels without touching vectors.

Added 2026-09-14. ``services.chunker._is_section_heading`` used to accept any
line that opened with a decimal number and any two-word all-caps line, so
Likert legends ("4.4 - STRONGLY AGREE"), statistics sentences that wrapped
mid-clause ("0.95 indicate moderately consistent responses, although some
respondents differed in their"), extracted table rows and hardware spec lines
were stored as section titles. 29 of the 426 labelled chunks in the live index
carried one. A label is never embedded, so those rows do not need re-embedding
-- but it is worth triple in the lexical rerank
(``services.retriever._section_score``) and is printed into the model's context
as "Section: ...", so the wrong ones both mis-rank their chunk and misreport
where a cited passage came from.

The repair re-runs extraction and chunking over the archived PDF and writes
only ``chunks.section``. It refuses to write unless every chunk's stored
content reproduces byte for byte, which is the check that the chunk layout did
not move underneath the label: embeddings, offsets and page ranges are left
exactly as indexed.

Dry-run is the default. Live writes require ``--apply``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Thesis PDFs carry typographic dashes and thin spaces, and a Windows console
# defaults to cp1252, so printing a label as-is aborts the run mid-paper.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.chunker import split_document, validate_chunk_records  # noqa: E402
from services.document_processor import extract_document, is_noise_chunk  # noqa: E402
from services.retriever import sb  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true',
                        help='Write the re-derived labels. Without it nothing is written.')
    parser.add_argument('--paper-id', action='append', default=[],
                        help='Repair only this paper. Repeatable. Default: every paper.')
    return parser


def _rederive(file_bytes: bytes, filename: str) -> list[dict]:
    """Reproduce the ingestion pipeline's chunk records for one manuscript."""
    document = extract_document(file_bytes, filename)
    return validate_chunk_records([
        record for record in split_document(document)
        if not is_noise_chunk(record['content'])
    ])


def repair_paper(paper: dict, apply_changes: bool) -> dict:
    """Return a per-paper report; write only when the layout reproduces."""
    paper_id = paper['id']
    title = (paper.get('title') or '')[:60]
    storage_path = paper.get('storage_path')
    if not storage_path:
        return {'id': paper_id, 'title': title, 'status': 'skipped', 'reason': 'no storage_path'}

    # Only the active index. A reindexed paper keeps its previous rows in
    # `chunks`, and the oldest paper in this archive still carries a 4-chunk
    # legacy-char-v0 index alongside its 3-chunk token-v1 one. Selecting on
    # paper_id alone returned all 7, which no re-derivation can reproduce, so
    # the guard below refused the only paper that needed it -- and the OCR
    # warnings in the same log made that look like a missing Tesseract.
    active_index = paper.get('active_index_version')
    stored = sb.table('chunks').select('id,chunk_index,content,section') \
        .eq('paper_id', paper_id).eq('index_version', active_index) \
        .order('chunk_index').execute().data or []
    if not stored:
        return {'id': paper_id, 'title': title, 'status': 'skipped', 'reason': 'no chunks'}

    try:
        file_bytes = sb.storage.from_('pdfs').download(storage_path)
        records = _rederive(bytes(file_bytes), paper.get('filename') or 'thesis.pdf')
    except Exception as error:  # noqa: BLE001 - reported per paper, never fatal
        return {'id': paper_id, 'title': title, 'status': 'error', 'reason': str(error)[:120]}

    if len(records) != len(stored):
        return {'id': paper_id, 'title': title, 'status': 'skipped',
                'reason': f'chunk count moved: {len(stored)} indexed, {len(records)} re-derived'}
    mismatched = [row['chunk_index'] for row, record in zip(stored, records)
                  if row['content'] != record['content']]
    if mismatched:
        return {'id': paper_id, 'title': title, 'status': 'skipped',
                'reason': f'content did not reproduce at chunk {mismatched[0]}'}

    changes = [(row, record['section']) for row, record in zip(stored, records)
               if row['section'] != record['section']]
    if apply_changes:
        for row, section in changes:
            sb.table('chunks').update({'section': section}).eq('id', row['id']).execute()
    return {'id': paper_id, 'title': title, 'status': 'applied' if apply_changes else 'planned',
            'changes': [(row['chunk_index'], row['section'], section) for row, section in changes]}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    query = sb.table('papers').select('id,title,filename,storage_path,active_index_version')
    if args.paper_id:
        query = query.in_('id', args.paper_id)
    papers = query.order('created_at').execute().data or []

    total_changes = 0
    for paper in papers:
        report = repair_paper(paper, args.apply)
        status = report['status']
        if status in {'skipped', 'error'}:
            print(f"[{status}] {report['title']}: {report['reason']}")
            continue
        changes = report['changes']
        total_changes += len(changes)
        print(f"[{status}] {report['title']}: {len(changes)} label(s)")
        for chunk_index, before, after in changes:
            print(f"    chunk {chunk_index:>3}  {before!r} -> {after!r}")

    verb = 'updated' if args.apply else 'would update'
    print(f"\n{verb} {total_changes} chunk label(s) across {len(papers)} paper(s)")
    if not args.apply and total_changes:
        print('Dry run. Re-run with --apply to write.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
