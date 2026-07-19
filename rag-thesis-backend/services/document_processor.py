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
from dataclasses import dataclass, field

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


@dataclass(frozen=True)
class ExtractedPage:
    """A cleaned source page retained for traceable citation mapping."""

    page_number: int | None
    text: str


@dataclass(frozen=True)
class ExtractedDocument:
    """Clean text plus page boundaries used by semantic chunking."""

    pages: list[ExtractedPage]
    redaction_stats: dict[str, int] = field(default_factory=dict)

    @property
    def text(self) -> str:
        return '\n\n'.join(page.text for page in self.pages if page.text)

# A page with fewer than this many extractable characters but containing
# images is treated as a scanned page and routed to OCR.
_MIN_TEXT_CHARS_PER_PAGE = 40

# Sections excluded from semantic indexing per the paper's delimitations.
_EXCLUDED_SECTION_HEADINGS = re.compile(
    r'^\s*(table\s+of\s+contents|bibliography|references|acknowledg(?:e)?ments?|'
    r'dedication|approval\s+sheet|curriculum\s+vitae|biographical\s+sketch|'
    r'list\s+of\s+(figures|tables|appendices))\s*$',
    re.IGNORECASE,
)
_CHAPTER_HEADING = re.compile(r'^\s*(chapter\s+\d+|chapter\s+[ivxlc]+)\b', re.IGNORECASE)

_PAGE_NUMBER_LINE = re.compile(
    r'^[-–—\s]*(?:page\s*)?\d{1,4}\s*(?:of\s+\d{1,4})?[-–—\s]*$',
    re.IGNORECASE,
)
# Dot-leader lines typical of a Table of Contents ("1.2 Objectives ....... 12")
_TOC_LEADER_LINE = re.compile(r'\.{4,}\s*\d{1,4}\s*$')

_PII_RULES = (
    (
        'email',
        re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.IGNORECASE),
        '[EMAIL REDACTED]',
    ),
    (
        'phone',
        re.compile(r'(?<!\d)(?:\+?63|0)\s*9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)'),
        '[PHONE REDACTED]',
    ),
    ('student_number', re.compile(
        r'\b(?:student\s*(?:no\.?|number|id)|id\s*(?:no\.?|number))\s*[:#-]?\s*[A-Z0-9-]{5,20}\b',
        re.IGNORECASE,
    ), '[STUDENT NUMBER REDACTED]'),
    (
        'address',
        re.compile(
            r'^\s*(?:home|residential|mailing)?\s*address\s*:\s*.+$',
            re.IGNORECASE | re.MULTILINE,
        ),
        '[ADDRESS REDACTED]',
    ),
    ('participant_identifier', re.compile(
        r'\b(?:participant|respondent|subject)\s*(?:id|code|no\.?|number)?\s*[:#-]?\s*[A-Z]*\d{1,5}\b',
        re.IGNORECASE,
    ), '[PARTICIPANT ID REDACTED]'),
    (
        'signature',
        re.compile(
            r'^\s*(?:signature|signed\s+by)\s*[:_].*$',
            re.IGNORECASE | re.MULTILINE,
        ),
        '[SIGNATURE REDACTED]',
    ),
)


def redact_pii(text: str) -> tuple[str, dict[str, int]]:
    """Redact deterministic high-risk PII while preserving research prose."""
    cleaned = text or ''
    counts: dict[str, int] = {}
    for category, pattern, replacement in _PII_RULES:
        cleaned, count = pattern.subn(replacement, cleaned)
        if count:
            counts[category] = count
    return cleaned, counts


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
        logger.error('OCR failed on page %d (%s)', page.number, type(e).__name__)
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


def _remove_excluded_sections_from_pages(pages: list[ExtractedPage]) -> list[ExtractedPage]:
    """Remove excluded blocks without losing the surviving page numbers."""
    output: list[ExtractedPage] = []
    skipping = False
    for page in pages:
        kept = []
        for line in page.text.splitlines():
            stripped = line.strip()
            if _EXCLUDED_SECTION_HEADINGS.match(stripped):
                skipping = True
                continue
            if skipping and _CHAPTER_HEADING.match(stripped):
                skipping = False
            if not skipping:
                kept.append(line)
        text = re.sub(r'\n{3,}', '\n\n', '\n'.join(kept)).strip()
        if text:
            output.append(ExtractedPage(page.page_number, text))
    return output


def extract_pdf_document(file_bytes: bytes) -> ExtractedDocument:
    """Full digitization pipeline retaining cleaned PDF page boundaries."""
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
    cleaned_pages = []
    redaction_totals: Counter[str] = Counter()
    for index, text in enumerate(raw_pages):
        redacted, counts = redact_pii(_clean_page(text, repeated))
        redaction_totals.update(counts)
        cleaned_pages.append(ExtractedPage(index + 1, redacted))
    return ExtractedDocument(
        _remove_excluded_sections_from_pages(cleaned_pages),
        dict(redaction_totals),
    )


def extract_pdf_text(file_bytes: bytes) -> str:
    """Backward-compatible text-only PDF extraction."""
    return extract_pdf_document(file_bytes).text


def extract_document(file_bytes: bytes, filename: str) -> ExtractedDocument:
    """Extract a structured PDF or a page-less plain-text document."""
    if (filename or '').lower().endswith('.pdf'):
        return extract_pdf_document(file_bytes)
    text = file_bytes.decode('utf-8', errors='ignore')
    cleaned = re.sub(r'\n{3,}', '\n\n', text).strip()
    redacted, counts = redact_pii(cleaned)
    return ExtractedDocument([ExtractedPage(None, redacted)] if redacted else [], counts)


def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract clean text from an uploaded thesis file (PDF or plain text)."""
    return extract_document(file_bytes, filename).text


def filter_noise_chunks(chunks: list[str]) -> list[str]:
    """Discard chunks that fail the paper's 15% non-alphanumeric rule."""
    kept = []
    for chunk in chunks:
        if is_noise_chunk(chunk):
            logger.info('Discarded noisy chunk (%d chars) per 15%% non-alphanumeric rule', len(chunk))
            continue
        kept.append(chunk)
    return kept
