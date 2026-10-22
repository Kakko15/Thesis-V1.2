"""Reading an uploaded capsule proposal into its four screened sections.

A capsule usually already exists as a file -- most often a Word document, from
a template the adviser handed out -- so Novelty Review accepts one and fills
the capsule form from it for the reviewer to check before screening. Nothing
here is scored: the result only pre-fills fields a person reviews, which is why
a heuristic heading match is acceptable where the screening itself is not.

Word support is the standard library only. A .docx is a zip holding
word/document.xml; paragraphs are its <w:p> elements and their text is in
<w:t>. Adding python-docx for that would add a dependency to the hash-locked
image for what is thirty lines, so the two risks a parser library would
otherwise absorb are handled here: the archive's declared size is checked
before anything is inflated (a zip bomb), and a document carrying a DOCTYPE is
refused outright (entity expansion), since a genuine .docx never has one.
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

from services.capsule import CAPSULE_SECTIONS, clean_text

# Word's main document part, and a ceiling on its inflated size. A 25 MB upload
# can declare gigabytes; a real capsule's text is a few hundred kilobytes.
_DOCUMENT_PART = 'word/document.xml'
MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024
_W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

# Same caps as routers/duplication.py::CapsuleScanReq, so a filled form never
# exceeds what the screening endpoint accepts.
FIELD_LIMITS = {'title': 300, 'rationale': 6000, 'objectives': 6000, 'methodology': 6000}


class CapsuleFileError(ValueError):
    """The file is not a readable capsule. The message is safe to show."""


def docx_text(file_bytes: bytes) -> str:
    """The paragraphs of a .docx, one per line."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile as error:
        raise CapsuleFileError('The Word file could not be opened.') from error
    with archive:
        try:
            info = archive.getinfo(_DOCUMENT_PART)
        except KeyError as error:
            raise CapsuleFileError('The file is not a Word document.') from error
        if info.file_size > MAX_DOCUMENT_XML_BYTES:
            raise CapsuleFileError('The Word document is too large to read.')
        with archive.open(info) as part:
            xml = part.read(MAX_DOCUMENT_XML_BYTES + 1)
    if len(xml) > MAX_DOCUMENT_XML_BYTES:
        raise CapsuleFileError('The Word document is too large to read.')
    if b'<!DOCTYPE' in xml[:4096].upper() or b'<!ENTITY' in xml.upper():
        raise CapsuleFileError('The Word document could not be read.')
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise CapsuleFileError('The Word document could not be read.') from error
    paragraphs = []
    for paragraph in root.iter(f'{_W}p'):
        pieces = []
        for node in paragraph.iter():
            if node.tag == f'{_W}t' and node.text:
                pieces.append(node.text)
            elif node.tag in (f'{_W}tab',):
                pieces.append(' ')
            elif node.tag in (f'{_W}br', f'{_W}cr'):
                pieces.append('\n')
        text = ''.join(pieces).strip()
        if text:
            paragraphs.append(text)
    return '\n'.join(paragraphs)


# Heading vocabulary, per section. Matched against a whole short line, after
# stripping numbering ("I.", "1.2", "A)") and a trailing colon, so a sentence
# that merely mentions "the methodology" is never read as a heading. `None`
# marks a capsule part that exists but is not screened (timeline, budget...):
# its heading ends the section before it, and its text is dropped.
_HEADINGS: tuple[tuple[str | None, str], ...] = (
    ('title', r'(?:working|proposed|research|thesis|study|project)?\s*title'
              r'(?:\s+of\s+the\s+(?:study|research|project))?'),
    ('rationale', r'rationale(?:\s+and\s+significance)?|significance(?:\s+of\s+the\s+(?:study|research))?'
                  r'|background(?:\s+of\s+the\s+(?:study|research))?|introduction|statement\s+of\s+the\s+problem'
                  r'|problem\s+statement|justification|context(?:\s+of\s+the\s+study)?'),
    ('objectives', r'(?:general\s+|specific\s+|research\s+)?objectives?(?:\s+of\s+the\s+(?:study|research))?'
                   r'|research\s+questions?|aims?(?:\s+and\s+objectives)?|purpose\s+of\s+the\s+(?:study|research)'),
    ('methodology', r'(?:proposed\s+|research\s+|study\s+|system\s+|development\s+)?(?:methodology|methods?)'
                    r'|research\s+(?:design|approach|framework)|materials\s+and\s+methods|procedures?'
                    r'|data\s+(?:gathering|collection)(?:\s+procedures?)?|system\s+(?:development|architecture|design)'
                    r'|(?:conceptual|technical|theoretical)\s+framework|tools\s+and\s+technolog(?:y|ies)'
                    r'|technology\s+stack|proposed\s+(?:system|solution|approach)'),
    # Scope and limitations sit between the objectives and the methodology in
    # most templates. They describe the study's boundaries, not what it sets out
    # to do, and an uploaded capsule on 2026-09-24 had its "Limitations" list
    # merged into the objectives because nothing ended that section.
    (None, r'timeline|time\s*frame|schedule|gantt\s+chart|budget|cost(?:\s+estimates?)?|expected\s+outputs?'
           r'|references|bibliography|proponents?|researchers?|advisers?|prepared\s+by|noted\s+by|approved\s+by'
           r'|scope(?:\s+and\s+(?:limitations?|delimitations?))?|(?:de)?limitations?(?:\s+of\s+the\s+study)?'
           r'|assumptions?|definition\s+of\s+terms'),
)
_NUMBERING = re.compile(r'^\s*(?:[ivxlc]+|\d+(?:\.\d+)*|[a-z])[\.\)]\s*', re.IGNORECASE)
_HEADING_PATTERNS = [
    (key, re.compile(rf'^(?:{pattern})\s*[:\-–—]?\s*(?P<rest>.*)$', re.IGNORECASE))
    for key, pattern in _HEADINGS
]
_MAX_HEADING_WORDS = 8
# A heading may carry a few words past its keyword ("Methodology and Tools",
# "Proposed Methodology Overview") as long as the whole line is short and does
# not end like a sentence. Exact-match headings left a real capsule's
# methodology unread on 2026-09-24.
_MAX_LOOSE_HEADING_WORDS = 6
_SENTENCE_END = re.compile(r'[.?!,;]$')
# Lines above the first heading that name the document rather than the study.
_INSTITUTIONAL = re.compile(
    r'\b(?:university|college|campus|republic|department|capsule|proposal|echague|isabela|ccsict)\b',
    re.IGNORECASE,
)


def _heading(line: str) -> tuple[str | None, str] | None:
    """(section, inline text) when `line` is a capsule heading, else None."""
    stripped = _NUMBERING.sub('', line.strip()).strip()
    for key, pattern in _HEADING_PATTERNS:
        match = pattern.match(stripped)
        if not match:
            continue
        rest = match.group('rest').strip()
        heading_part = stripped[: len(stripped) - len(rest)] if rest else stripped
        if len(heading_part.split()) > _MAX_HEADING_WORDS:
            continue
        if rest and not re.search(r'[:\-–—]\s*$', heading_part):
            # No colon: "Methodology and Tools" is still a heading, but
            # "Methods used to gather data were interviews." is a sentence.
            if len(stripped.split()) <= _MAX_LOOSE_HEADING_WORDS and not _SENTENCE_END.search(stripped):
                return key, ''
            continue
        # Closed by a colon or dash: the rest of the line is the section's
        # first text, as in "Title: A Smart Intruder Detection System".
        return key, rest
    return None


def split_capsule(text: str) -> dict:
    """The four capsule fields found in `text`, and which were found by heading."""
    sections: dict[str, list[str]] = {key: [] for key, _label in CAPSULE_SECTIONS}
    detected: list[str] = []
    current: str | None = 'preamble'
    preamble: list[str] = []
    for raw_line in (text or '').splitlines():
        line = raw_line.strip()
        if not line:
            continue
        heading = _heading(line)
        if heading is not None:
            current, inline = heading
            if current and current not in detected:
                detected.append(current)
            if current and inline:
                sections[current].append(inline)
            continue
        if current == 'preamble':
            preamble.append(line)
        elif current:
            sections[current].append(line)

    if not sections['title']:
        # No "Title" heading: the working title is conventionally the first
        # line above the first section that is not the institution's letterhead.
        for line in preamble[:12]:
            if len(line.split()) >= 3 and not _INSTITUTIONAL.search(line):
                sections['title'].append(line)
                break

    fields = {}
    for key, _label in CAPSULE_SECTIONS:
        joined = ' '.join(sections[key]) if key == 'title' else '\n'.join(sections[key])
        value = clean_text(joined) if key == 'title' else '\n'.join(
            clean_text(line) for line in joined.splitlines() if clean_text(line)
        )
        fields[key] = value[: FIELD_LIMITS[key]].rstrip()
    return {**fields, 'detected_sections': detected}
