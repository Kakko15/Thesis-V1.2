"""Automatic novelty screening of new submissions (thesis paper, Section 3.2.3 — Phase 3).

"To maintain originality within the academic library, the system
automatically screens new submissions against existing documents. It
calculates the similarity between texts, and if a new entry reaches an
85% match or higher, the system flags it."

Runs inside the upload ingestion pipeline AFTER embedding but BEFORE the
new chunks are indexed, so a manuscript is never compared against itself.
Screening only flags — it never blocks ingestion: potential duplicates are
surfaced to the administrator with their exact match percentage.
"""

import logging

from config import settings
from services.retriever import sb

logger = logging.getLogger(__name__)

_TOP_MATCHED_PAPERS = 3


def aggregate_matches(matches: list[dict], total_chunks: int, threshold: float) -> dict:
    """Pure aggregation of per-chunk nearest-neighbor matches.

    `matches` holds one {'paper_id', 'similarity'} entry per new chunk whose
    best archive match met the duplication threshold.
    """
    percentage = (len(matches) / total_chunks) * 100 if total_chunks else 0.0

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

    return {
        'flagged': bool(matches),
        'duplication_percentage': round(percentage, 2),
        'threshold': round(threshold * 100, 2),
        'matched_papers': [
            {
                'id': pid,
                'match_count': entry['match_count'],
                'similarity': round(entry['highest_similarity'] * 100, 2),
            }
            for pid, entry in ranked
        ],
    }


def screen_new_submission(embeddings: list[list[float]]) -> dict:
    """Screen a new manuscript's chunk embeddings against the archive at the
    paper-mandated 85% cosine similarity duplication threshold."""
    threshold = settings.duplication_threshold
    matches = []
    for emb in embeddings:
        res = sb.rpc('match_chunks', {
            'query_embedding': emb,
            'match_count': 1,
            'match_threshold': threshold,
        }).execute()
        if res.data:
            best = res.data[0]
            matches.append({'paper_id': best['paper_id'], 'similarity': best['similarity']})

    scan = aggregate_matches(matches, len(embeddings), threshold)

    # Enrich the top matches with citation metadata for the admin UI
    pids = [p['id'] for p in scan['matched_papers']]
    if pids:
        papers_res = sb.table('papers').select('id,title,authors,year,track').in_('id', pids).execute()
        lookup = {p['id']: p for p in (papers_res.data or [])}
        for entry in scan['matched_papers']:
            p = lookup.get(entry['id'])
            if p:
                entry.update({
                    'title': p.get('title', ''),
                    'authors': p.get('authors', ''),
                    'year': p.get('year'),
                    'track': p.get('track', ''),
                })
    return scan
