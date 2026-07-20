"""RAG Retrieval Phase (thesis paper, Section 3.2.3 — Phase 3).

Embeds the query, runs cosine-similarity search through the Supabase
`match_chunks` RPC, groups results by paper, applies LongContextReorder to
counter the "Lost in the Middle" phenomenon, and produces metadata-rich,
numbered context blocks for traceable in-line citations.

Indirect access model: user-facing sources NEVER include PDF URLs, storage
paths, or full-text content — metadata only.
"""

import html
import logging
import re

from supabase import create_client

from config import settings
from services.embedder import embed_text
from services.index_provenance import retrieval_provenance_params
from services.network_retry import retry_transient

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


def public_source(paper: dict, similarity: float | None = None, *, chunk: dict | None = None,
                  citation_id: int | None = None) -> dict:
    """Return citation metadata only; never expose archived chunk text."""
    source = {
        'id': paper.get('id'),
        'title': paper.get('title', ''),
        'authors': paper.get('authors', ''),
        'year': paper.get('year'),
        'track': paper.get('track', ''),
        'department': paper.get('department', ''),
    }
    if similarity is not None:
        source['similarity'] = round(similarity * 100, 2)
    if citation_id is not None:
        source['citation_id'] = citation_id
    if chunk is not None:
        location = chunk_location(chunk)
        source.update({
            'chunk_id': chunk.get('id'),
            'chunk_index': chunk.get('chunk_index'),
            **location,
        })
    return source


def chunk_location(chunk: dict) -> dict:
    """Read location columns first, then legacy JSON metadata."""
    metadata = chunk.get('metadata') or {}
    return {
        'page_start': chunk.get('page_start') or metadata.get('page_start'),
        'page_end': chunk.get('page_end') or metadata.get('page_end'),
        'section': chunk.get('section') or metadata.get('section'),
    }


def split_author_names(authors: str) -> list[str]:
    """Split the archive's comma/semicolon-delimited author metadata."""
    return [
        value.strip()
        for value in re.split(r'\s*(?:,|;|\band\b)\s*', authors or '', flags=re.IGNORECASE)
        if value.strip()
    ]


def _single_author_name_matches(requested_name: str, archived_name: str) -> bool:
    """Allow omitted middle names without matching across two different authors."""
    requested = re.findall(r"[a-z]+", (requested_name or '').lower())
    archived = set(re.findall(r"[a-z]+", (archived_name or '').lower()))
    return len(requested) >= 2 and requested[0] in archived and requested[-1] in archived


def _author_name_matches(name: str, authors: str) -> bool:
    """Match one archived author while allowing omitted middle names or initials."""
    return any(
        _single_author_name_matches(name, archived_name)
        for archived_name in split_author_names(authors)
    )


def _author_query(fragment: str, department_filter: str | None, limit: int):
    def execute_query():
        query = sb.table('papers') \
            .select('id,title,authors,year,track,department') \
            .ilike('authors', f'%{fragment}%')
        if department_filter:
            query = query.eq('department', department_filter)
        return query.limit(limit).execute()

    return retry_transient(
        execute_query,
        label='Supabase author lookup',
        logger=logger,
    ).data or []


def find_papers_by_author(name: str, department_filter: str | None = None) -> list[dict]:
    """Metadata-only author lookup with a conservative middle-name fallback."""
    papers = _author_query(name, department_filter, 5)
    if not papers:
        parts = re.findall(r"[A-Za-z]+", name or '')
        if len(parts) >= 2:
            candidates = _author_query(parts[-1], department_filter, 20)
            papers = [
                paper for paper in candidates
                if _author_name_matches(name, paper.get('authors', ''))
            ][:5]
    return [public_source(paper) for paper in papers]


def find_papers_by_ids(paper_ids: list[str], department_filter: str | None = None) -> list[dict]:
    """Re-fetch prior guest references under the server-enforced department."""
    unique_ids = list(dict.fromkeys(paper_ids))[:5]
    if not unique_ids:
        return []
    def execute_query():
        query = sb.table('papers') \
            .select('id,title,authors,year,track,department') \
            .in_('id', unique_ids)
        if department_filter:
            query = query.eq('department', department_filter)
        return query.limit(5).execute()

    rows = retry_transient(
        execute_query,
        label='Supabase guest reference lookup',
        logger=logger,
    ).data or []
    by_id = {paper.get('id'): paper for paper in rows}
    return [public_source(by_id[paper_id]) for paper_id in unique_ids if paper_id in by_id]


def _is_missing_column_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        getattr(error, 'code', None) == '42703'
        or "'code': '42703'" in message
        or ('column ' in message and ' does not exist' in message)
    )


_PAPER_QUERY_STOPWORDS = {
    'a', 'about', 'all', 'an', 'and', 'are', 'author', 'authors', 'by', 'explain',
    'for', 'from', 'in', 'is', 'it', 'of', 'paper', 'research', 'study', 'tell',
    'the', 'their', 'them', 'thesis', 'this', 'what', 'who', 'with',
}


def _search_terms(text: str) -> list[str]:
    terms = []
    for token in re.findall(r'[a-z0-9]+', (text or '').lower()):
        if token.endswith('ies') and len(token) > 4:
            token = token[:-3] + 'y'
        elif token.endswith('s') and len(token) > 4:
            token = token[:-1]
        if token not in _PAPER_QUERY_STOPWORDS and len(token) > 2:
            terms.append(token)
    synonyms = {
        'methodology': ['method'],
        'method': ['methodology'],
        'finding': ['result', 'conclusion'],
        'result': ['finding', 'conclusion'],
        'scope': ['delimitation'],
        'evaluation': ['assessment'],
    }
    for term in list(terms):
        terms.extend(synonyms.get(term, []))
    return terms


def rank_paper_chunks(chunks: list[dict], question: str, paper: dict) -> list[dict]:
    """Rank chunks within a verified paper using section-aware lexical evidence."""
    paper_terms = set(_search_terms(f'{paper.get("title", "")} {paper.get("authors", "")}'))
    query_terms = [term for term in _search_terms(question) if term not in paper_terms]
    if not query_terms:
        return chunks

    ranked = []
    for chunk in chunks:
        location = chunk_location(chunk)
        content_terms = _search_terms(chunk.get('content', ''))
        section_terms = _search_terms(location.get('section') or '')
        content_counts = {term: content_terms.count(term) for term in set(query_terms)}
        section_counts = {term: section_terms.count(term) for term in set(query_terms)}
        score = sum(min(count, 4) for count in content_counts.values())
        score += 3 * sum(min(count, 2) for count in section_counts.values())
        normalized_content = re.sub(r'\s+', ' ', chunk.get('content', '').lower())
        if 'objective' in query_terms and 'objectives of the study' in normalized_content:
            score += 20
        if 'scope' in query_terms and 'scope and delimitation' in normalized_content:
            score += 20
        if {'method', 'methodology'} & set(query_terms) and '3.2 methods' in normalized_content:
            score += 20
        ranked.append((score, chunk))
    if not any(score for score, _chunk in ranked):
        return chunks
    return [
        chunk for _score, chunk in sorted(
            ranked,
            key=lambda item: (item[0], -(item[1].get('chunk_index') or 0)),
            reverse=True,
        )
    ]


def get_paper_overview_context(
    paper_id: str,
    department_filter: str | None = None,
    question: str | None = None,
):
    """Load overview or question-ranked chunks from one verified paper index."""
    def fetch_paper():
        query = sb.table('papers').select(
            'id,title,authors,year,track,department,active_index_version'
        ).eq('id', paper_id)
        if department_filter:
            query = query.eq('department', department_filter)
        return query.limit(1).execute()

    try:
        paper_rows = retry_transient(
            fetch_paper,
            label='Supabase referenced paper lookup',
            logger=logger,
        ).data or []
    except Exception as error:
        if not _is_missing_column_error(error):
            raise

        # Compatibility until the optional citation-index migration is applied.
        def fetch_legacy_paper():
            query = sb.table('papers').select(
                'id,title,authors,year,track,department'
            ).eq('id', paper_id)
            if department_filter:
                query = query.eq('department', department_filter)
            return query.limit(1).execute()

        paper_rows = retry_transient(
            fetch_legacy_paper,
            label='Supabase legacy referenced paper lookup',
            logger=logger,
        ).data or []
    if not paper_rows:
        return '', [], 0.0
    paper = paper_rows[0]

    def fetch_chunks():
        query = sb.table('chunks') \
            .select('id,paper_id,content,chunk_index,page_start,page_end,section,index_version,metadata') \
            .eq('paper_id', paper_id)
        if paper.get('active_index_version'):
            query = query.eq('index_version', paper['active_index_version'])
        return query.order('chunk_index').limit(200 if question else 7).execute()

    try:
        chunk_rows = retry_transient(
            fetch_chunks,
            label='Supabase referenced paper context',
            logger=logger,
        ).data or []
    except Exception as error:
        if not _is_missing_column_error(error):
            raise

        def fetch_legacy_chunks():
            return sb.table('chunks') \
                .select('id,paper_id,content,chunk_index,metadata') \
                .eq('paper_id', paper_id) \
                .order('chunk_index') \
                .limit(200 if question else 7).execute()

        chunk_rows = retry_transient(
            fetch_legacy_chunks,
            label='Supabase legacy referenced paper context',
            logger=logger,
        ).data or []
    # Chunk zero is normally the cover/title page. Prefer substantive early
    # sections, but retain it as a fallback for very short legacy indexes.
    substantive = [chunk for chunk in chunk_rows if (chunk.get('chunk_index') or 0) > 0]
    candidates = substantive or chunk_rows
    selected = (
        rank_paper_chunks(candidates, question, paper)[:5]
        if question
        else candidates[:5]
    )
    if not selected:
        return '', [], 0.0

    context_parts = []
    sources = []
    for citation_id, chunk in enumerate(selected, start=1):
        location = chunk_location(chunk)
        meta_bits = [
            f'Title: {paper.get("title", "Untitled thesis")}',
            f'Authors: {paper.get("authors", "Unknown authors")}',
        ]
        if paper.get('track'):
            meta_bits.append(f'Track: {paper["track"]}')
        if paper.get('department'):
            meta_bits.append(f'Department: {paper["department"]}')
        if location['page_start']:
            page_label = (
                str(location['page_start'])
                if not location['page_end'] or location['page_end'] == location['page_start']
                else f'{location["page_start"]}-{location["page_end"]}'
            )
            meta_bits.append(f'Pages: {page_label}')
        if location['section']:
            meta_bits.append(f'Section: {location["section"]}')
        safe_content = html.escape(chunk.get('content', ''), quote=False)
        context_parts.append(f'[{citation_id}] {" | ".join(meta_bits)}\n{safe_content}')
        sources.append(public_source(
            paper,
            chunk=chunk,
            citation_id=citation_id,
        ))
    return '\n\n'.join(context_parts), sources, 1.0


def search_chunks(
    question: str,
    department_filter: str | None = None,
    query_embedding: list[float] | None = None,
):
    """Return (context, sources, top_similarity) for a natural-language query."""
    q_embedding = query_embedding if query_embedding is not None else embed_text(question)
    result = retry_transient(
        lambda: sb.rpc('match_chunks', {
            'query_embedding': q_embedding,
            'match_count': settings.retrieval_match_count,
            'match_threshold': settings.retrieval_threshold,
            'p_department': department_filter,
            **retrieval_provenance_params(),
        }).execute(),
        label='Supabase chunk retrieval',
        logger=logger,
    )
    chunks = result.data or []
    if not chunks:
        return '', [], 0.0

    # Legacy indexes store page/section locations in JSON metadata because
    # the page-aware columns may not exist yet.
    if any(not chunk.get('page_start') and not chunk.get('section') for chunk in chunks):
        chunk_ids = [chunk['id'] for chunk in chunks if chunk.get('id') is not None]
        metadata_rows = retry_transient(
            lambda: sb.table('chunks').select('id,metadata').in_('id', chunk_ids).execute(),
            label='Supabase legacy chunk location lookup',
            logger=logger,
        ).data or []
        metadata_by_id = {row['id']: row.get('metadata') or {} for row in metadata_rows}
        chunks = [
            {**chunk, 'metadata': metadata_by_id.get(chunk.get('id'), chunk.get('metadata') or {})}
            for chunk in chunks
        ]

    top_similarity = max(c.get('similarity', 0.0) for c in chunks)

    # Fetch paper metadata for the retrieved chunks
    paper_ids = list({c['paper_id'] for c in chunks})
    papers_res = retry_transient(
        lambda: sb.table('papers')
        .select('id,title,authors,year,track,department')
        .in_('id', paper_ids).execute(),
        label='Supabase citation metadata lookup',
        logger=logger,
    )
    paper_lookup = {p['id']: p for p in (papers_res.data or [])}

    # Rank individual evidence chunks, assign stable citations, then reorder.
    ranked = sorted(chunks, key=lambda item: item.get('similarity', 0.0), reverse=True)
    cited_chunks = [{**chunk, 'citation_id': index + 1} for index, chunk in enumerate(ranked)]
    reordered = long_context_reorder(cited_chunks)

    context_parts: list[str] = []
    for chunk in reordered:
        p = paper_lookup.get(chunk['paper_id'])
        if not p:
            continue
        n = chunk['citation_id']
        meta_bits = [f"Title: {p.get('title', '?')}"]
        if p.get('authors'):
            meta_bits.append(f"Authors: {p['authors']}")
        if p.get('track'):
            meta_bits.append(f"Track: {p['track']}")
        if p.get('year'):
            meta_bits.append(f"Year: {p['year']}")
        if p.get('department'):
            meta_bits.append(f"Department: {p['department']}")
        location = chunk_location(chunk)
        page_start = location['page_start']
        page_end = location['page_end']
        if page_start:
            page_label = str(page_start) if not page_end or page_end == page_start else f'{page_start}-{page_end}'
            meta_bits.append(f'Pages: {page_label}')
        if location['section']:
            meta_bits.append(f"Section: {location['section']}")
        safe_content = html.escape(chunk['content'], quote=False)
        context_parts.append(f"[{n}] {' | '.join(meta_bits)}\n{safe_content}")

    # Sources list indexed by citation number ([1] == sources[0])
    sources = []
    for chunk in cited_chunks:
        p = paper_lookup.get(chunk['paper_id'])
        if p:
            sources.append(public_source(
                p,
                chunk.get('similarity', 0.0),
                chunk=chunk,
                citation_id=chunk['citation_id'],
            ))

    context = '\n\n'.join(context_parts)
    return context, sources, top_similarity


def check_topic_duplication(
    question: str,
    threshold: float | None = None,
    query_embedding: list[float] | None = None,
    department_filter: str | None = None,
) -> dict | None:
    """Query-time 85% novelty guard (paper, Section 1.3 Duplication Parameter).

    Returns a duplication alert payload when the query's similarity to any
    archived chunk meets or exceeds the threshold, otherwise None.
    """
    threshold = threshold if threshold is not None else settings.duplication_threshold
    try:
        q_embedding = query_embedding if query_embedding is not None else embed_text(question)
        res = retry_transient(
            lambda: sb.rpc('check_topic_duplication', {
                'query_embedding': q_embedding,
                'dup_threshold': threshold,
                'p_department': department_filter,
                **retrieval_provenance_params(),
            }).execute(),
            label='Supabase duplication check',
            logger=logger,
        )
    except Exception as e:
        logger.error('Topic duplication check failed (%s)', type(e).__name__)
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
            'department': match.get('department', ''),
        },
        'matched_abstract': (match.get('abstract') or '')[:600],
        'matched_excerpt': (match.get('chunk_content') or '')[:600],
        'matched_location': {
            'chunk_id': match.get('chunk_id'),
            'chunk_index': match.get('chunk_index'),
            'page_start': match.get('page_start'),
            'page_end': match.get('page_end'),
            'section': match.get('section'),
        },
    }
