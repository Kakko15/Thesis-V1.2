"""Document Processing System (thesis paper, Section 3.2.3 — Phase 1: Data Digitization).

Pipeline: PyMuPDF extraction -> per-page Tesseract OCR fallback for scanned
pages -> regex data-cleaning (strip page numbers, running headers/footers,
Table of Contents and Bibliography sections, OCR artifacts) -> figure
placeholder injection -> noise-chunk filtering (>15% non-alphanumeric).

Shared by the upload ingestion flow and the duplication/novelty scanner.
"""

import io
import logging
import re
from collections import Counter

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# OCR is optional at runtime: the system degrades gracefully when the
# Tesseract binary or pytesseract/Pillow are not installed.
try:
    import pytesseract
    from PIL import Image
    _OCR_AVAILABLE = True
except ImportError:  # pragma: no cover
    pytesseract = None
    Image = None
    _OCR_AVAILABLE = False

FIGURE_PLACEHOLDER = 'FIGURE REDACTED FOR SEMANTIC INDEXING'

# A page with fewer than this many extractable characters but containing
# images is treated as a scanned page and routed to OCR.
_MIN_TEXT_CHARS_PER_PAGE = 40

# Sections excluded from semantic indexing per the paper's delimitations.
_EXCLUDED_SECTION_HEADINGS = re.compile(
    r'^\s*(table\s+of\s+contents|bibliography|references|list\s+of\s+(figures|tables|appendices))\s*$',
    re.IGNORECASE,
)
_CHAPTER_HEADING = re.compile(r'^\s*(chapter\s+\d+|chapter\s+[ivxlc]+)\b', re.IGNORECASE)

_PAGE_NUMBER_LINE = re.compile(
    r'^[-–—\s]*(?:page\s*)?\d{1,4}\s*(?:of\s+\d{1,4})?[-–—\s]*$',
    re.IGNORECASE,
)
# Dot-leader lines typical of a Table of Contents ("1.2 Objectives ....... 12")
_TOC_LEADER_LINE = re.compile(r'\.{4,}\s*\d{1,4}\s*$')


def is_noise_chunk(text: str, max_non_alnum_ratio: float = 0.15) -> bool:
    """True when non-alphanumeric characters exceed the paper's 15% limit.

    Whitespace is not counted against the text (it is structure, not noise).
    Guards the vector space against corrupted OCR output from faded copies.
    """
    stripped = re.sub(r'\s+', '', text)
    if not stripped:
        return True
    non_alnum = sum(1 for ch in stripped if not ch.isalnum())
    return (non_alnum / len(stripped)) > max_non_alnum_ratio


def _ocr_page(page: 'fitz.Page') -> str:
    """Rasterize a page with PyMuPDF and run Tesseract OCR on it."""
    if not _OCR_AVAILABLE:
        logger.warning('Scanned page detected but Tesseract OCR is not installed; skipping page %d', page.number)
        return ''
    try:
        pix = page.get_pixmap(dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes('png')))
        return pytesseract.image_to_string(img)
    except Exception as e:  # pragma: no cover - depends on system binary
        logger.error('OCR failed on page %d: %s', page.number, e)
        return ''


def _detect_repeated_lines(pages: list[str]) -> set[str]:
    """Find running headers/footers: identical first/last lines across pages."""
    if len(pages) < 4:
        return set()
    candidates = Counter()
    for page_text in pages:
        lines = [ln.strip() for ln in page_text.splitlines() if ln.strip()]
        if not lines:
            continue
        for ln in dict.fromkeys((lines[0], lines[-1])):
            if 3 < len(ln) < 90 and not _CHAPTER_HEADING.match(ln):
                candidates[ln.lower()] += 1
    threshold = max(3, len(pages) // 3)
    return {line for line, count in candidates.items() if count >= threshold}


def _clean_page(page_text: str, repeated_lines: set[str]) -> str:
    """Regex sanitization of a single page (paper: GIGO mitigation)."""
    cleaned_lines = []
    for raw_line in page_text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append('')
            continue
        if _PAGE_NUMBER_LINE.match(stripped):
            continue
        if stripped.lower() in repeated_lines:
            continue
        if _TOC_LEADER_LINE.search(stripped):
            continue
        # Collapse common OCR artifacts (stray control chars, long symbol runs)
        line = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', line)
        line = re.sub(r'([^\w\s])\1{3,}', r'\1', line)
        cleaned_lines.append(line)
    text = '\n'.join(cleaned_lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _remove_excluded_sections(full_text: str) -> str:
    """Drop Table of Contents / Bibliography / References blocks.

    A section ends when the next chapter heading (or end of document) begins.
    """
    lines = full_text.splitlines()
    output = []
    skipping = False
    for line in lines:
        stripped = line.strip()
        if _EXCLUDED_SECTION_HEADINGS.match(stripped):
            skipping = True
            continue
        if skipping and _CHAPTER_HEADING.match(stripped):
            skipping = False
        if not skipping:
            output.append(line)
    return '\n'.join(output)


def extract_pdf_text(file_bytes: bytes) -> str:
    """Full digitization pipeline for a PDF file."""
    doc = fitz.open(stream=file_bytes, filetype='pdf')
    raw_pages: list[str] = []
    for page in doc:
        text = page.get_text().strip()
        has_images = bool(page.get_images(full=True))
        if len(text) < _MIN_TEXT_CHARS_PER_PAGE and has_images:
            # Scanned / image-based page -> OCR fallback
            ocr_text = _ocr_page(page).strip()
            text = ocr_text if ocr_text else text
        elif has_images and text:
            # Complex visuals (ERDs, image-based tables) bypassed by the
            # parser: inject the standardized placeholder to preserve
            # contextual integrity for the generative model.
            text = f'{text}\n{FIGURE_PLACEHOLDER}'
        raw_pages.append(text)
    doc.close()

    repeated = _detect_repeated_lines(raw_pages)
    cleaned_pages = [_clean_page(p, repeated) for p in raw_pages]
    full_text = '\n\n'.join(p for p in cleaned_pages if p)
    full_text = _remove_excluded_sections(full_text)
    return full_text.strip()


def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract clean text from an uploaded thesis file (PDF or plain text)."""
    if (filename or '').lower().endswith('.pdf'):
        return extract_pdf_text(file_bytes)
    text = file_bytes.decode('utf-8', errors='ignore')
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def filter_noise_chunks(chunks: list[str]) -> list[str]:
    """Discard chunks that fail the paper's 15% non-alphanumeric rule."""
    kept = []
    for chunk in chunks:
        if is_noise_chunk(chunk):
            logger.info('Discarded noisy chunk (%d chars) per 15%% non-alphanumeric rule', len(chunk))
            continue
        kept.append(chunk)
    return kept
