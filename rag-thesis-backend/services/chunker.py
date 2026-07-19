"""Semantic Indexing (thesis paper, Section 3.2.3 — Phase 2).

RecursiveCharacterTextSplitter configured to the paper's empirically
optimized 800-token chunk size with 100-token overlap. Token counts are
calibrated at ~4 characters per token, the standard heuristic for
English academic prose, so no external tokenizer download is required.
"""

import bisect
import re

from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings
from services.document_processor import ExtractedDocument

_CHARS_PER_TOKEN = 4

splitter = RecursiveCharacterTextSplitter(
    chunk_size=settings.chunk_size_tokens * _CHARS_PER_TOKEN,       # 800 tokens ~= 3200 chars
    chunk_overlap=settings.chunk_overlap_tokens * _CHARS_PER_TOKEN, # 100 tokens ~= 400 chars
    separators=['\n\n', '\n', '. ', ' ', ''],  # paragraph-aware boundaries
    add_start_index=True,
)

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
    for index, doc in enumerate(splitter.create_documents([combined])):
        content = doc.page_content
        start = int(doc.metadata.get('start_index', combined.find(content)))
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
            'page_start': min(overlapping) if overlapping else None,
            'page_end': max(overlapping) if overlapping else None,
            'section': section,
        })
    return chunks


def build_chunk_metadata(title: str, authors: str, track: str, year,
                         department: str = '', page_start=None, page_end=None,
                         section: str | None = None, chunk_index: int | None = None) -> dict:
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
    }
