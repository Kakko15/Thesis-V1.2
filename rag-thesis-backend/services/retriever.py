"""RAG Retrieval Phase (thesis paper, Section 3.2.3 — Phase 3).

Embeds the query, runs cosine-similarity search through the Supabase
`match_chunks` RPC, groups results by paper, applies LongContextReorder to
counter the "Lost in the Middle" phenomenon, and produces metadata-rich,
numbered context blocks for traceable in-line citations.

Indirect access model: user-facing sources NEVER include PDF URLs, storage
paths, or full-text content — metadata only.
"""
# pylint: disable=too-many-lines

import html
import logging
import re
import unicodedata

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
    # Only emitted when the caller's select included the column, so lookup
    # paths that predate the thesis category migration never mislabel a paper.
    if 'thesis_category' in paper:
        source['thesis_category'] = paper.get('thesis_category') or 'student'
    for field in (
        'adviser', 'panel_chair', 'panel_members',
        'program_code', 'program_name', 'specialization_code', 'specialization_name',
    ):
        if paper.get(field):
            source[field] = paper[field]
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


_LINE_INITIAL_MARKER = re.compile(r'(?m)^\[(\d+)\]')


def safe_chunk_text(content: str) -> str:
    """Escape archived text and neutralise anything shaped like a source header.

    Each evidence block is emitted as `[n] Title: ... | Authors: ...` followed by
    the chunk body, and `html.escape` does not touch `[`. A manuscript line
    beginning `[7] Title:` was therefore indistinguishable from a real header.

    That is not only a prompt-injection surface. The Objective 2 harness parses
    exactly this shape (`run_comparison._CONTEXT_HEADER`), so a forged header
    also inflates the retrieved-context list that Context Precision is computed
    over: measured, one real block plus one forged line yielded two blocks from
    a single source. Rewriting the bracket to a parenthesis leaves the text
    readable and the count correct.
    """
    return _LINE_INITIAL_MARKER.sub(
        r'(\1)', html.escape(content or '', quote=False),
    )


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
    requested = re.findall(r"[a-z]+", _fold_ascii(requested_name).lower())
    archived = set(re.findall(r"[a-z]+", _fold_ascii(archived_name).lower()))
    return len(requested) >= 2 and requested[0] in archived and requested[-1] in archived


def _author_name_matches(name: str, authors: str) -> bool:
    """Match one archived author while allowing omitted middle names or initials."""
    return any(
        _single_author_name_matches(name, archived_name)
        for archived_name in split_author_names(authors)
    )


def _author_token_matches(token: str, authors: str) -> bool:
    """Confirm a one-word author reference against a whole archived name part.

    The lookup itself is `ilike '%token%'`, a substring match, so a short token
    would "match" a name that merely contains it -- `ai` is inside `Rainier`.
    A single word is only a person when it is a complete name part.
    """
    return _fold_ascii(token).lower() in {
        word.lower() for word in re.findall(r"[A-Za-z]+", _fold_ascii(authors))
    }


def _author_query(fragment: str, department_filter: str | None, limit: int):
    def execute_query():
        query = sb.table('papers') \
            .select('id,title,authors,year,track,department') \
            .eq('ingestion_status', 'ready') \
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
    parts = re.findall(r"[A-Za-z]+", name or '')
    if len(parts) == 1:
        # A one-word reference ("what about enoy?") carries no first/last pair
        # for the fallback below to check, so the substring hit is confirmed
        # against whole name parts instead of being trusted.
        candidates = _author_query(parts[0], department_filter, 20)
        return [
            public_source(paper) for paper in candidates
            if _author_token_matches(parts[0], paper.get('authors', ''))
        ][:5]
    papers = _author_query(name, department_filter, 5)
    if not papers and len(parts) >= 2:
        candidates = _author_query(parts[-1], department_filter, 20)
        papers = [
            paper for paper in candidates
            if _author_name_matches(name, paper.get('authors', ''))
        ][:5]
    return [public_source(paper) for paper in papers]


_ACADEMIC_TITLE_TOKENS = frozenset({
    'dr', 'prof', 'inst', 'instructor', 'engr', 'atty', 'mr', 'ms', 'mrs', 'sir', 'maam',
    'dit', 'phd', 'ph', 'd', 'mit', 'mlis', 'rl', 'msit', 'mscs', 'lpt', 'mpa', 'mba',
    'jr', 'sr', 'ii', 'iii', 'iv',
})


def _fold_ascii(text: str) -> str:
    """Fold diacritics (e.g. Quiñones -> Quinones) for tolerant name matching."""
    decomposed = unicodedata.normalize('NFKD', text or '')
    return ''.join(ch for ch in decomposed if not unicodedata.combining(ch))


def _person_name_tokens(name: str) -> list[str]:
    """Normalize a person's name to lowercase ASCII tokens without titles/credentials."""
    raw_tokens = re.findall(r'[a-z]+', _fold_ascii(name).lower())
    return [token for token in raw_tokens if token not in _ACADEMIC_TITLE_TOKENS]


def _adviser_name_matches(requested_name: str, archived_adviser: str) -> bool:
    """Match an adviser name ignoring titles, post-nominals, middle initials, and accents."""
    requested = _person_name_tokens(requested_name)
    archived = set(_person_name_tokens(archived_adviser))
    if not requested or not archived:
        return False
    if len(requested) == 1:
        return requested[0] in archived
    return requested[0] in archived and requested[-1] in archived


def _adviser_query(fragment: str, department_filter: str | None, limit: int):
    def execute_query():
        query = sb.table('papers') \
            .select('id,title,authors,year,track,department,adviser') \
            .eq('ingestion_status', 'ready') \
            .ilike('adviser', f'%{fragment}%') \
            .order('title')
        if department_filter:
            query = query.eq('department', department_filter)
        return query.limit(limit).execute()

    return retry_transient(
        execute_query,
        label='Supabase adviser lookup',
        logger=logger,
    ).data or []


def find_papers_by_adviser(name: str, department_filter: str | None = None) -> list[dict]:
    """Metadata-only adviser lookup tolerating titles, credentials, initials, and accents."""
    tokens = _person_name_tokens(name)
    if not tokens:
        return []
    # Query by surname first; fall back to first name when the surname contains
    # a diacritic in the DB (e.g. "Quinones" against "Quiñones").
    candidates = _adviser_query(tokens[-1], department_filter, 50)
    if not candidates and len(tokens) >= 2:
        candidates = _adviser_query(tokens[0], department_filter, 50)
    matches = [
        paper for paper in candidates
        if _adviser_name_matches(name, paper.get('adviser', ''))
    ]
    return [
        public_source(paper, citation_id=index)
        for index, paper in enumerate(matches[:20], start=1)
    ]


_CATALOG_ALIASES: dict[str, tuple[str, str]] = {
    'bscs': ('program', 'BSCS'),
    'bachelor of science in computer science': ('program', 'BSCS'),
    'bsit': ('program', 'BSIT'),
    'bachelor of science in information technology': ('program', 'BSIT'),
    'bsdsa': ('program', 'BSDSA'),
    'bachelor of science in data science and analytics': ('program', 'BSDSA'),
    'bsis': ('program', 'BSIS'),
    'bachelor of science in information systems': ('program', 'BSIS'),
    'blis': ('program', 'BLIS'),
    'bachelor of library and information science': ('program', 'BLIS'),
    'wmad': ('specialization', 'WMAD'),
    'web and mobile application development': ('specialization', 'WMAD'),
    'netsec': ('specialization', 'NETSEC'),
    'network and security': ('specialization', 'NETSEC'),
}


def find_papers_by_program_or_track(
    catalog_term: str,
    department_filter: str | None = None,
    thesis_category: str | None = None,
    min_year: int | None = None,
) -> tuple[str | None, list[dict]]:
    """Authoritative SQL lookup for an active program or specialization."""
    normalized = re.sub(r'\s+', ' ', (catalog_term or '').lower()).strip()
    target = _CATALOG_ALIASES.get(normalized)
    if not target:
        return None, []
    kind, code = target
    table_name = 'programs' if kind == 'program' else 'specializations'
    column_name = 'program_id' if kind == 'program' else 'specialization_id'

    try:
        catalog_rows = retry_transient(
            lambda: sb.table(table_name)
            .select('id,code,name,active')
            .eq('code', code)
            .eq('active', True)
            .limit(1)
            .execute(),
            label=f'Supabase {kind} lookup',
            logger=logger,
        ).data or []
    except Exception as error:
        if _is_missing_column_error(error):
            return None, []
        raise
    if not catalog_rows:
        return None, []
    entry = catalog_rows[0]
    display_label = (
        f"{entry['code']} ({entry['name']})"
        if kind == 'program' and entry.get('name')
        else str(entry.get('name') or entry.get('code') or code)
    )

    def fetch_papers():
        query = sb.table('papers') \
            .select(
                'id,title,authors,adviser,year,track,department,'
                'thesis_category,program_id,specialization_id'
            ) \
            .eq('ingestion_status', 'ready') \
            .eq(column_name, entry['id']) \
            .order('title')
        if department_filter:
            query = query.eq('department', department_filter)
        if thesis_category:
            query = query.eq('thesis_category', thesis_category)
        return query.limit(500).execute()

    try:
        rows = retry_transient(
            fetch_papers,
            label=f'Supabase {kind} papers lookup',
            logger=logger,
        ).data or []
    except Exception as error:
        if thesis_category or not _is_missing_column_error(error):
            raise

        def fetch_legacy_papers():
            query = sb.table('papers') \
                .select('id,title,authors,adviser,year,track,department') \
                .eq('ingestion_status', 'ready') \
                .eq(column_name, entry['id']) \
                .order('title')
            if department_filter:
                query = query.eq('department', department_filter)
            return query.limit(500).execute()

        rows = retry_transient(
            fetch_legacy_papers,
            label=f'Supabase legacy {kind} papers lookup',
            logger=logger,
        ).data or []
    if min_year:
        rows = [
            row for row in rows
            if int(row.get('year') or 0) <= 0 or int(row.get('year') or 0) >= min_year
        ]
    _add_academic_labels(rows)
    return display_label, [
        public_source(row, citation_id=index)
        for index, row in enumerate(rows, start=1)
    ]


def find_papers_by_ids(paper_ids: list[str], department_filter: str | None = None) -> list[dict]:
    """Re-fetch prior guest references under the server-enforced department."""
    unique_ids = list(dict.fromkeys(paper_ids))[:10]
    if not unique_ids:
        return []
    def execute_query():
        query = sb.table('papers') \
            .select(
                'id,title,authors,year,track,department,program_id,specialization_id'
            ) \
            .eq('ingestion_status', 'ready') \
            .in_('id', unique_ids)
        if department_filter:
            query = query.eq('department', department_filter)
        return query.limit(10).execute()

    try:
        rows = retry_transient(
            execute_query,
            label='Supabase guest reference lookup',
            logger=logger,
        ).data or []
    except Exception as error:
        if not _is_missing_column_error(error):
            raise

        def execute_legacy_query():
            query = sb.table('papers') \
                .select('id,title,authors,year,track,department') \
                .eq('ingestion_status', 'ready') \
                .in_('id', unique_ids)
            if department_filter:
                query = query.eq('department', department_filter)
            return query.limit(10).execute()

        rows = retry_transient(
            execute_legacy_query,
            label='Supabase legacy guest reference lookup',
            logger=logger,
        ).data or []
    _add_academic_labels(rows)
    by_id = {paper.get('id'): paper for paper in rows}
    return [public_source(by_id[paper_id]) for paper_id in unique_ids if paper_id in by_id]


_TITLE_SELECT = 'id,title,authors,year,track,department,program_id,specialization_id'
_TITLE_SELECT_LEGACY = 'id,title,authors,year,track,department'


def _ready_title_candidates(
    lookup_token: str, department_filter: str | None, limit: int,
) -> list[dict]:
    """Ready papers whose title contains `lookup_token`, newest schema first.

    Shared by the exact-title and title-fragment lookups so the two cannot
    drift apart on the department scope or on the legacy-column fallback. The
    token always arrives as an `[a-z0-9]` run, so it carries no ILIKE wildcard.
    """
    def execute(select: str):
        query = sb.table('papers').select(select).eq(
            'ingestion_status', 'ready',
        ).ilike('title', f'%{lookup_token}%')
        if department_filter:
            query = query.eq('department', department_filter)
        return query.limit(limit).execute()

    try:
        return retry_transient(
            lambda: execute(_TITLE_SELECT),
            label='Supabase exact title lookup',
            logger=logger,
        ).data or []
    except Exception as error:
        if not _is_missing_column_error(error):
            raise
        # Compatibility until the optional citation-index migration is applied.
        return retry_transient(
            lambda: execute(_TITLE_SELECT_LEGACY),
            label='Supabase legacy exact title lookup',
            logger=logger,
        ).data or []


def find_papers_by_title(title: str, department_filter: str | None = None) -> list[dict]:
    """Resolve a user-supplied title to ready papers without semantic guessing."""
    normalized_title = _normalize_title(title)
    if len(normalized_title) < 8:
        return []
    # Use a distinctive literal token to fetch candidates, then require a
    # normalized full-title match below. This tolerates punctuation differences
    # such as "Real-Time" versus "Real Time" without broadening the result.
    title_tokens = re.findall(r'[a-z0-9]+', title, flags=re.IGNORECASE)
    lookup_token = max(title_tokens, key=len)
    rows = _ready_title_candidates(lookup_token, department_filter, 5)

    # ILIKE narrows candidates; this check prevents wildcard characters in a
    # user title from turning the exact-reference path into a broad match.
    matches = [paper for paper in rows if _normalize_title(paper.get('title', '')) == normalized_title]
    _add_academic_labels(matches)
    return [public_source(paper) for paper in matches]


def _normalize_title(value: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', (value or '').lower())).strip()


# A reader's article and the title's own article are two different words:
# "what about *the* A Centralized AI-Powered ..." carries both, and leaving the
# leading "the" in place makes the fragment match nothing. Trailing filler
# ("... retrieval augmented generation *one*") is dropped for the same reason.
_TITLE_FRAGMENT_LEADING = frozenset({'the', 'this', 'that', 'a', 'an'})
_TITLE_FRAGMENT_TRAILING = frozenset({'one', 'ones', 'thesis', 'paper', 'study'})
_TITLE_FRAGMENT_MIN_TOKENS = 3
_TITLE_FRAGMENT_MIN_CHARS = 12
_TITLE_FRAGMENT_MIN_TOKEN_CHARS = 4
_TITLE_FRAGMENT_CANDIDATE_LIMIT = 25


def normalize_title_fragment(value: str) -> str:
    """Reduce a spoken title reference to the form a stored title compares in.

    Determiners and filler are stripped repeatedly. That can only make the
    fragment *less* selective, which is safe here: a less selective fragment
    matches more than one paper and is therefore discarded by the caller rather
    than guessed at.
    """
    tokens = _normalize_title(value).split()
    while tokens and tokens[0] in _TITLE_FRAGMENT_LEADING:
        tokens.pop(0)
    while tokens and tokens[-1] in _TITLE_FRAGMENT_TRAILING:
        tokens.pop()
    return ' '.join(tokens)


def find_papers_by_title_fragment(
    fragment: str, department_filter: str | None = None,
) -> list[dict]:
    """Resolve a partial spoken title, and only when the archive makes it unique.

    `find_papers_by_title` requires the whole normalized title, so a reader who
    names a thesis by its opening words -- "what about the A Centralized AI
    Powered" -- resolves to nothing there. The conversation then falls through
    to the ambiguous-follow-up branch, which pins the *previous* turn's paper,
    and the reply confidently describes the wrong manuscript.

    Every match is returned rather than a best one, on purpose. Selectivity
    comes from the caller requiring exactly one result, not from ranking: an
    ambiguous fragment must resolve to nothing and leave the existing follow-up
    handling untouched, never to whichever paper happened to sort first.
    """
    normalized_fragment = normalize_title_fragment(fragment)
    tokens = normalized_fragment.split()
    if (
        len(tokens) < _TITLE_FRAGMENT_MIN_TOKENS
        or len(normalized_fragment) < _TITLE_FRAGMENT_MIN_CHARS
    ):
        return []
    lookup_token = max(tokens, key=len)
    if len(lookup_token) < _TITLE_FRAGMENT_MIN_TOKEN_CHARS:
        return []
    rows = _ready_title_candidates(
        lookup_token, department_filter, _TITLE_FRAGMENT_CANDIDATE_LIMIT,
    )
    if len(rows) >= _TITLE_FRAGMENT_CANDIDATE_LIMIT:
        # The page is saturated, so uniqueness cannot be established from it.
        # Treating "one of the first 25" as an exact reference is exactly the
        # confident-but-wrong behaviour this function exists to remove.
        return []
    matches = [
        paper for paper in rows
        if normalized_fragment in _normalize_title(paper.get('title', ''))
    ]
    _add_academic_labels(matches)
    return [public_source(paper) for paper in matches]


def _add_academic_labels(papers: list[dict]) -> None:
    """Attach normalized catalog labels to paper metadata in place."""
    program_ids = list({paper.get('program_id') for paper in papers if paper.get('program_id')})
    specialization_ids = list({
        paper.get('specialization_id') for paper in papers if paper.get('specialization_id')
    })
    if not program_ids and not specialization_ids:
        return
    try:
        programs = (
            retry_transient(
                lambda: sb.table('programs').select('id,code,name').in_('id', program_ids).execute(),
                label='Supabase paper program lookup',
                logger=logger,
            ).data or []
            if program_ids else []
        )
        specializations = (
            retry_transient(
                lambda: sb.table('specializations').select('id,code,name').in_(
                    'id', specialization_ids,
                ).execute(),
                label='Supabase paper specialization lookup',
                logger=logger,
            ).data or []
            if specialization_ids else []
        )
    except Exception as error:
        # The paper itself remains a valid ready reference when optional catalog
        # labels are temporarily unavailable.
        logger.warning('Academic label lookup failed; using paper metadata (%s)', type(error).__name__)
        return

    programs_by_id = {str(item.get('id')): item for item in programs}
    specializations_by_id = {str(item.get('id')): item for item in specializations}
    for paper in papers:
        program = programs_by_id.get(str(paper.get('program_id')))
        specialization = specializations_by_id.get(str(paper.get('specialization_id')))
        if program:
            paper['program_code'] = program.get('code')
            paper['program_name'] = program.get('name')
        if specialization:
            paper['specialization_code'] = specialization.get('code')
            paper['specialization_name'] = specialization.get('name')


def list_archive_papers(
    department_filter: str | None = None,
    thesis_category: str | None = None,
    limit: int = 10,
    offset: int = 0,
) -> tuple[int, list[dict]]:
    """Return an exact ready-paper count and a bounded metadata preview.

    `offset` pages forward through the same alphabetical ordering so a
    "give me the remaining ones" follow-up continues the list instead of
    repeating its first page. The count is always of the whole filtered
    archive rather than of the page, so the caller can still say "N of TOTAL".
    """
    fields = 'id,title,authors,year,track,department,thesis_category'

    def paged(query):
        # Title alone is not a total order -- two papers may share one -- and an
        # ordering that is free to break ties differently per request can show
        # the same paper on two pages and skip another. Breaking on id fixes
        # the sequence the offset counts through.
        query = query.order('title').order('id').limit(limit)
        return query.offset(offset) if offset else query

    def execute_query():
        query = sb.table('papers').select(
            fields, count='exact'
        ).eq('ingestion_status', 'ready')
        if department_filter:
            query = query.eq('department', department_filter)
        if thesis_category:
            query = query.eq('thesis_category', thesis_category)
        return paged(query).execute()

    try:
        result = retry_transient(
            execute_query,
            label='Supabase archive inventory',
            logger=logger,
        )
    except Exception as error:
        if thesis_category or not _is_missing_column_error(error):
            raise

        def execute_legacy_query():
            query = sb.table('papers').select(
                'id,title,authors,year,track,department', count='exact'
            ).eq('ingestion_status', 'ready')
            if department_filter:
                query = query.eq('department', department_filter)
            return paged(query).execute()

        result = retry_transient(
            execute_legacy_query,
            label='Supabase legacy archive inventory',
            logger=logger,
        )

    rows = result.data or []
    # Citation ids number the PAGE, from 1, not the archive: a follow-up like
    # "number 2" is resolved by indexing the sources list the answer shipped
    # with, so a continuation page numbered 11-16 would put every positional
    # reference out of range.
    sources = [
        public_source(paper, citation_id=index)
        for index, paper in enumerate(rows, start=1)
    ]
    return result.count or 0, sources


def _is_missing_column_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        getattr(error, 'code', None) == '42703'
        or "'code': '42703'" in message
        or ('column ' in message and ' does not exist' in message)
    )


_PAPER_QUERY_STOPWORDS = {
    'a', 'about', 'all', 'an', 'and', 'any', 'archive', 'archived', 'are',
    'author', 'authors', 'available', 'by', 'capstone', 'ccsict', 'department',
    'does', 'explain', 'focus', 'focused', 'for', 'from', 'give', 'has', 'have',
    'in', 'is', 'isu', 'it', 'list', 'of', 'paper', 'project', 'research',
    'show', 'study', 'subject', 'tell', 'the', 'their', 'them', 'there',
    'these', 'theses', 'thesi', 'thesis', 'this', 'title', 'topic', 'what',
    'which', 'who', 'with',
}


def _search_terms(text: str) -> list[str]:
    terms = []
    for token in re.findall(r'[a-z0-9]+', (text or '').lower()):
        if token in _PAPER_QUERY_STOPWORDS or len(token) <= 2:
            continue
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
        section_lower = (location.get('section') or '').lower()
        method_hit = (
            any(k in normalized_content for k in ('3.2 methods', 'materials and methods'))
            or any(k in section_lower for k in ('methodology', 'research design', 'system architecture'))
        )
        if {'method', 'methodology'} & set(query_terms) and method_hit:
            score += 20
        if {'result', 'finding'} & set(query_terms) and (
            'results and discussion' in normalized_content
            or 'results' in section_lower
            or 'findings' in section_lower
        ):
            score += 20
        if 'problem' in query_terms and (
            'statement of the problem' in normalized_content
            or 'background of the study' in normalized_content
            or 'introduction' in section_lower
        ):
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


def _format_chunk_header(paper: dict, chunk: dict, *, default_title: str = '?') -> str:
    """Build the catalogue header line for one retrieved chunk."""
    meta_bits = [f"Title: {paper.get('title', default_title)}"]
    if paper.get('authors'):
        meta_bits.append(f"Authors: {paper['authors']}")
    elif default_title != '?':
        meta_bits.append('Authors: Unknown authors')
    if paper.get('adviser'):
        meta_bits.append(f"Adviser: {paper['adviser']}")
    if paper.get('panel_chair'):
        meta_bits.append(f"Panel Chair: {paper['panel_chair']}")
    if paper.get('panel_members'):
        meta_bits.append(f"Panel Members: {paper['panel_members']}")
    if paper.get('track'):
        meta_bits.append(f"Track: {paper['track']}")
    if paper.get('year'):
        meta_bits.append(f"Year: {paper['year']}")
    if paper.get('department'):
        meta_bits.append(f"Department: {paper['department']}")
    if paper.get('program_code') or paper.get('program_name'):
        meta_bits.append(
            'Program: ' + ' - '.join(filter(None, (paper.get('program_code'), paper.get('program_name'))))
        )
    if paper.get('specialization_code') or paper.get('specialization_name'):
        meta_bits.append(
            'Specialization: ' + ' - '.join(filter(None, (
                paper.get('specialization_code'), paper.get('specialization_name'),
            )))
        )
    location = chunk_location(chunk)
    page_start, page_end = location['page_start'], location['page_end']
    if page_start:
        page_label = str(page_start) if not page_end or page_end == page_start else f'{page_start}-{page_end}'
        meta_bits.append(f'Pages: {page_label}')
    if location['section']:
        meta_bits.append(f"Section: {location['section']}")
    return ' | '.join(meta_bits)


def get_paper_overview_context(
    paper_id: str,
    department_filter: str | None = None,
    question: str | None = None,
):
    """Load overview or question-ranked chunks from one verified paper index."""
    def fetch_paper():
        query = sb.table('papers').select(
            'id,title,authors,adviser,panel_chair,panel_members,abstract,year,track,'
            'department,program_id,specialization_id,active_index_version'
        ).eq('id', paper_id).eq('ingestion_status', 'ready')
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
            ).eq('id', paper_id).eq('ingestion_status', 'ready')
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
    _add_academic_labels([paper])

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
    stored_abstract = safe_chunk_text((paper.get('abstract') or '').strip()[:1500])
    for citation_id, chunk in enumerate(selected, start=1):
        header = _format_chunk_header(paper, chunk, default_title='Untitled thesis')
        safe_content = safe_chunk_text(chunk.get('content', ''))
        if citation_id == 1 and stored_abstract and stored_abstract[:60] not in safe_content:
            safe_content = f'Abstract: {stored_abstract}\n{safe_content}'
        context_parts.append(f'[{citation_id}] {header}\n{safe_content}')
        sources.append(public_source(
            paper,
            chunk=chunk,
            citation_id=citation_id,
        ))
    return '\n\n'.join(context_parts), sources, 1.0


# Blend weights for the candidate rerank. Cosine similarity stays dominant --
# it is the signal the 0.30 threshold and the paper's pipeline description are
# defined on -- and the lexical term is a tiebreaker-plus: strong enough to
# lift a chunk whose section and wording actually match the question over a
# semantically-adjacent one, never enough to promote a chunk cosine ranked far
# below it. The lexical score is normalized to the pool's own maximum, so the
# second term contributes at most 0.25 regardless of question length.
_RERANK_SIMILARITY_WEIGHT = 0.75
_RERANK_LEXICAL_WEIGHT = 0.25


def _lexical_evidence_score(chunk: dict, query_terms: list[str]) -> int:
    """The exact-paper path's section-aware signal, generalized cross-paper."""
    location = chunk_location(chunk)
    content_terms = _search_terms(f"{chunk.get('title', '')} {chunk.get('content', '')}")
    section_terms = _search_terms(location.get('section') or '')
    unique_terms = set(query_terms)
    return (
        sum(min(content_terms.count(term), 4) for term in unique_terms)
        + 3 * sum(min(section_terms.count(term), 2) for term in unique_terms)
    )


def rerank_candidates(chunks: list[dict], question: str) -> list[dict]:
    """Order a candidate pool by blended cosine + lexical evidence.

    Deterministic: ties break by cosine similarity, then chunk id, via the
    stable pre-sort. With no usable query terms (an all-stopword question) or a
    single candidate the pool is returned in pure cosine order, which is also
    the exact legacy behavior.
    """
    by_similarity = sorted(
        chunks,
        key=lambda c: (-(c.get('similarity') or 0.0), c.get('id') or 0),
    )
    query_terms = _search_terms(question)
    if not query_terms or len(chunks) <= 1:
        return by_similarity
    lexical = {
        id(chunk): _lexical_evidence_score(chunk, query_terms) for chunk in by_similarity
    }
    max_lexical = max(lexical.values()) or 1

    def blended(chunk: dict) -> float:
        return (
            _RERANK_SIMILARITY_WEIGHT * (chunk.get('similarity') or 0.0)
            + _RERANK_LEXICAL_WEIGHT * (lexical[id(chunk)] / max_lexical)
        )

    return sorted(by_similarity, key=lambda chunk: -blended(chunk))


def apply_paper_diversity(
    ranked: list[dict], final_count: int, per_paper_cap: int,
) -> list[dict]:
    """Select `final_count` chunks, capping chunks per paper while others qualify.

    Two properties hold: the context is never shorter than the archive can make
    it (over-cap chunks backfill when too few papers qualify), and the returned
    list is re-sorted into the incoming rank order, so citation numbers assigned
    afterwards still encode the rank the rerank asserted -- a backfilled rank-2
    chunk cites as [2], not as whatever position the backfill placed it in.
    """
    selected: list[dict] = []
    deferred: list[dict] = []
    per_paper: dict = {}
    for chunk in ranked:
        paper_id = chunk.get('paper_id')
        if len(selected) < final_count and per_paper.get(paper_id, 0) < per_paper_cap:
            selected.append(chunk)
            per_paper[paper_id] = per_paper.get(paper_id, 0) + 1
        else:
            deferred.append(chunk)
    for chunk in deferred:
        if len(selected) >= final_count:
            break
        selected.append(chunk)
    rank_order = {id(chunk): index for index, chunk in enumerate(ranked)}
    selected.sort(key=lambda chunk: rank_order[id(chunk)])
    return selected


def _filter_pool_by_min_year(pool: list[dict], min_year: int | None) -> list[dict]:
    """Filter candidate chunks to papers completed in or after `min_year`."""
    if not min_year or not pool:
        return pool
    paper_ids = list({c['paper_id'] for c in pool if c.get('paper_id')})
    if not paper_ids:
        return pool
    rows = retry_transient(
        lambda: sb.table('papers').select('id,year').in_('id', paper_ids).execute(),
        label='Supabase min_year filter lookup', logger=logger,
    ).data or []
    allowed = {r['id'] for r in rows if int(r.get('year') or 0) <= 0 or int(r.get('year') or 0) >= min_year}
    return [c for c in pool if c.get('paper_id') in allowed]


def filter_relevant_candidates(ranked: list[dict], question: str) -> list[dict]:
    """Prune off-topic candidates when specific subject terms are queried."""
    query_terms = _search_terms(question)
    if not query_terms or not ranked:
        return ranked
    lexical_by_id = {id(c): _lexical_evidence_score(c, query_terms) for c in ranked}
    max_lex = max(lexical_by_id.values(), default=0)
    if max_lex == 0:
        best_sim = max((c.get('similarity') or 0.0) for c in ranked)
        return [] if best_sim < 0.70 else ranked
    matched_papers = {c.get('paper_id') for c in ranked if lexical_by_id[id(c)] > 0}
    return [
        c for c in ranked
        if c.get('paper_id') in matched_papers or (c.get('similarity') or 0.0) >= 0.78
    ]


_ASPECT_ONLY_WORDS = frozenset({
    'the', 'a', 'an', 'their', 'its', 'methodology', 'methodologies', 'method', 'methods',
    'objective', 'objectives', 'purpose', 'result', 'results', 'finding', 'findings',
    'metric', 'metrics', 'accuracy', 'scope', 'limitation', 'limitations', 'dataset',
    'datasets', 'framework', 'architecture', 'performance', 'evaluation',
    'usability', 'reliability', 'efficiency', 'scalability', 'portability',
    'maintainability', 'compatibility', 'functionality', 'speed', 'cost', 'security',
})
_COMPOUND_MODIFIER_PAIRS = frozenset({
    ('web', 'mobile'),
    ('network', 'security'),
    ('data', 'mining'),
    ('precision', 'recall'),
    ('training', 'testing'),
})
_COMPARE_AXIS_TAIL = re.compile(
    r'\s+(?:in\s+terms\s+of|on\s+(?:their|its)|regarding|across|by\s+(?:their|its))\s+(?P<axis>.+)$',
    re.IGNORECASE,
)
_COMPARE_SPLIT_PATTERNS = (
    re.compile(
        r'^(?:compare|contrast)\s+(?P<a>.+?)\s+(?:and|with|to|against|versus|vs\.?)\s+(?P<b>.+)$',
        re.IGNORECASE,
    ),
    re.compile(
        r'^(?:what\s+(?:are|is)\s+)?(?:the\s+)?'
        r'(?:differences?|similarit(?:y|ies)|contrast)\s+between\s+'
        r'(?P<a>.+?)\s+and\s+(?P<b>.+)$',
        re.IGNORECASE,
    ),
    re.compile(r'^(?P<a>.+?)\s+(?:versus|vs\.?)\s+(?P<b>.+)$', re.IGNORECASE),
)
_COMPARE_SIDE_GENERIC_TERMS = frozenset({
    'system', 'platform', 'application', 'app', 'based', 'using', 'local',
    'program', 'track', 'specialization', 'existing', 'past', 'recent',
})
_SIDE_CATALOG_PATTERNS = tuple(
    (re.compile(rf'\b{re.escape(alias)}\b', re.IGNORECASE), code)
    for alias, (_kind, code) in sorted(
        _CATALOG_ALIASES.items(), key=lambda item: len(item[0]), reverse=True,
    )
)


def _is_usable_comparison_side(side: str) -> bool:
    tokens = re.findall(r'[a-z0-9]+', (side or '').lower())
    if not tokens:
        return False
    return any(token not in _ASPECT_ONLY_WORDS for token in tokens)


def split_comparison_query(question: str) -> tuple[str, str, str] | None:
    """Split an explicit two-study comparison into `(side_a, side_b, axis)`."""
    cleaned = re.sub(
        r'^\s*(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?',
        '',
        (question or '').strip(),
        flags=re.IGNORECASE,
    ).rstrip('?.! ').strip()
    if not cleaned:
        return None
    axis = ''
    axis_match = _COMPARE_AXIS_TAIL.search(cleaned)
    body = cleaned
    if axis_match:
        candidate_body = cleaned[:axis_match.start()].strip()
        if any(p.fullmatch(candidate_body) for p in _COMPARE_SPLIT_PATTERNS):
            body = candidate_body
            axis = axis_match.group('axis').strip()
    for pattern in _COMPARE_SPLIT_PATTERNS:
        match = pattern.fullmatch(body)
        if not match:
            continue
        side_a = match.group('a').strip(' ,')
        side_b = match.group('b').strip(' ,')
        if not _is_usable_comparison_side(side_a) or not _is_usable_comparison_side(side_b):
            return None
        toks_a = re.findall(r'[a-z]+', side_a.lower())
        toks_b = re.findall(r'[a-z]+', side_b.lower())
        if toks_a and toks_b and (toks_a[-1], toks_b[0]) in _COMPOUND_MODIFIER_PAIRS:
            return None
        return side_a, side_b, axis
    return None


def extract_comparison_sides(question: str) -> tuple[str, str] | None:
    """Split an explicit two-study comparison question into two retrieval queries."""
    parsed = split_comparison_query(question)
    if not parsed:
        return None
    side_a, side_b, axis = parsed
    query_a = f'{side_a} {axis}'.strip() if axis else side_a
    query_b = f'{side_b} {axis}'.strip() if axis else side_b
    return query_a, query_b


def _extract_side_program_code(side_text: str) -> tuple[str | None, str]:
    """Pull out an explicit program/specialization code from one comparison side."""
    for pattern, code in _SIDE_CATALOG_PATTERNS:
        if pattern.search(side_text):
            stripped = re.sub(r'\s+', ' ', pattern.sub(' ', side_text)).strip()
            return code, stripped
    return None, side_text


def _paper_matches_catalog_code(paper: dict, code: str) -> bool:
    upper = code.upper()
    if str(paper.get('program_code') or '').upper() == upper:
        return True
    if str(paper.get('specialization_code') or '').upper() == upper:
        return True
    track_norm = re.sub(r'\s+', ' ', str(paper.get('track') or '').lower()).strip()
    if track_norm.upper() == upper:
        return True
    alias_target = _CATALOG_ALIASES.get(track_norm)
    return bool(alias_target and alias_target[1] == upper)


def _title_lead_identifiers(title: str) -> set[str]:
    """Short system names or parenthesized acronyms that uniquely name a thesis."""
    identifiers: set[str] = set()
    if ':' in (title or ''):
        prefix = title.split(':', 1)[0].strip()
        prefix_tokens = re.findall(r'[a-z0-9]+(?:-[a-z0-9]+)*', prefix.lower())
        if 1 <= len(prefix_tokens) <= 2:
            for tok in prefix_tokens:
                if len(tok) >= 4 and tok not in _PAPER_QUERY_STOPWORDS:
                    identifiers.add(tok)
    for paren in re.findall(r'\(([A-Za-z0-9-]{3,20})\)', title or ''):
        identifiers.add(paren.lower())
    return identifiers


def _resolve_comparison_side_paper(side_text: str, catalog: list[dict]) -> dict | None:
    """Resolve one comparison side to a single ready thesis when unambiguously named."""
    if not catalog or not side_text:
        return None
    required_code, stripped = _extract_side_program_code(side_text)
    candidates = [
        paper for paper in catalog
        if not required_code or _paper_matches_catalog_code(paper, required_code)
    ]
    if not candidates:
        return None
    side_terms = [
        term for term in _search_terms(stripped)
        if term not in _COMPARE_SIDE_GENERIC_TERMS
    ]
    unique_side = set(side_terms)
    raw_side_tokens = {
        tok for tok in re.findall(r'[a-z0-9]+(?:-[a-z0-9]+)*', stripped.lower())
        if len(tok) >= 3 and tok not in _PAPER_QUERY_STOPWORDS and tok not in _COMPARE_SIDE_GENERIC_TERMS
    }
    if not unique_side and not raw_side_tokens:
        return None

    scored: list[tuple[int, int, float, dict]] = []
    for paper in candidates:
        title = paper.get('title') or ''
        lead_ids = _title_lead_identifiers(title)
        exact_lead = int(bool(raw_side_tokens & lead_ids))
        title_terms = set(_search_terms(title))
        hits = unique_side & title_terms
        coverage = (len(hits) / len(unique_side)) if unique_side else 0.0
        first_word = (re.findall(r'[a-z0-9]+', title.lower()) or [''])[0]
        single_lead = int(
            len(unique_side) == 1 and len(first_word) >= 5 and first_word in unique_side
        )
        if exact_lead or single_lead or (len(hits) >= 2 and coverage >= 0.5):
            scored.append((exact_lead or single_lead, len(hits), coverage, paper))
    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    if len(scored) == 1 or scored[0][:2] > scored[1][:2]:
        return scored[0][3]
    return None


def _list_comparison_catalog(
    department_filter: str | None,
    thesis_category: str | None,
    min_year: int | None,
) -> list[dict]:
    """Fetch ready-paper metadata in the department for comparison side resolution."""
    def fetch_catalog():
        query = sb.table('papers') \
            .select(
                'id,title,authors,year,track,department,abstract,'
                'active_index_version,thesis_category,program_id,specialization_id'
            ) \
            .eq('ingestion_status', 'ready')
        if department_filter:
            query = query.eq('department', department_filter)
        if thesis_category:
            query = query.eq('thesis_category', thesis_category)
        return query.limit(500).execute()

    try:
        rows = retry_transient(
            fetch_catalog,
            label='Supabase comparison catalog lookup',
            logger=logger,
        ).data or []
    except Exception as error:
        if not _is_missing_column_error(error):
            logger.warning(
                'Comparison catalog lookup skipped (%s)', type(error).__name__,
            )
            return []

        def fetch_legacy():
            query = sb.table('papers') \
                .select('id,title,authors,year,track,department') \
                .eq('ingestion_status', 'ready')
            if department_filter:
                query = query.eq('department', department_filter)
            return query.limit(500).execute()

        rows = retry_transient(
            fetch_legacy,
            label='Supabase legacy comparison catalog lookup',
            logger=logger,
        ).data or []
    if min_year:
        rows = [
            row for row in rows
            if int(row.get('year') or 0) <= 0 or int(row.get('year') or 0) >= min_year
        ]
    _add_academic_labels(rows)
    return rows


def _is_toc_chunk(chunk: dict) -> bool:
    """Detect Table of Contents / front-matter listing chunks with wide leader gaps."""
    content = chunk.get('content') or ''
    if 'table of contents' in content[:160].lower():
        return True
    return len(re.findall(r' {5,}|\.{4,}', content)) >= 3


def _select_comparison_paper_chunks(
    candidates: list[dict], axis: str, paper: dict, limit: int,
) -> list[dict]:
    """Choose axis-focused chunks or an intro/method/results spread for a thesis."""
    prose = [chunk for chunk in candidates if not _is_toc_chunk(chunk)] or candidates
    if axis:
        return rank_paper_chunks(prose, axis, paper)[:limit]
    picked: list[dict] = []
    seen: set = set()
    for query in (
        'introduction objectives scope',
        'methodology methods dataset',
        'results findings conclusion',
    ):
        for chunk in rank_paper_chunks(prose, query, paper):
            key = chunk.get('id', chunk.get('chunk_index'))
            if key not in seen:
                seen.add(key)
                picked.append(chunk)
                break
        if len(picked) >= limit:
            break
    for chunk in prose:
        if len(picked) >= limit:
            break
        key = chunk.get('id', chunk.get('chunk_index'))
        if key not in seen:
            seen.add(key)
            picked.append(chunk)
    return picked[:limit]


def _fetch_paper_comparison_chunks(paper: dict, axis: str, limit: int = 3) -> list[dict]:
    """Load the best-matching chunks of one resolved thesis for a comparison."""
    paper_id = paper.get('id')
    if not paper_id:
        return []

    def fetch_chunks():
        query = sb.table('chunks') \
            .select('id,paper_id,content,chunk_index,page_start,page_end,section,index_version,metadata') \
            .eq('paper_id', paper_id)
        if paper.get('active_index_version'):
            query = query.eq('index_version', paper['active_index_version'])
        return query.order('chunk_index').limit(200).execute()

    try:
        chunk_rows = retry_transient(
            fetch_chunks,
            label='Supabase comparison paper chunks',
            logger=logger,
        ).data or []
    except Exception as error:
        if not _is_missing_column_error(error):
            raise
        chunk_rows = retry_transient(
            lambda: sb.table('chunks')
            .select('id,paper_id,content,chunk_index,metadata')
            .eq('paper_id', paper_id)
            .order('chunk_index')
            .limit(200).execute(),
            label='Supabase legacy comparison paper chunks',
            logger=logger,
        ).data or []
    substantive = [chunk for chunk in chunk_rows if (chunk.get('chunk_index') or 0) > 0]
    candidates = substantive or chunk_rows
    if not candidates:
        return []
    selected = _select_comparison_paper_chunks(candidates, axis, paper, limit)
    stored_abstract = (paper.get('abstract') or '').strip()[:1500]
    enriched: list[dict] = []
    for index, chunk in enumerate(selected):
        content = chunk.get('content', '')
        if index == 0 and stored_abstract and stored_abstract[:60] not in content:
            content = f'Abstract: {stored_abstract}\n{content}'
        enriched.append({**chunk, 'content': content, 'similarity': 1.0})
    return enriched


def _finalize_retrieved_chunks(
    chunks: list[dict], top_similarity: float,
) -> tuple[str, list[dict], float]:
    """Attach chunk locations and paper metadata, then apply LongContextReorder."""
    if not chunks:
        return '', [], 0.0
    # Legacy indexes store page/section locations in JSON metadata because
    # the page-aware columns may not exist yet. Looked up for the final
    # selection only, so the pool does not triple the round-trip size.
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

    # Fetch paper metadata for the selected chunks only.
    paper_ids = list({c['paper_id'] for c in chunks})
    try:
        papers_res = retry_transient(
            lambda: sb.table('papers')
            .select(
                'id,title,authors,adviser,panel_chair,panel_members,year,track,'
                'department,thesis_category,program_id,specialization_id'
            )
            .in_('id', paper_ids).execute(),
            label='Supabase citation metadata lookup',
            logger=logger,
        )
    except Exception as error:
        if not _is_missing_column_error(error):
            raise

        # Compatibility until the thesis category migration is applied.
        papers_res = retry_transient(
            lambda: sb.table('papers')
            .select('id,title,authors,year,track,department')
            .in_('id', paper_ids).execute(),
            label='Supabase legacy citation metadata lookup',
            logger=logger,
        )
    papers = papers_res.data or []
    _add_academic_labels(papers)
    paper_lookup = {p['id']: p for p in papers}

    # `chunks` is already in quality-rank order (blended rank from the
    # selection stage, or pure cosine on the rollback path). Citation numbers
    # are assigned in that order BEFORE LongContextReorder, so sorted marker
    # order always recovers the asserted rank.
    cited_chunks = [{**chunk, 'citation_id': index + 1} for index, chunk in enumerate(chunks)]
    reordered = long_context_reorder(cited_chunks)

    context_parts: list[str] = []
    for chunk in reordered:
        p = paper_lookup.get(chunk['paper_id'])
        if not p:
            continue
        n = chunk['citation_id']
        header = _format_chunk_header(p, chunk)
        safe_content = safe_chunk_text(chunk['content'])
        context_parts.append(f'[{n}] {header}\n{safe_content}')

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


def _fetch_ranked_pool(
    question: str,
    department_filter: str | None = None,
    query_embedding: list[float] | None = None,
    thesis_category: str | None = None,
    min_year: int | None = None,
    *,
    pool_override: int | None = None,
) -> tuple[list[dict], float]:
    """Embed and retrieve a filtered, reranked candidate pool for one query."""
    q_embedding = query_embedding if query_embedding is not None else embed_text(question)
    final_count = settings.retrieval_match_count
    pool_size = max(pool_override or settings.retrieval_candidate_pool, final_count)
    rpc_params = {
        'query_embedding': q_embedding,
        'match_count': pool_size,
        'match_threshold': settings.retrieval_threshold,
        'p_department': department_filter,
        **retrieval_provenance_params(),
    }
    if thesis_category:
        rpc_params['p_thesis_category'] = thesis_category
    result = retry_transient(
        lambda: sb.rpc('match_chunks', rpc_params).execute(),
        label='Supabase chunk retrieval',
        logger=logger,
    )
    pool = _filter_pool_by_min_year(result.data or [], min_year)
    if not pool:
        return [], 0.0
    top_similarity = max(c.get('similarity', 0.0) for c in pool)
    ranked_pool = filter_relevant_candidates(rerank_candidates(pool, question), question)
    return ranked_pool, top_similarity


def _interleave_comparison_pools(
    picked_a: list[dict], picked_b: list[dict], final_count: int,
) -> list[dict]:
    """Interleave chunks `[a1, b1, a2, b2, ...]` without duplicate chunk ids."""
    selected: list[dict] = []
    seen_ids: set = set()
    idx_a = 0
    idx_b = 0
    while len(selected) < final_count and (idx_a < len(picked_a) or idx_b < len(picked_b)):
        while idx_a < len(picked_a):
            cand = picked_a[idx_a]
            idx_a += 1
            if cand.get('id') not in seen_ids:
                seen_ids.add(cand.get('id'))
                selected.append(cand)
                break
        if len(selected) >= final_count:
            break
        while idx_b < len(picked_b):
            cand = picked_b[idx_b]
            idx_b += 1
            if cand.get('id') not in seen_ids:
                seen_ids.add(cand.get('id'))
                selected.append(cand)
                break
    return selected


def search_comparison_chunks(
    side_a: str,
    side_b: str,
    department_filter: str | None = None,
    thesis_category: str | None = None,
    min_year: int | None = None,
    *,
    axis: str = '',
) -> tuple[str, list[dict], float]:
    """Retrieve balanced chunks from both sides of a two-study comparison.

    Resolves each side against the ready catalog first when a thesis is
    unambiguously named (e.g. FindMe vs SECURE, or BSCS alumni tracer vs BLIS
    alumni profiling), and falls back to wider independent vector search for
    topical or absent sides so one verbose study cannot crowd out the other.
    """
    final_count = settings.retrieval_match_count
    catalog = _list_comparison_catalog(department_filter, thesis_category, min_year)
    paper_a = _resolve_comparison_side_paper(side_a, catalog)
    paper_b = _resolve_comparison_side_paper(side_b, catalog)

    def resolve_side(side_text: str, paper: dict | None, exclude_id: str | None) -> tuple[list[dict], float]:
        if paper is not None:
            chunks = _fetch_paper_comparison_chunks(paper, axis, limit=3)
            if chunks:
                return chunks, 1.0
        query = f'{side_text} {axis}'.strip() if axis else side_text
        pool, sim = _fetch_ranked_pool(
            query, department_filter, None, thesis_category, min_year,
            pool_override=max(settings.retrieval_candidate_pool, 30),
        )
        if exclude_id:
            pool = [chunk for chunk in pool if chunk.get('paper_id') != exclude_id]
        return pool, sim

    pool_a, sim_a = resolve_side(side_a, paper_a, paper_b.get('id') if paper_b else None)
    pool_b, sim_b = resolve_side(side_b, paper_b, paper_a.get('id') if paper_a else None)
    top_similarity = max(sim_a, sim_b)
    if not pool_a and not pool_b:
        return '', [], 0.0

    # Order sides by peak similarity and interleave [a1, b1, a2, b2, a3] so
    # LongContextReorder puts side 1 at the very start and side 2 at the very
    # end of the prompt window.
    if sim_b > sim_a:
        pool_a, pool_b = pool_b, pool_a
    picked_a = apply_paper_diversity(pool_a, final_count, 3) if pool_a else []
    picked_b = apply_paper_diversity(pool_b, final_count, 3) if pool_b else []
    selected = _interleave_comparison_pools(picked_a, picked_b, final_count)
    return _finalize_retrieved_chunks(selected, top_similarity)


def search_chunks(
    question: str, department_filter: str | None = None, query_embedding: list[float] | None = None,
    thesis_category: str | None = None, per_paper_cap: int | None = None, min_year: int | None = None,
):
    """Return (context, sources, top_similarity) for a natural-language query."""
    q_embedding = query_embedding if query_embedding is not None else embed_text(question)
    final_count = settings.retrieval_match_count
    pool_size = max(settings.retrieval_candidate_pool, final_count)
    rpc_params = {
        'query_embedding': q_embedding,
        'match_count': pool_size,
        'match_threshold': settings.retrieval_threshold,
        'p_department': department_filter,
        **retrieval_provenance_params(),
    }
    # Omit the key entirely when no category scope was requested, so the
    # unfiltered call stays identical to the evaluated pipeline.
    if thesis_category:
        rpc_params['p_thesis_category'] = thesis_category
    result = retry_transient(
        lambda: sb.rpc('match_chunks', rpc_params).execute(),
        label='Supabase chunk retrieval',
        logger=logger,
    )
    pool = _filter_pool_by_min_year(result.data or [], min_year)
    if not pool:
        return '', [], 0.0

    # The best cosine seen for the query, over the whole pool: the honest
    # "how close did the archive get" trace value whatever selection keeps.
    top_similarity = max(c.get('similarity', 0.0) for c in pool)

    if pool_size == final_count:
        # Rollback lever: a pool no larger than the final context disables the
        # selection stage and reproduces the pure cosine-order pipeline.
        chunks = sorted(pool, key=lambda item: item.get('similarity', 0.0), reverse=True)
    else:
        ranked_pool = filter_relevant_candidates(rerank_candidates(pool, question), question)
        if not ranked_pool:
            return '', [], 0.0
        effective_cap = per_paper_cap if per_paper_cap is not None else settings.retrieval_per_paper_cap
        chunks = apply_paper_diversity(ranked_pool, final_count, effective_cap)

    return _finalize_retrieved_chunks(chunks, top_similarity)


def check_topic_duplication(
    question: str,
    threshold: float | None = None,
    query_embedding: list[float] | None = None,
    department_filter: str | None = None,
    thesis_category: str | None = None,
) -> dict | None:
    """Query-time 85% novelty guard (paper, Section 1.3 Duplication Parameter).

    Returns a duplication alert payload when the query's similarity to any
    archived chunk meets or exceeds the threshold, otherwise None.
    """
    threshold = threshold if threshold is not None else settings.duplication_threshold
    try:
        q_embedding = query_embedding if query_embedding is not None else embed_text(question)
        rpc_params = {
            'query_embedding': q_embedding,
            'dup_threshold': threshold,
            'p_department': department_filter,
            **retrieval_provenance_params(),
        }
        # Same conditional-key contract as search_chunks: absent scope means
        # an unchanged call against the frozen duplication-screening path.
        if thesis_category:
            rpc_params['p_thesis_category'] = thesis_category
        res = retry_transient(
            lambda: sb.rpc('check_topic_duplication', rpc_params).execute(),
            label='Supabase duplication check',
            logger=logger,
        )
    except Exception as e:
        logger.exception('Topic duplication check failed (%s)', type(e).__name__)
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
