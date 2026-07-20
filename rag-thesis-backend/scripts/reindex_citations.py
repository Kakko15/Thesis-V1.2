"""Safely rebuild citation-aware chunk indexes.

Dry-run is the default and performs no Supabase, storage, or Gemini calls.
Use ``--fixture-dir`` to exercise extraction/chunk mapping locally. Live work
requires the explicit ``--apply`` flag and a paper target.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import uuid
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import settings  # noqa: E402
from services.chunker import (  # noqa: E402
    CHUNKING_VERSION,
    TOKENIZER_ENCODING,
    build_chunk_metadata,
    split_document,
    record_overlap_tokens,
    validate_chunk_records,
)
from services.document_processor import extract_document, is_noise_chunk  # noqa: E402
from services.index_provenance import (  # noqa: E402
    current_index_fingerprint,
    is_embedding_compatible,
)

STATE_FILE = BACKEND_ROOT / '.reindex_items_9_16_state.json'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group()
    target.add_argument('--paper-id', help='Re-index exactly one paper UUID.')
    target.add_argument('--all', action='store_true', help='Re-index every paper with an original.')
    parser.add_argument('--apply', action='store_true', help='Authorize live storage, Gemini, and database work.')
    parser.add_argument(
        '--allow-model-change', action='store_true',
        help='Authorize replacing an active index built with another embedding model.',
    )
    parser.add_argument('--resume', action='store_true', help='Skip paper IDs already recorded as successful.')
    parser.add_argument('--prune-old', action='store_true', help='Prune eligible inactive versions after re-indexing.')
    parser.add_argument('--older-than-days', type=int, default=7, help='Inactive-index retention window (default: 7).')
    parser.add_argument('--fixture-dir', type=Path, help='Local PDF/TXT fixtures for a no-network dry-run.')
    return parser


def load_state(path: Path = STATE_FILE) -> dict:
    if not path.exists():
        return {'completed': [], 'failed': {}}
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {'completed': [], 'failed': {}}


def save_state(state: dict, path: Path = STATE_FILE) -> None:
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding='utf-8')


def build_records(file_bytes: bytes, filename: str) -> list[dict]:
    document = extract_document(file_bytes, filename)
    return validate_chunk_records([
        record for record in split_document(document)
        if not is_noise_chunk(record['content'])
    ])


def verify_records(records: list[dict], embeddings: list[list[float]] | None = None) -> None:
    if not records:
        raise ValueError('No clean, indexable chunks were produced')
    positions = [record['chunk_index'] for record in records]
    if positions != list(range(len(records))):
        raise ValueError('Chunk positions are not sequential and unique')
    for record in records:
        if not record['content'].strip():
            raise ValueError('An empty chunk was produced')
        if record['token_count'] > settings.chunk_size_tokens:
            raise ValueError('A chunk exceeds the configured token limit')
        if record['tokenizer'] != TOKENIZER_ENCODING \
                or record['chunking_version'] != CHUNKING_VERSION:
            raise ValueError('Chunk tokenizer provenance is invalid')
        if (record['page_start'] is None) != (record['page_end'] is None):
            raise ValueError('Incomplete page range')
        if record['page_start'] is not None and record['page_end'] < record['page_start']:
            raise ValueError('Invalid page range')
    if embeddings is not None:
        if len(embeddings) != len(records):
            raise ValueError('Embedding count does not match chunk count')
        if any(len(vector) != settings.embedding_dimensions for vector in embeddings):
            raise ValueError(f'Every embedding must contain {settings.embedding_dimensions} values')


def dry_run_fixtures(fixture_dir: Path) -> list[dict]:
    reports = []
    for path in sorted(fixture_dir.iterdir()):
        if path.suffix.lower() not in {'.pdf', '.txt'}:
            continue
        records = build_records(path.read_bytes(), path.name)
        verify_records(records)
        token_counts = [record['token_count'] for record in records]
        overlaps = [
            record_overlap_tokens(records[index], records[index + 1])
            for index in range(len(records) - 1)
        ]
        reports.append({
            'file': path.name,
            'chunks': len(records),
            'page_aware_chunks': sum(record['page_start'] is not None for record in records),
            'sections': sorted({record['section'] for record in records if record['section']}),
            'chunking_version': CHUNKING_VERSION,
            'tokenizer': TOKENIZER_ENCODING,
            'token_counts': {
                'maximum': max(token_counts),
                'median': statistics.median(token_counts),
            },
            'overlap_tokens': {
                'target': settings.chunk_overlap_tokens,
                'minimum': min(overlaps) if overlaps else 0,
                'median': statistics.median(overlaps) if overlaps else 0,
                'maximum': max(overlaps) if overlaps else 0,
            },
        })
    return reports


def fetch_papers(client, paper_id: str | None, all_papers: bool) -> list[dict]:
    query = client.table('papers').select(
        'id,title,authors,year,track,department,filename,storage_path,active_index_version'
    )
    if paper_id:
        query = query.eq('id', paper_id)
    elif not all_papers:
        return []
    return query.execute().data or []


def fetch_active_provenance(client, paper: dict) -> dict | None:
    """Load the active index fingerprint before any provider or storage work."""
    active_version = paper.get('active_index_version')
    if not active_version:
        return None
    rows = client.table('paper_index_versions').select(
        'paper_id,index_version,embedding_model,embedding_dimensions,'
        'preprocessing_version,chunking_version,tokenizer,chunk_size_tokens,'
        'chunk_overlap_tokens,provenance_status'
    ).eq('paper_id', paper['id']).eq('index_version', active_version).limit(1).execute().data or []
    return rows[0] if rows else None


def apply_paper(client, paper: dict, *, allow_model_change: bool = False) -> dict:
    active_provenance = fetch_active_provenance(client, paper)
    if paper.get('active_index_version') and active_provenance is None:
        raise ValueError('Active index provenance is missing; apply the Item 34 migration first')
    if active_provenance and not is_embedding_compatible(active_provenance) \
            and not allow_model_change:
        raise ValueError('Embedding model change requires --allow-model-change')

    storage_path = paper.get('storage_path')
    if not storage_path:
        raise ValueError('Original file is unavailable')
    file_bytes = client.storage.from_('pdfs').download(storage_path)
    records = build_records(file_bytes, paper.get('filename') or Path(storage_path).name)

    # Import only inside the explicitly authorized apply path. Dry-run cannot
    # initialize or call the Gemini embedding client.
    from services.embedder import embed_texts

    embeddings = embed_texts([record['content'] for record in records])
    verify_records(records, embeddings)
    staged_version = str(uuid.uuid4())
    staged_fingerprint = current_index_fingerprint()
    staged_index = {
        'paper_id': paper['id'],
        'index_version': staged_version,
        **staged_fingerprint,
    }
    rows = []
    for record, embedding in zip(records, embeddings):
        rows.append({
            'paper_id': paper['id'],
            'chunk_index': record['chunk_index'],
            'content': record['content'],
            'page_start': record['page_start'],
            'page_end': record['page_end'],
            'section': record['section'],
            'index_version': staged_version,
            'metadata': build_chunk_metadata(
                paper.get('title', ''), paper.get('authors', ''), paper.get('track', ''),
                paper.get('year'), department=paper.get('department', ''),
                page_start=record['page_start'], page_end=record['page_end'],
                section=record['section'], chunk_index=record['chunk_index'],
                token_count=record['token_count'],
            ),
            'embedding': embedding,
        })

    try:
        client.table('paper_index_versions').insert(staged_index).execute()
        for start in range(0, len(rows), 100):
            client.table('chunks').insert(rows[start:start + 100]).execute()
        staged = client.table('chunks').select(
            'id,chunk_index,page_start,page_end,section,metadata'
        ) \
            .eq('paper_id', paper['id']).eq('index_version', staged_version).execute().data or []
        if len(staged) != len(rows) or len({row['chunk_index'] for row in staged}) != len(rows):
            raise ValueError('Staged database verification failed')
        for row in staged:
            metadata = row.get('metadata') or {}
            if metadata.get('tokenizer') != TOKENIZER_ENCODING \
                    or metadata.get('chunking_version') != CHUNKING_VERSION \
                    or not isinstance(metadata.get('token_count'), int) \
                    or metadata['token_count'] > settings.chunk_size_tokens:
                raise ValueError('Staged tokenizer provenance verification failed')
        staged_provenance = client.table('paper_index_versions').select(
            'embedding_model,embedding_dimensions,preprocessing_version,'
            'chunking_version,tokenizer,chunk_size_tokens,chunk_overlap_tokens,'
            'provenance_status'
        ).eq('paper_id', paper['id']).eq('index_version', staged_version).single().execute().data
        if staged_provenance != staged_fingerprint:
            raise ValueError('Staged index fingerprint verification failed')
        client.rpc('activate_paper_index', {
            'p_paper_id': paper['id'],
            'p_index_version': staged_version,
        }).execute()
    except Exception:
        # This can only remove the inactive staged version. The prior active
        # index remains untouched because activation is the final operation.
        active_rows = client.table('papers').select('active_index_version') \
            .eq('id', paper['id']).limit(1).execute().data or []
        active_version = active_rows[0].get('active_index_version') if active_rows else None
        if active_version != staged_version:
            client.table('chunks').delete().eq('paper_id', paper['id']) \
                .eq('index_version', staged_version).execute()
            client.table('paper_index_versions').delete().eq('paper_id', paper['id']) \
                .eq('index_version', staged_version).execute()
            raise

    return {
        'paper_id': paper['id'],
        'previous_version': paper.get('active_index_version'),
        'active_version': staged_version,
        'chunks': len(rows),
        'index_fingerprint': staged_fingerprint,
    }


def run_apply(args, client, state_path: Path = STATE_FILE) -> dict:
    if not (args.paper_id or args.all or args.prune_old):
        raise ValueError('--apply requires --paper-id, --all, or --prune-old')
    if args.older_than_days < 1:
        raise ValueError('--older-than-days must be at least 1')

    state = load_state(state_path) if args.resume else {'completed': [], 'failed': {}}
    completed = set(state.get('completed', []))
    reports = []
    for paper in fetch_papers(client, args.paper_id, args.all):
        if args.resume and paper['id'] in completed:
            continue
        try:
            report = apply_paper(
                client, paper, allow_model_change=args.allow_model_change,
            )
            reports.append(report)
            completed.add(paper['id'])
            state.setdefault('failed', {}).pop(paper['id'], None)
        except Exception as error:  # continue safely with the remaining papers
            state.setdefault('failed', {})[paper['id']] = str(error)
        state['completed'] = sorted(completed)
        save_state(state, state_path)

    pruned = None
    if args.prune_old:
        result = client.rpc('prune_inactive_indexes', {
            'p_older_than_days': args.older_than_days,
        }).execute()
        pruned = result.data
    return {'reindexed': reports, 'failed': state.get('failed', {}), 'pruned_chunks': pruned}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.allow_model_change and not args.apply:
        raise ValueError('--allow-model-change is valid only with --apply')
    if not args.apply:
        report = {
            'mode': 'dry-run',
            'external_calls': 0,
            'target': args.paper_id or ('all' if args.all else None),
            'prune_requested': args.prune_old,
            'intended_index_fingerprint': current_index_fingerprint(),
            'fixtures': dry_run_fixtures(args.fixture_dir) if args.fixture_dir else [],
        }
        print(json.dumps(report, indent=2))
        return 0

    from services.retriever import sb

    print(json.dumps(run_apply(args, sb), indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
