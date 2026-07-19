"""Safely add page/section metadata to legacy chunks without re-embedding.

Dry-run is the default. ``--apply`` updates only each chunk's existing JSON
metadata after every chunk passes content-alignment and ordering checks.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.chunker import _is_section_heading, split_document  # noqa: E402
from services.document_processor import extract_document  # noqa: E402


def _shingles(text: str, size: int = 4) -> set[tuple[str, ...]]:
    words = re.findall(r'[a-z0-9]+', (text or '').lower())
    if len(words) < size:
        return {tuple(words)} if words else set()
    return {tuple(words[index:index + size]) for index in range(len(words) - size + 1)}


def _overlap(left: set, right: set) -> tuple[float, float]:
    if not left or not right:
        return 0.0, 0.0
    common = len(left & right)
    dice = (2 * common) / (len(left) + len(right))
    coverage = common / len(left)
    return dice, coverage


def _word_tokens(text: str) -> list[str]:
    return re.findall(r'[a-z0-9]+', (text or '').lower())


def _build_anchor_index(document, size: int = 6):
    tokens: list[tuple[str, int, str | None]] = []
    active_section = None
    for page in document.pages:
        if not page.text or page.page_number is None:
            continue
        for line in page.text.splitlines():
            stripped = line.strip()
            if _is_section_heading(stripped):
                active_section = stripped
            tokens.extend(
                (word, page.page_number, active_section)
                for word in _word_tokens(line)
            )
    index: dict[tuple[str, ...], list[int]] = defaultdict(list)
    words = [token[0] for token in tokens]
    for position in range(max(0, len(words) - size + 1)):
        index[tuple(words[position:position + size])].append(position)
    return tokens, index


def align_chunks(document, chunks: list[dict], max_page_span: int = 5) -> list[dict]:
    """Map legacy chunks to PDF pages using ordered content fingerprints."""
    pages = [page for page in document.pages if page.text and page.page_number is not None]
    windows = []
    for start in range(len(pages)):
        for end in range(start, min(len(pages), start + max_page_span)):
            windows.append({
                'page_start': pages[start].page_number,
                'page_end': pages[end].page_number,
                'features': _shingles(' '.join(page.text for page in pages[start:end + 1])),
            })

    records = split_document(document)
    record_features = [(_shingles(record['content']), record) for record in records]
    document_tokens, anchor_index = _build_anchor_index(document)
    anchor_size = 6
    alignments = []
    for chunk in sorted(chunks, key=lambda item: item['chunk_index']):
        features = _shingles(chunk['content'])
        ranked_windows = sorted(
            (
                (*_overlap(features, window['features']), window)
                for window in windows
            ),
            key=lambda item: (item[0], item[1]),
            reverse=True,
        )
        score, coverage, window = ranked_windows[0]
        section_record = max(
            record_features,
            key=lambda item: _overlap(features, item[0])[0],
        )[1]
        chunk_words = _word_tokens(chunk['content'])
        anchor_position = None
        anchor_offset = None
        for offset in range(max(0, len(chunk_words) - anchor_size + 1)):
            positions = anchor_index.get(tuple(chunk_words[offset:offset + anchor_size]), [])
            positions = [
                position for position in positions
                if window['page_start'] <= document_tokens[position][1] <= window['page_end']
            ]
            if positions:
                anchor_position = positions[0]
                anchor_offset = offset
                break
        anchored_section = (
            document_tokens[anchor_position][2]
            if anchor_position is not None
            else section_record.get('section')
        )
        alignments.append({
            'id': chunk['id'],
            'chunk_index': chunk['chunk_index'],
            'page_start': window['page_start'],
            'page_end': window['page_end'],
            'section': anchored_section,
            'anchor_offset': anchor_offset,
            'score': round(score, 4),
            'coverage': round(coverage, 4),
            'metadata': chunk.get('metadata') or {},
        })
    return alignments


def validate_alignments(alignments: list[dict], minimum_coverage: float = 0.70) -> None:
    if not alignments:
        raise ValueError('No legacy chunks were available for alignment')
    low_confidence = [
        item['chunk_index'] for item in alignments
        if item['coverage'] < minimum_coverage
    ]
    if low_confidence:
        raise ValueError(f'Low-confidence page mappings: {low_confidence}')
    page_starts = [item['page_start'] for item in alignments]
    if page_starts != sorted(page_starts):
        raise ValueError('Page mappings are not monotonic in chunk order')
    missing_anchors = [
        item['chunk_index'] for item in alignments
        if item.get('anchor_offset') is None
    ]
    if missing_anchors:
        raise ValueError(f'Chunks lack a PDF content anchor: {missing_anchors}')


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paper-id', required=True)
    parser.add_argument('--file', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--minimum-coverage', type=float, default=0.70)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    from services.retriever import sb

    document = extract_document(args.file.read_bytes(), args.file.name)
    chunks = sb.table('chunks').select('id,chunk_index,content,metadata') \
        .eq('paper_id', args.paper_id).order('chunk_index').execute().data or []
    alignments = align_chunks(document, chunks)
    validate_alignments(alignments, args.minimum_coverage)

    if args.apply:
        for item in alignments:
            metadata = {
                **item['metadata'],
                'page_start': item['page_start'],
                'page_end': item['page_end'],
                'section': item['section'],
                'chunk_index': item['chunk_index'],
            }
            sb.table('chunks').update({'metadata': metadata}).eq('id', item['id']).execute()

        verified = sb.table('chunks').select('id,metadata').eq('paper_id', args.paper_id) \
            .order('chunk_index').execute().data or []
        if len(verified) != len(alignments) or any(
            not (row.get('metadata') or {}).get('page_start') for row in verified
        ):
            raise ValueError('Location metadata verification failed')

    report = {
        'mode': 'apply' if args.apply else 'dry-run',
        'paper_id': args.paper_id,
        'chunks': len(alignments),
        'minimum_coverage': min(item['coverage'] for item in alignments),
        'minimum_score': min(item['score'] for item in alignments),
        'locations': [
            {key: item[key] for key in (
                'chunk_index', 'page_start', 'page_end', 'section', 'anchor_offset',
                'score', 'coverage'
            )}
            for item in alignments
        ],
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
