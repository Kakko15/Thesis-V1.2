"""RAG Retrieval Phase (thesis paper, Section 3.2.3 — Phase 3).

Embeds the query, runs cosine-similarity search through the Supabase
`match_chunks` RPC, groups results by paper, applies LongContextReorder to
counter the "Lost in the Middle" phenomenon, and produces metadata-rich,
numbered context blocks for traceable in-line citations.

Indirect access model: user-facing sources NEVER include PDF URLs, storage
paths, or full-text content — metadata only.
"""

import logging

from supabase import create_client

from config import settings
from services.embedder import embed_text

logger = logging.getLogger(__name__)

sb = create_client(settings.supabase_url, settings.supabase_key)


def long_context_reorder(items: list) -> list:
    """LangChain's LongContextReorder algorithm (Liu et al., 2024).

    Input is ordered most-relevant-first; output places the most relevant
    items at the very beginning and very end of the context window, where
    the LLM's attention is mathematically strongest.
    """
    reordered: list = []
    for i, value in enumerate(reversed(items)):
        if i % 2 == 1:
            reordered.append(value)
        else:
            reordered.insert(0, value)
    return reordered


def public_source(paper: dict, similarity: float | None = None) -> dict:
    """Strip a paper record down to citation metadata only (indirect access)."""
    source = {
        'id': paper.get('id'),
        'title': paper.get('title', ''),
        'authors': paper.get('authors', ''),
        'year': paper.get('year'),
        'track': paper.get('track', ''),
    }
    if similarity is not None:
        source['similarity'] = round(similarity * 100, 2)
    return source


def find_papers_by_author(name: str, department_filter: str | None = None) -> list[dict]:
    """Exact metadata lookup for person/author questions; no LLM is involved."""
    query = sb.table('papers') \
        .select('id,title,authors,year,track,department') \
        .ilike('authors', f'%{name}%')
    if department_filter:
        query = query.eq('department', department_filter)
    result = query.limit(5).execute()
    return [public_source(paper) for paper in (result.data or [])]


def search_chunks(
    question: str,
    match_count: int | None = None,
    threshold: float | None = None,
    department_filter: str | None = None,
    query_embedding: list[float] | None = None,
):
    """Return (context, sources, top_similarity) for a natural-language query."""
    match_count = match_count or settings.retrieval_match_count
    threshold = threshold if threshold is not None else settings.retrieval_threshold

    q_embedding = query_embedding if query_embedding is not None else embed_text(question)
    result = sb.rpc('match_chunks', {
        'query_embedding': q_embedding,
        'match_count': match_count,
        'match_threshold': threshold,
        'p_department': department_filter
    }).execute()
    chunks = result.data or []
    if not chunks:
        return '', [], 0.0

    top_similarity = max(c.get('similarity', 0.0) for c in chunks)

    # Fetch paper metadata for the retrieved chunks
    paper_ids = list({c['paper_id'] for c in chunks})
    papers_res = sb.table('papers') \
        .select('id,title,authors,year,track') \
        .in_('id', paper_ids).execute()
    paper_lookup = {p['id']: p for p in (papers_res.data or [])}

    # Group chunks per paper, keeping the papers ordered by best similarity
    grouped: dict[str, dict] = {}
    for c in chunks:
        entry = grouped.setdefault(c['paper_id'], {'chunks': [], 'best_similarity': 0.0})
        entry['chunks'].append(c['content'])
        entry['best_similarity'] = max(entry['best_similarity'], c.get('similarity', 0.0))

    ranked = sorted(grouped.items(), key=lambda kv: kv[1]['best_similarity'], reverse=True)

    # Counter "Lost in the Middle": most relevant papers land at the start
    # and end of the prompt context window.
    reordered = long_context_reorder(ranked)

    # Numbered citation indices follow relevance rank (not reorder position)
    # so [1] is always the strongest source.
    citation_order = {pid: i + 1 for i, (pid, _) in enumerate(ranked)}

    context_parts = []
    for pid, entry in reordered:
        p = paper_lookup.get(pid)
        if not p:
            continue
        n = citation_order[pid]
        meta_bits = [f"Title: {p.get('title', '?')}"]
        if p.get('authors'):
            meta_bits.append(f"Authors: {p['authors']}")
        if p.get('track'):
            meta_bits.append(f"Track: {p['track']}")
        if p.get('year'):
            meta_bits.append(f"Year: {p['year']}")
        combined_text = '\n...\n'.join(entry['chunks'])
        context_parts.append(f"[{n}] {' | '.join(meta_bits)}\n{combined_text}")

    # Sources list indexed by citation number ([1] == sources[0])
    sources = []
    for pid, entry in ranked:
        p = paper_lookup.get(pid)
        if p:
            sources.append(public_source(p, entry['best_similarity']))

    context = '\n\n'.join(context_parts)
    return context, sources, top_similarity


def check_topic_duplication(
    question: str,
    threshold: float | None = None,
    query_embedding: list[float] | None = None,
) -> dict | None:
    """Query-time 85% novelty guard (paper, Section 1.3 Duplication Parameter).

    Returns a duplication alert payload when the query's similarity to any
    archived chunk meets or exceeds the threshold, otherwise None.
    """
    threshold = threshold if threshold is not None else settings.duplication_threshold
    try:
        q_embedding = query_embedding if query_embedding is not None else embed_text(question)
        res = sb.rpc('check_topic_duplication', {
            'query_embedding': q_embedding,
            'dup_threshold': threshold,
        }).execute()
    except Exception as e:
        logger.error('Topic duplication check failed: %s', e)
        return None

    if not res.data:
        return None

    match = res.data[0]
    return {
        'flagged': True,
        'similarity': round(match['similarity'] * 100, 2),
        'threshold': round(threshold * 100, 2),
        'matched_paper': {
            'id': match['paper_id'],
            'title': match.get('title', ''),
            'authors': match.get('authors', ''),
            'year': match.get('year'),
            'track': match.get('track', ''),
        },
        'matched_abstract': (match.get('abstract') or '')[:600],
        'matched_excerpt': (match.get('chunk_content') or '')[:600],
    }
