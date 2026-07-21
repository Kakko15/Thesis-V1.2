"""Token-aware semantic indexing (thesis paper, Section 3.2.3, Phase 2).

Chunk sizes are measured with a fixed local tokenizer proxy. They are exact
for that proxy, but are not claimed to reproduce Gemini's private tokenizer.

The tokenizer vocabulary is initialized lazily. Loading it while FastAPI is
importing routes can otherwise hold up every development-server start (and may
attempt a one-time download when the local tiktoken cache is empty).
"""

import bisect
import re
from functools import lru_cache

import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings
from services.document_processor import ExtractedDocument

TOKENIZER_ENCODING = 'cl100k_base'
CHUNKING_VERSION = 'token-v1'

_TOKEN_SEPARATORS = [
    '\n\n', '\n', '. ', '? ', '! ',
    '\u3002', '\uff0e', ', ', '\uff0c', '\u3001', '\u200b', ' ', '',
]


@lru_cache(maxsize=1)
def _get_encoder():
    """Load the fixed proxy tokenizer once and fail closed if unavailable."""
    try:
        return tiktoken.get_encoding(TOKENIZER_ENCODING)
    except Exception as error:
        raise RuntimeError(
            f'Unable to initialize required tokenizer {TOKENIZER_ENCODING}'
        ) from error


def count_tokens(text: str) -> int:
    """Return exact token count for arbitrary text under the fixed proxy."""
    return len(_get_encoder().encode(text or '', allowed_special=set(), disallowed_special=()))


def record_overlap_tokens(left: dict, right: dict) -> int:
    """Measure actual source overlap using stable character offsets.

    Text matching alone over-counts overlap when a document contains repeated
    prose. Source offsets identify only the duplicated source range.
    """
    left_end = left.get('end_index')
    right_start = right.get('start_index')
    if not isinstance(left_end, int) or not isinstance(right_start, int):
        return 0
    overlap_characters = max(0, left_end - right_start)
    if overlap_characters == 0:
        return 0
    left_text = left.get('content', '')
    right_text = right.get('content', '')
    if overlap_characters > min(len(left_text), len(right_text)):
        raise ValueError('Chunk source offsets describe an impossible overlap')
    left_overlap = left_text[-overlap_characters:]
    right_overlap = right_text[:overlap_characters]
    if left_overlap != right_overlap:
        raise ValueError('Chunk source offsets do not match overlapping content')
    return count_tokens(right_overlap)


class _LazyTokenSplitter:
    """Create the LangChain splitter only when document work first needs it."""

    # Keep these public attributes for diagnostics and the configuration tests
    # without forcing the tokenizer vocabulary to load during application import.
    _chunk_size = settings.chunk_size_tokens
    _chunk_overlap = settings.chunk_overlap_tokens

    def __init__(self):
        self._delegate: RecursiveCharacterTextSplitter | None = None

    def _get_delegate(self) -> RecursiveCharacterTextSplitter:
        if self._delegate is None:
            self._delegate = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
                encoding_name=TOKENIZER_ENCODING,
                chunk_size=self._chunk_size,
                chunk_overlap=self._chunk_overlap,
                separators=_TOKEN_SEPARATORS,
                add_start_index=False,
                allowed_special=set(),
                disallowed_special=(),
            )
        return self._delegate

    def split_text(self, text: str) -> list[str]:
        if not text or not text.strip():
            return []
        return self._get_delegate().split_text(text)


splitter = _LazyTokenSplitter()

_SECTION_HEADING = re.compile(
    r'^\s*(?:chapter\s+(?:\d+|[ivxlc]+)\b.*|\d{1,2}(?:\.\d+){1,3}\s+.+|'
    r'abstract|introduction|background(?: of the study)?|review of related literature|'
    r'methodology|research methodology|results(?: and discussion)?|discussion|conclusion(?:s)?|'
    r'recommendations?)\s*$',
    re.IGNORECASE,
)


def _is_section_heading(text: str) -> bool:
    if _SECTION_HEADING.match(text):
        return True
    if text == 'FIGURE REDACTED FOR SEMANTIC INDEXING':
        return False
    letters = ''.join(character for character in text if character.isalpha())
    return (
        3 <= len(text) <= 100
        and len(text.split()) >= 2
        and len(letters) >= 6
        and letters.isupper()
    )


def split_text(text: str) -> list[str]:
    return splitter.split_text(text)


def validate_chunk_records(records: list[dict]) -> list[dict]:
    """Validate and enrich final indexable chunks after noise filtering."""
    prepared: list[dict] = []
    for index, source in enumerate(records):
        record = dict(source)
        content = record.get('content', '')
        if not content.strip():
            raise ValueError('An empty chunk was produced')
        token_count = count_tokens(content)
        if token_count > settings.chunk_size_tokens:
            raise ValueError(
                f'Chunk {index} exceeds the {settings.chunk_size_tokens}-token limit'
            )
        page_start = record.get('page_start')
        page_end = record.get('page_end')
        if (page_start is None) != (page_end is None):
            raise ValueError('Incomplete page range')
        if page_start is not None and page_end < page_start:
            raise ValueError('Invalid page range')
        record.update({
            'chunk_index': index,
            'token_count': token_count,
            'tokenizer': TOKENIZER_ENCODING,
            'chunk_size_tokens': settings.chunk_size_tokens,
            'chunk_overlap_tokens': settings.chunk_overlap_tokens,
            'chunking_version': CHUNKING_VERSION,
        })
        prepared.append(record)
    return prepared


def _shared_overlap_characters(left: str, right: str) -> int:
    """Find the largest real suffix/prefix overlap within the token target."""
    limit = min(len(left), len(right))
    sentinel = object()
    sequence = [*right[:limit], sentinel, *left[-limit:]]
    prefix_lengths = [0] * len(sequence)
    for index in range(1, len(sequence)):
        candidate = prefix_lengths[index - 1]
        while candidate and sequence[index] != sequence[candidate]:
            candidate = prefix_lengths[candidate - 1]
        if sequence[index] == sequence[candidate]:
            candidate += 1
        prefix_lengths[index] = candidate
    size = prefix_lengths[-1] if prefix_lengths else 0
    while size:
        if count_tokens(right[:size]) <= settings.chunk_overlap_tokens:
            return size
        size = prefix_lengths[size - 1]
    return 0


def _locate_chunk(source: str, content: str, previous: dict | None) -> int:
    """Locate splitter output in source without mixing token and char units."""
    if previous is None:
        start = source.find(content)
    else:
        overlap = _shared_overlap_characters(previous['content'], content)
        expected = previous['end_index'] - overlap
        if source.startswith(content, expected):
            return expected
        start = source.find(content, max(previous['start_index'] + 1, expected))
    if start < 0:
        raise ValueError('Unable to map token chunk back to its source document')
    return start


def split_document(document: ExtractedDocument) -> list[dict]:
    """Split across page boundaries and map every chunk back to its source pages."""
    parts: list[str] = []
    page_spans: list[tuple[int, int, int | None]] = []
    section_positions: list[int] = []
    section_names: list[str] = []
    cursor = 0

    for page in document.pages:
        if not page.text:
            continue
        if parts:
            # A space keeps pages in one splitter stream. Newlines are strong
            # recursive-split separators, so inserting one here would make a
            # physical page break act like a semantic section boundary.
            parts.append(' ')
            cursor += 1
        page_start = cursor
        line_cursor = page_start
        for line in page.text.splitlines(keepends=True):
            stripped = line.strip()
            if _is_section_heading(stripped):
                section_positions.append(line_cursor)
                section_names.append(stripped)
            line_cursor += len(line)
        parts.append(page.text)
        cursor += len(page.text)
        page_spans.append((page_start, cursor, page.page_number))

    combined = ''.join(parts)
    if not combined:
        return []

    chunks: list[dict] = []
    for index, content in enumerate(splitter.split_text(combined)):
        start = _locate_chunk(combined, content, chunks[-1] if chunks else None)
        end = start + len(content)
        overlapping = [
            page_number for span_start, span_end, page_number in page_spans
            if span_start < end and span_end > start and page_number is not None
        ]
        section_index = bisect.bisect_right(section_positions, start) - 1
        section = section_names[section_index] if section_index >= 0 else None
        chunks.append({
            'content': content,
            'chunk_index': index,
            'start_index': start,
            'end_index': end,
            'page_start': min(overlapping) if overlapping else None,
            'page_end': max(overlapping) if overlapping else None,
            'section': section,
        })
    return validate_chunk_records(chunks)


def build_chunk_metadata(title: str, authors: str, track: str, year,
                         department: str = '', page_start=None, page_end=None,
                         section: str | None = None, chunk_index: int | None = None,
                         token_count: int | None = None) -> dict:
    """Metadata Tagging (paper, Phase 2): every chunk carries a JSON object
    with its source document's Title, Author, Track, and Year so the
    generative model can produce traceable in-line citations."""
    return {
        'title': title or '',
        'author': authors or '',
        'track': track or '',
        'year': year if year is not None else '',
        'department': department or '',
        'page_start': page_start,
        'page_end': page_end,
        'section': section,
        'chunk_index': chunk_index,
        'token_count': token_count,
        'tokenizer': TOKENIZER_ENCODING,
        'chunk_size_tokens': settings.chunk_size_tokens,
        'chunk_overlap_tokens': settings.chunk_overlap_tokens,
        'chunking_version': CHUNKING_VERSION,
    }
