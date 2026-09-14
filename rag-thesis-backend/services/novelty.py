"""Automatic novelty screening of new submissions (thesis paper, Section 3.2.3 — Phase 3).

"To maintain originality within the academic library, the system
automatically screens new submissions against existing documents. It
calculates the similarity between texts, and if a new entry reaches an
85% match or higher, the system flags it."

Runs inside the upload ingestion pipeline AFTER embedding but BEFORE the
new chunks are indexed, so a manuscript is never compared against itself.
Screening flags rather than blocks: potential duplicates are surfaced to the
administrator with their exact match percentage and the archived thesis they
most resemble, and faculty makes the call.

The one exception is a verbatim copy. When every chunk of the new manuscript
already sits in the archive at EXACT_DUPLICATE_SIMILARITY or above, the
manuscript is already indexed under another paper row and indexing it again
would only double every retrieval hit; `services/ingestion` refuses the job
and names the thesis it duplicates. Added 2026-09-08 after a re-export of an
archived BLIS thesis reached the "Thesis indexed!" screen flagged at 96.30%
coverage instead of being turned away.
"""

import json
import logging
from datetime import datetime, timezone

from config import settings
from services.retriever import sb
from services.index_provenance import (
    PROVENANCE_STATUS_LEGACY as PROVENANCE_LEGACY,
    PROVENANCE_STATUS_VERIFIED as PROVENANCE_VERIFIED,
    retrieval_provenance_params,
)

logger = logging.getLogger(__name__)

_TOP_MATCHED_PAPERS = 3

SCOPE_AT_UPLOAD = 'at_upload'
SCOPE_RESCAN = 'rescan'

# A per-chunk cosine similarity this high only happens when the archived
# passage is the same text. Identical input re-embedded returns vectors that
# agree to about 1e-6, and pgvector reports `1 - (a <=> b)` in float, so an
# exact `== 1.0` test would miss genuine copies. Two independently written
# theses on the same library topic land in the 0.85-0.97 band (measured
# 0.9494 highest passage on 2026-09-08) and must stay advisory.
EXACT_DUPLICATE_SIMILARITY = 0.999


def percent(value: float | int | None) -> float:
    """Normalize a public percentage while accepting legacy 0-1 ratios."""
    number = float(value or 0.0)
    return round(number * 100 if 0 < number <= 1 else number, 2)


def verdict_for_coverage(matched_chunk_percentage: float, exact_duplicate: bool = False) -> str:
    if exact_duplicate:
        return 'exact_duplicate'
    if matched_chunk_percentage <= 0:
        return 'clear'
    if matched_chunk_percentage < 50:
        return 'review_suggested'
    return 'high_overlap'


def meets_duplication_threshold(similarity: float, threshold: float | None = None) -> bool:
    """Canonical inclusive boundary used by tests and non-SQL callers."""
    return similarity >= (settings.duplication_threshold if threshold is None else threshold)


def is_exact_duplicate(matches: list[dict], total_chunks: int) -> bool:
    """True when every chunk of the manuscript is a verbatim archive passage.

    Coverage alone is not enough: 26 of 27 chunks matching at 0.85-0.95 is two
    theses about the same library, not one thesis uploaded twice. Every chunk
    has to match, and every match has to be at the verbatim band.
    """
    if total_chunks <= 0 or len(matches) != total_chunks:
        return False
    return all(float(m.get('similarity', 0.0)) >= EXACT_DUPLICATE_SIMILARITY for m in matches)


def aggregate_matches(matches: list[dict], total_chunks: int, threshold: float) -> dict:
    """Pure aggregation of per-chunk nearest-neighbor matches.

    `matches` holds one {'paper_id', 'similarity'} entry per new chunk whose
    best archive match met the duplication threshold.
    """
    coverage = (len(matches) / total_chunks) * 100 if total_chunks else 0.0
    highest = max((float(m.get('similarity', 0.0)) for m in matches), default=0.0)
    exact_duplicate = is_exact_duplicate(matches, total_chunks)

    per_paper: dict[str, dict] = {}
    for m in matches:
        entry = per_paper.setdefault(m['paper_id'], {'match_count': 0, 'highest_similarity': 0.0})
        entry['match_count'] += 1
        entry['highest_similarity'] = max(entry['highest_similarity'], m['similarity'])

    ranked = sorted(
        per_paper.items(),
        key=lambda kv: (kv[1]['match_count'], kv[1]['highest_similarity']),
        reverse=True,
    )[:_TOP_MATCHED_PAPERS]

    matched_papers = [
        {
            'id': pid,
            'match_count': entry['match_count'],
            'similarity': round(entry['highest_similarity'] * 100, 2),
        }
        for pid, entry in ranked
    ]

    return {
        'flagged': bool(matches),
        'exact_duplicate': exact_duplicate,
        'highest_similarity': percent(highest),
        'matched_chunk_percentage': round(coverage, 2),
        'matched_chunk_count': len(matches),
        'total_chunks': total_chunks,
        'verdict_level': verdict_for_coverage(coverage, exact_duplicate),
        # One-release compatibility alias. New code uses matched_chunk_percentage.
        'duplication_percentage': round(coverage, 2),
        'threshold': round(threshold * 100, 2),
        'matched_papers': matched_papers,
        # The archived thesis this manuscript most resembles: the paper that
        # absorbed the most chunks, ties broken by its closest passage. The
        # same dict as matched_papers[0], so the metadata enrichment in
        # screen_new_submission reaches it too.
        'most_similar_paper': matched_papers[0] if matched_papers else None,
    }


def _enrich_matched_papers(scan: dict) -> dict:
    """Attach citation metadata to the ranked matches for the admin UI."""
    pids = [p['id'] for p in scan['matched_papers']]
    if pids:
        papers_res = sb.table('papers').select('id,title,authors,year,track,department').in_('id', pids).execute()
        lookup = {p['id']: p for p in (papers_res.data or [])}
        for entry in scan['matched_papers']:
            p = lookup.get(entry['id'])
            if p:
                entry.update({
                    'title': p.get('title', ''),
                    'authors': p.get('authors', ''),
                    'year': p.get('year'),
                    'track': p.get('track', ''),
                    'department': p.get('department', ''),
                })
    return scan


def _archive_size(department: str, exclude_paper_id: str | None = None) -> int:
    """How many indexed theses the screen could actually have compared against.

    Stored with the result because a screening is a snapshot: a card recorded
    when the archive held two theses cannot name a closer third that arrived
    afterwards, and without this number nothing on the card says so.
    """
    try:
        query = sb.table('papers').select('id', count='exact').eq('ingestion_status', 'ready')
        if department:
            query = query.eq('department', department)
        if exclude_paper_id:
            query = query.neq('id', exclude_paper_id)
        return int(query.execute().count or 0)
    except Exception:  # noqa: BLE001 - provenance is descriptive, never a gate
        logger.warning('Could not size the archive for a duplication screening', exc_info=True)
        return 0


def _as_vector(embedding) -> list[float]:
    """pgvector columns arrive as a JSON string over PostgREST, not a list."""
    if isinstance(embedding, str):
        return json.loads(embedding)
    return list(embedding or [])


def _candidate_chunk_vectors(department: str, exclude_paper_id: str) -> list[tuple]:
    """The archive `match_chunks` would search, minus this paper's own chunks.

    Mirrors that RPC's WHERE clause so a rescan compares against exactly what
    an upload would have: the active index version only, papers that finished
    ingesting, the same department, and an index whose embedding model and
    dimensions match this server's. Each entry carries its precomputed norm so
    the scoring loop below does not recompute it per query chunk.
    """
    papers = sb.table('papers').select('id,active_index_version') \
        .eq('ingestion_status', 'ready').neq('id', exclude_paper_id)
    if department:
        papers = papers.eq('department', department)
    rows = papers.execute().data or []
    active = {row['id']: row['active_index_version'] for row in rows}
    if not active:
        return []

    provenance = sb.table('paper_index_versions') \
        .select('paper_id,index_version') \
        .in_('paper_id', list(active)) \
        .eq('embedding_model', settings.gemini_embed_model) \
        .eq('embedding_dimensions', settings.embedding_dimensions) \
        .in_('provenance_status', [PROVENANCE_VERIFIED, PROVENANCE_LEGACY]) \
        .execute().data or []
    verified = {row['paper_id'] for row in provenance
                if row['index_version'] == active.get(row['paper_id'])}
    if not verified:
        return []

    candidates: list[tuple] = []
    for paper_id in verified:
        chunks = sb.table('chunks').select('embedding') \
            .eq('paper_id', paper_id).eq('index_version', active[paper_id]).execute().data or []
        for chunk in chunks:
            vector = _as_vector(chunk['embedding'])
            norm = sum(value * value for value in vector) ** 0.5
            if norm:
                candidates.append((paper_id, vector, norm))
    return candidates


def _best_archive_match(embedding: list[float], candidates: list[tuple],
                        threshold: float) -> tuple[str | None, float]:
    """The closest archived chunk, as cosine similarity, or no match.

    pgvector reports `1 - (a <=> b)`, which is cosine similarity, so this is
    the same quantity the RPC returns for the same pair of vectors.
    """
    norm = sum(value * value for value in embedding) ** 0.5
    if not norm:
        return None, 0.0
    best_paper, best = None, 0.0
    for paper_id, vector, vector_norm in candidates:
        similarity = sum(a * b for a, b in zip(embedding, vector)) / (norm * vector_norm)
        if similarity > best:
            best_paper, best = paper_id, similarity
    return (best_paper, best) if best >= threshold else (None, 0.0)


def _stamp_scan(scan: dict, department: str, scope: str,
                exclude_paper_id: str | None = None) -> dict:
    """Record when this screening ran and how much archive it saw."""
    scan['screened_at'] = datetime.now(timezone.utc).isoformat()
    scan['archive_size'] = _archive_size(department, exclude_paper_id)
    scan['scan_scope'] = scope
    return scan


def screen_new_submission(embeddings: list[list[float]], department: str) -> dict:
    """Screen a new manuscript's chunk embeddings against the archive at the
    paper-mandated 85% cosine similarity duplication threshold."""
    threshold = settings.duplication_threshold
    matches = []
    for emb in embeddings:
        res = sb.rpc('match_chunks', {
            'query_embedding': emb,
            'match_count': 1,
            'match_threshold': threshold,
            'p_department': department,
            **retrieval_provenance_params(),
        }).execute()
        if res.data:
            best = res.data[0]
            matches.append({'paper_id': best['paper_id'], 'similarity': best['similarity']})

    scan = aggregate_matches(matches, len(embeddings), threshold)
    return _stamp_scan(_enrich_matched_papers(scan), department, SCOPE_AT_UPLOAD)


def rescan_indexed_paper(paper_id: str, department: str) -> dict:
    """Re-screen a thesis that is already in the archive, against all of it.

    `screen_new_submission` runs once, before the manuscript is indexed, so it
    only ever sees the theses that went in ahead of it. That makes every card a
    snapshot whose named paper points backwards in time: measured 2026-09-14,
    all 16 cards in the live archive name an earlier upload and none names a
    later one, and three of the four BLIS theses understated their overlap
    because the theses they most resemble were uploaded after them. One showed
    12.50% coverage where a current screen puts it at 91.67%.

    Same threshold, same aggregation and the same verdict bands as the
    ingest-time screen, and it reads embeddings that are already stored, so it
    calls no embedding model and moves no vector.

    It does not go through `match_chunks`, which the ingest-time screen uses.
    That RPC has no exclude-paper parameter, and by now this paper's own chunks
    are in the index: each one matches itself at 1.0, and the 100-token chunk
    overlap makes its neighbours match in the 0.9s too, so a `match_count` the
    size of a context window comes back holding nothing but the paper itself.
    Measured 2026-09-14, asking for eight neighbours and discarding self scored
    the Borrower's Card thesis at 38.89% coverage against the 97.22% its own
    still-current card records. Raising the count only trades that for the
    RPC's hnsw.ef_search ceiling. Scoring the candidate set directly avoids
    both, and reproduces the stored card exactly for any paper indexed last.
    """
    threshold = settings.duplication_threshold
    paper_res = sb.table('papers').select('active_index_version').eq('id', paper_id).execute()
    if not paper_res.data:
        raise ValueError(f'No such paper: {paper_id}')
    active_index = paper_res.data[0].get('active_index_version')

    rows = sb.table('chunks').select('chunk_index,embedding') \
        .eq('paper_id', paper_id).eq('index_version', active_index) \
        .order('chunk_index').execute().data or []
    embeddings = [_as_vector(row['embedding']) for row in rows]
    candidates = _candidate_chunk_vectors(department, paper_id)

    matches = []
    for emb in embeddings:
        paper_match, similarity = _best_archive_match(emb, candidates, threshold)
        if paper_match:
            matches.append({'paper_id': paper_match, 'similarity': similarity})

    scan = aggregate_matches(matches, len(embeddings), threshold)
    return _stamp_scan(_enrich_matched_papers(scan), department, SCOPE_RESCAN,
                       exclude_paper_id=paper_id)
