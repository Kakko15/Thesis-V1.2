"""Semantic Indexing (thesis paper, Section 3.2.3 — Phase 2).

RecursiveCharacterTextSplitter configured to the paper's empirically
optimized 800-token chunk size with 100-token overlap. Token counts are
calibrated at ~4 characters per token, the standard heuristic for
English academic prose, so no external tokenizer download is required.
"""

from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings

_CHARS_PER_TOKEN = 4

splitter = RecursiveCharacterTextSplitter(
    chunk_size=settings.chunk_size_tokens * _CHARS_PER_TOKEN,       # 800 tokens ~= 3200 chars
    chunk_overlap=settings.chunk_overlap_tokens * _CHARS_PER_TOKEN, # 100 tokens ~= 400 chars
    separators=['\n\n', '\n', '. ', ' ', ''],  # paragraph-aware boundaries
)


def split_text(text: str) -> list[str]:
    return splitter.split_text(text)


def build_chunk_metadata(title: str, authors: str, track: str, year) -> dict:
    """Metadata Tagging (paper, Phase 2): every chunk carries a JSON object
    with its source document's Title, Author, Track, and Year so the
    generative model can produce traceable in-line citations."""
    return {
        'title': title or '',
        'author': authors or '',
        'track': track or '',
        'year': year if year is not None else '',
    }
