"""Reading a manuscript's front matter without a model: its abstract and adviser.

Shared by three callers that must agree on what one PDF says: the upload form's
autofill (routers/upload.py), the ingestion worker, which fills an adviser the
uploader left blank (services/ingestion.py), and the adviser backfill for papers
indexed before the field existed (scripts/backfill_paper_advisers.py). It lived
in the upload router until the worker needed it, and a worker importing an HTTP
router would pull the whole API surface into a process that serves none of it.

Everything here reads PyMuPDF's text layer and nothing else: no OCR and no model
call, so a value found here is the manuscript's own words, and a scanned
manuscript with no text layer yields blanks rather than guesses.
"""

import re
from collections.abc import Sequence

import fitz  # PyMuPDF

_WHITESPACE = re.compile(r'\s+')

# The abstract and the adviser are never printed on the title page. ISU front
# matter runs title -> approval sheet -> acknowledgment -> abstract -> contents,
# so the abstract lands on page four or five, and later still where the approval
# sheet or the acknowledgment runs long. Twelve pages reach both without turning
# one read into a whole-document read; the manuscript body is the ingestion
# pipeline's job.
FRONT_MATTER_PAGES = 12


def front_matter_texts(file_bytes: bytes, pages: int = FRONT_MATTER_PAGES) -> list[str]:
    """The text layer of the first `pages` pages, which carry the front matter."""
    document = fitz.open(stream=file_bytes, filetype='pdf')
    try:
        return [document[index].get_text() for index in range(min(pages, len(document)))]
    finally:
        document.close()


_AUTHOR_SUFFIXES = {
    'jr': 'Jr.', 'jr.': 'Jr.', 'sr': 'Sr.', 'sr.': 'Sr.',
    'ii': 'II', 'iii': 'III', 'iv': 'IV',
}


def author_token(token: str) -> str:
    """Recase one name token, leaving a token that is not shouted alone."""
    if token.casefold() in _AUTHOR_SUFFIXES:
        return _AUTHOR_SUFFIXES[token.casefold()]
    if len(token.strip('.')) == 1:
        # Every other name in the corpus writes its initials with the period,
        # so 'DANICA NICOLE F' and 'DANICA NICOLE F.' come out as one spelling.
        return f"{token.strip('.').upper()}."
    if not token.isupper():
        # 'Dela Cruz' and 'Jay-Ar' are already cased the way they are written,
        # and no recasing rule reproduces them from a lowercased form.
        return token
    return '-'.join(
        "'".join(piece.capitalize() for piece in part.split("'"))
        for part in token.split('-')
    )


# Only a line holding nothing but the word. The contents entry for the abstract
# carries its own page number out in the right margin ('ABSTRACT ....... iv'),
# and the block under *that* line is the rest of the contents list.
_ABSTRACT_HEADING = re.compile(r'^abstract\s*[:.]?$', re.IGNORECASE)

# What ends the abstract: the next front-matter section, or the manuscript
# proper. The keyword list is a stop rather than part of the capture -- it is
# set under the abstract as one block, but the field is labelled 'abstract' and
# an uploader checking an autofilled value should find prose, not indexing
# terms they did not type.
_ABSTRACT_STOP = re.compile(
    r'^(?:table\s+of\s+contents|acknowledg(?:e)?ments?|dedication|approval\s+sheet|'
    r'curriculum\s+vitae|biographical\s+sketch|list\s+of\s+(?:figures|tables|appendices)|'
    r'chapter\s+(?:\d+|[ivxlc]+)\b.*|introduction|background(?:\s+of\s+the\s+study)?|'
    r'keywords?\s*[:.]?.*)$',
    re.IGNORECASE,
)

# Front matter is numbered in roman, so both forms are page furniture. Narrower
# than the full numeral alphabet on purpose: [ivxlc] admits 'civil' as a
# five-letter numeral, and that word does stand alone on a line.
_ABSTRACT_PAGE_FURNITURE = re.compile(
    r'^[-–—\s]*(?:page\s*)?(?:\d{1,4}|[ivxl]{1,6})\s*[-–—\s]*$',
    re.IGNORECASE,
)

# Many abstract pages restate the manuscript's identity above the prose, as a
# block of labelled lines: 'Title : ...', 'Program : ...', 'Authors : ...',
# 'Academic Year : ...', 'Adviser : ...'. Reflowed with the prose it became one
# 1,300-character run-on opening with bibliographic metadata (observed
# 2026-09-22 on two CCSICT manuscripts), so it is now recognised and emitted as
# a Markdown list above the prose instead. Prose does not open with a label and
# a colon, which is what makes the block safe to identify at all.
_ABSTRACT_FIELD_LABEL = re.compile(
    r'^(?P<label>title|program|course|degree|major|track|specialization|authors?|'
    r'researchers?|students?|proponents?|academic\s+year|school\s+year|year|'
    r'advis[eo]r|co-?advis[eo]r|department|college|institution|university|date)'
    r'\s*[:–—-]',
    re.IGNORECASE,
)
# A label's value wraps, and the wrapped remainder carries no label of its own
# ('Title : Enhanced K-Means Clustering ... with' / 'Spatiotemporal Data'). Only
# consulted inside a header block that a labelled line already opened, and only
# for a line too short to be a line of justified prose that does not end a
# sentence -- so a genuine first sentence is never the thing dropped.
_ABSTRACT_HEADER_WRAP_CHARS = 60

# The ceiling routers/upload.py::_validate_metadata enforces, so an autofilled
# abstract is always one the upload form can submit.
ABSTRACT_MAX_CHARS = 10000
# A 200-word abstract runs to roughly 1,300 characters. This floor sits well
# under the shortest real one and still rejects a fragment.
ABSTRACT_MIN_CHARS = 200


def _reflow_abstract(lines: Sequence[str]) -> str:
    """Rejoin the manuscript's hard-wrapped lines into paragraphs.

    A PDF carries the typesetter's line breaks, so an abstract extracted line
    by line arrives wrapped at whatever width the manuscript was set to. Left
    that way it lands in the form's textarea as a column of half-sentences,
    and the uploader has to undo the wrapping before the prose reads -- which
    is worse than the empty field this autofill replaces.

    Blank lines are the only paragraph signal used. A manuscript that separates
    paragraphs by first-line indent alone therefore reflows into one, which is
    still prose and still editable; guessing paragraphs from leading whitespace
    is not, because PyMuPDF's indentation varies between these templates.

    A line ending in a hyphen is joined without a space and *keeps* its hyphen.
    Dropping it is the usual de-hyphenation rule and it is wrong for this
    corpus: these manuscripts are typeset in Word, whose automatic hyphenation
    is off by default, so a trailing hyphen belongs to a compound word
    ('AI-powered', 'cross-sectional') rather than marking a syllable break.
    """
    paragraphs: list[str] = []
    buffer = ''
    for line in lines:
        text = line.strip()
        if not text:
            if buffer:
                paragraphs.append(buffer)
                buffer = ''
            continue
        if not buffer:
            buffer = text
        elif buffer.endswith('-'):
            buffer += text
        else:
            buffer += ' ' + text
    if buffer:
        paragraphs.append(buffer)
    return '\n\n'.join(paragraphs)


def clip_abstract(text: str) -> str:
    """Hold the abstract inside the ceiling the upload form enforces.

    `routers/upload.py::_validate_metadata` rejects one over 10,000 characters, so
    autofilling a longer value would hand back a form that cannot submit and no
    obvious field to blame -- the same reason `_academic_codes` answers with a
    code the client can drop rather than a program another college owns. Cut at
    a word boundary and mark the cut, so the uploader can see text is missing.
    """
    if len(text) <= ABSTRACT_MAX_CHARS:
        return text
    clipped = text[:ABSTRACT_MAX_CHARS - 1]
    return (clipped.rsplit(' ', 1)[0] or clipped).rstrip() + '…'


def _is_wrapped_label_value(line: str) -> bool:
    """Whether a line reads as the overflow of the labelled line above it."""
    return (
        len(line) < _ABSTRACT_HEADER_WRAP_CHARS
        and not line.endswith(('.', '!', '?'))
    )


def _abstract_sections(
    lines: Sequence[str], start: int,
) -> tuple[list[list[str]], list[str]]:
    """Split one 'ABSTRACT' heading's block into (identity entries, prose).

    An identity entry is `[label, *value lines]`, because a label's value wraps
    and the wrapped remainder carries no label of its own.

    Both are only recognised while no prose has been captured yet, so a
    sentence inside the abstract that happens to carry a colon is safe. Leading
    blanks are skipped rather than captured for the same reason: appending one
    would close that window before the block had been passed.
    """
    identity: list[list[str]] = []
    body: list[str] = []
    for line in lines[start:]:
        stripped = line.strip()
        if _ABSTRACT_STOP.match(stripped):
            break
        if _ABSTRACT_PAGE_FURNITURE.match(stripped):
            continue
        if not body:
            if not stripped:
                continue
            matched = _ABSTRACT_FIELD_LABEL.match(stripped)
            if matched:
                identity.append([
                    matched.group('label'), stripped[matched.end():].strip(),
                ])
                continue
            if identity and _is_wrapped_label_value(stripped):
                identity[-1].append(stripped)
                continue
        body.append(stripped)
    return identity, body


def _identity_markdown(entries: Sequence[Sequence[str]]) -> str:
    """The identity block as a Markdown list, one bullet per labelled field.

    A list rather than the bare lines the page prints, because Markdown joins
    consecutive lines into one paragraph: bare lines would render as the same
    run-on this exists to undo, unless every one of them carried two trailing
    spaces -- invisible state in stored text that an uploader's own edit would
    silently strip. A bullet survives editing and reads correctly raw.
    """
    bullets: list[str] = []
    for label, *parts in entries:
        value = _reflow_abstract([part for part in parts if part])
        if not value:
            continue
        bullets.append(f'- **{_WHITESPACE.sub(" ", label).strip().title()}:** {value}')
    return '\n'.join(bullets)


def extract_abstract(page_texts: Sequence[str]) -> str:
    """The manuscript's own abstract as Markdown, read off the front matter.

    Local, and never asked of the model like the fields that
    `routers/upload.py::_ai_completion` fills. Those four are short enough to
    ask a model to copy and then check
    against the page afterwards -- which is exactly what the year does there.
    An abstract is 200-350 words: a completion paraphrases it often enough that
    the stored text would stop being the manuscript's, and this value is shown
    on the archive card and summarised into the duplication verdict. Verbatim
    or blank is the only safe pair, so this reads the page or leaves the field
    to the uploader. It also costs no call, which is why 'abstract' sits
    outside `_METADATA_FIELDS`: a manuscript whose abstract could not be found
    must not buy a Gemini completion that would not fill it either.

    Markdown, not flat text, because these pages carry two different kinds of
    content: an optional labelled identity block, and the prose. Flattened
    together they read as one run-on paragraph opening with bibliographic
    metadata. The words are still the page's own -- the only additions are the
    list markers and the emphasis around labels the page already printed.

    Every heading match is tried rather than only the first. A contents page
    that sets an entry's page number on its own line instead of after a dot
    leader puts a bare 'ABSTRACT' above the rest of the list, and stopping
    there would report the contents list -- or, once the length floor rejected
    it, nothing at all -- for a manuscript whose real abstract is two pages on.

    The floor is measured against the prose alone. A page holding only the
    identity block (its abstract having been set overleaf) would otherwise
    clear the floor on labels and report a heading with no abstract under it.
    """
    accepted = _accepted_abstract(_front_matter_lines(page_texts))
    if accepted is None:
        return ''
    _heading, identity, prose = accepted
    blocks = [block for block in (_identity_markdown(identity), prose) if block]
    return clip_abstract('\n\n'.join(blocks))


def _front_matter_lines(page_texts: Sequence[str]) -> list[str]:
    """Every line of the pages read, in order, as one list."""
    lines: list[str] = []
    for page in page_texts:
        lines.extend((page or '').splitlines())
    return lines


def _accepted_abstract(lines: Sequence[str]) -> tuple[int, list[list[str]], str] | None:
    """The first 'ABSTRACT' heading whose block really is an abstract.

    Returns the heading's line index, the identity entries above the prose,
    and the reflowed prose -- or None when no heading clears the length floor.
    Shared by `extract_abstract` and `extract_adviser`, so the two always
    agree on which page is the abstract page.
    """
    for index, line in enumerate(lines):
        if not _ABSTRACT_HEADING.match(line.strip()):
            continue
        identity, body = _abstract_sections(lines, index + 1)
        prose = _reflow_abstract(body)
        if len(prose) < ABSTRACT_MIN_CHARS:
            continue
        return index, identity, prose
    return None


# ---------------------------------------------------------------------------
# Adviser
# ---------------------------------------------------------------------------
# Read off the front matter like the abstract, and never asked of the model: a
# completion that misread a panel member as the adviser would put a wrong name
# on the archive card, and blank is the better answer (the uploader can type
# it). The front matter names the adviser in up to three places, and they are
# tried in order of trust.

# The API ceiling for the field and the clip applied to an extracted one. An
# adviser line is a name followed by degrees, and 200 characters holds the
# longest of those with room to spare.
ADVISER_MAX_CHARS = 200

# Up to two qualifiers before the role: the CCSICT templates print 'Adviser',
# 'Project Adviser' and 'Research Project Adviser'. 'co' is deliberately not a
# qualifier, so 'Co-Adviser' never matches any rule below.
_ADVISER_QUALIFIERS = r'(?:(?:thesis|research|capstone|project)\s+){0,2}'
# 'Adviser: Dr. Ana D. Cruz' on its own line, anywhere in the front matter.
_ADVISER_LABELLED_LINE = re.compile(
    rf'^{_ADVISER_QUALIFIERS}advis[eo]r\s*[:–—-]\s*(?P<value>.+)$',
    re.IGNORECASE,
)
# An identity table extracted column by column puts the separator and the
# value on the line after the label: 'Adviser' / ': Romero Dante C. Salum, DIT'
# (observed 2026-09-23 on the Alumni Tracer abstract page).
_ADVISER_SPLIT_VALUE = re.compile(r'^[:–—-]\s*(?P<value>.+)$')
# Two signature blocks extracted onto one line read 'Adviser: Dr. A. Cruz
# Co-Adviser: Engr. B. Diaz'. The value stops where the next label starts.
_ADVISER_NEXT_LABEL = re.compile(
    r'\s+(?:co-?\s*advis[eo]r|date|panel|chair(?:man|person)?|member|dean|critic)\s*[:–—-].*$',
    re.IGNORECASE,
)
# The approval sheet's signature stack: a name, then the role under it.
_ADVISER_ROLE_ONLY = re.compile(rf'{_ADVISER_QUALIFIERS}advis[eo]r\s*:?', re.IGNORECASE)
# The BLIS and BSIS templates endorse rather than recommend, under an
# 'ADVISORY COMMITTEE' heading.
_APPROVAL_PAGE = re.compile(
    r'approval\s+sheet|recommend(?:ed|ing|s)?\s+(?:for\s+)?(?:its\s+)?(?:acceptance|approval)'
    r'|panel\s+of\s+examiners|oral\s+(?:examination|defen[sc]e)'
    r'|advisory\s+committee|hereby\s+endorsed',
    re.IGNORECASE,
)
# Every role a signature stack prints under a name. Only consulted for short
# lines, so a sentence that merely opens with 'Member' is not a role line.
_SIGNATURE_ROLE = re.compile(
    rf'^{_ADVISER_QUALIFIERS}(?:co-?\s*)?'
    r'(?:advis[eo]r|chair(?:man|person)?|member|dean|coordinator|critic|examiner|panelist)\b',
    re.IGNORECASE,
)
# The heading the endorsement templates list the adviser under, and what ends
# that list: the next committee heading or the acceptance paragraph.
_ADVISORY_COMMITTEE = re.compile(r'advisory\s+committee', re.IGNORECASE)
_COMMITTEE_LIST_END = re.compile(r'committee\s*$|^approved\b', re.IGNORECASE)
_COMMITTEE_LIST_MAX_LINES = 4
# A typed signature line, as set above a signatory's printed name.
_SIGNATURE_RULE = re.compile(r'_{3,}')
_SIGNATURE_ROLE_MAX_CHARS = 60
# Words no personal name carries, but which the lines around a name do.
_ADVISER_STOP_WORDS = frozenset({
    'thesis', 'study', 'approved', 'approval', 'recommended', 'examination',
    'panel', 'chair', 'chairman', 'chairperson', 'member', 'dean', 'coordinator',
    'critic', 'college', 'university', 'department', 'date', 'signature',
    'adviser', 'advisor', 'the', 'of', 'and', 'for', 'to', 'by',
})
# Surname particles written in lower case inside an otherwise capitalised name.
_NAME_PARTICLES = frozenset({
    'de', 'del', 'dela', 'delos', 'la', 'las', 'los', 'y', 'van', 'von', 'da', 'di', 'san',
})
# Letters only, in any script: 'Peñaflor' is one token, a digit is none.
_NAME_TOKEN = re.compile(r'[^\W\d_]+')


def adviser_name(raw: str) -> str:
    """One adviser as the manuscript prints it, or '' if it is not a name.

    Credentials after the first comma (', MIT', ', PhD') are the adviser's own
    and are kept verbatim, which is exactly why the author normaliser
    (`routers/upload.py::_normalize_author`) must not be used here: it reads
    that comma as 'Surname, Given' and would reorder
    'Inst. Jenefer P. Bermusa, MIT' into 'MIT Inst. Jenefer P. Bermusa'. A name
    set in capitals is recased token by token the way authors are.
    """
    text = _WHITESPACE.sub(' ', (raw or '').replace('_', ' ')).strip(' :–—-')
    name, comma, credentials = text.partition(',')
    tokens = _NAME_TOKEN.findall(name)
    words = {token.casefold() for token in _NAME_TOKEN.findall(text)}
    if (
        not text or len(text) > ADVISER_MAX_CHARS or any(char.isdigit() for char in text)
        or not 2 <= len(tokens) <= 12 or words & _ADVISER_STOP_WORDS
    ):
        return ''
    if not all(token[0].isupper() or token.casefold() in _NAME_PARTICLES for token in tokens):
        return ''
    if name.isupper():
        name = ' '.join(author_token(token) for token in name.split())
    return f'{name.strip()}{comma}{credentials}'


def _identity_adviser(identity: Sequence[Sequence[str]]) -> tuple[str, bool]:
    """The abstract page's own 'Adviser :' entry, and whether it was ambiguous.

    The label regex already sends 'Co-Adviser' down its own branch, so only an
    exact adviser label counts. Two adviser entries naming different people is
    reported as ambiguous rather than resolved by position.
    """
    names = {
        adviser_name(' '.join(part for part in parts if part))
        for label, *parts in identity
        if re.fullmatch(r'advis[eo]r', _WHITESPACE.sub(' ', label).strip(), re.IGNORECASE)
    }
    names.discard('')
    if len(names) > 1:
        return '', True
    return next(iter(names), ''), False


def _labelled_adviser(lines: Sequence[str]) -> str:
    """The first 'Adviser: <name>' whose value is really a name.

    The value may sit on the label's own line, or -- where an identity table
    was extracted column by column -- on the next line behind the separator.
    """
    stripped = [line.strip() for line in lines if line.strip()]
    for index, line in enumerate(stripped):
        match = _ADVISER_LABELLED_LINE.match(line)
        if not match and _ADVISER_ROLE_ONLY.fullmatch(line) and index + 1 < len(stripped):
            match = _ADVISER_SPLIT_VALUE.match(stripped[index + 1])
        if not match:
            continue
        name = adviser_name(_ADVISER_NEXT_LABEL.sub('', match.group('value')))
        if name:
            return name
    return ''


def _signature_lines(lines: Sequence[str]) -> list[str]:
    """A signature page's lines without blanks and typed rules."""
    return [
        line.strip() for line in lines
        if line.strip() and not re.fullmatch(r'[_\W\d]+', line.strip())
    ]


def _signature_stack_advisers(lines: Sequence[str]) -> set[str] | None:
    """Names printed above an 'Adviser' role line on one approval page.

    The layout has to be confirmed for the whole page first: every role line
    on it must have a name directly above it. Two signature blocks set side by
    side ('ANA CRUZ / BEN DIAZ / Adviser / Co-Adviser') and a label printed
    above its name ('Chairman / DR. B / Adviser / DR. A') both fail that, and
    both would otherwise hand back the wrong person. So does a page whose role
    labels were extracted as one block beneath all the names -- the name that
    lands above 'Project Adviser' there is the dean's. None means the page
    cannot be read this way.
    """
    kept = _signature_lines(lines)
    names: set[str] = set()
    for index, line in enumerate(kept):
        if len(line) > _SIGNATURE_ROLE_MAX_CHARS or not _SIGNATURE_ROLE.match(line):
            continue
        above = adviser_name(kept[index - 1]) if index else ''
        if not above:
            return None
        if _ADVISER_ROLE_ONLY.fullmatch(line):
            names.add(above)
    return names


def _advisory_committee_adviser(lines: Sequence[str]) -> str:
    """The one name an 'ADVISORY COMMITTEE' heading lists, or ''.

    The endorsement templates list the adviser under that heading, ahead of
    the panel committee. It stays readable even where the role labels were
    extracted apart from the names, because it depends on the heading rather
    than on what sits above a label. Two names there -- an adviser and a
    co-adviser -- give no single answer, so none is given.
    """
    kept = _signature_lines(lines)
    for index, line in enumerate(kept):
        if not _ADVISORY_COMMITTEE.fullmatch(line):
            continue
        names = []
        for following in kept[index + 1:index + 1 + _COMMITTEE_LIST_MAX_LINES]:
            if _COMMITTEE_LIST_END.search(following):
                break
            name = adviser_name(following)
            if name:
                names.append(name)
        return names[0] if len(names) == 1 else ''
    return ''


def _signed_advisers(lines: Sequence[str]) -> set[str]:
    """Names on any page set as a signature line, the name, then 'Adviser'.

    The capstone title page signs the adviser this way below the authors
    ('____' / 'Desiray D. Nayga, DIT' / 'Project Adviser'). The typed rule
    directly above the name is what separates a signature block from a bare
    'Adviser' line that merely follows a name, so it is required.
    """
    stripped = [line.strip() for line in lines if line.strip()]
    names: set[str] = set()
    for index in range(2, len(stripped)):
        if (
            _ADVISER_ROLE_ONLY.fullmatch(stripped[index])
            and _SIGNATURE_RULE.fullmatch(stripped[index - 2])
        ):
            name = adviser_name(stripped[index - 1])
            if name:
                names.add(name)
    return names


def _approval_sheet_adviser(pages: Sequence[str]) -> str:
    """The adviser the signature pages name, if they all name the same one.

    Each page contributes what can be read safely -- its advisory committee
    list, its signature stack, a signed title-page block -- and a page that
    cannot be read one way simply contributes nothing that way. Any
    disagreement between the names collected leaves the field blank.
    """
    names: set[str] = set()
    for page in pages:
        lines = (page or '').splitlines()
        names |= _signed_advisers(lines)
        if not _APPROVAL_PAGE.search(page or ''):
            continue
        committee = _advisory_committee_adviser(lines)
        if committee:
            names.add(committee)
        names |= _signature_stack_advisers(lines) or set()
    if len({name.casefold() for name in names}) != 1:
        return ''
    return next(iter(names))


def _page_of_line(pages: Sequence[str], line_index: int) -> int:
    """Which page a `_front_matter_lines` index falls on."""
    seen = 0
    for number, page in enumerate(pages):
        seen += len((page or '').splitlines())
        if line_index < seen:
            return number
    return max(len(pages) - 1, 0)


def adviser_with_source(page_texts: Sequence[str]) -> tuple[str, str]:
    """The manuscript's adviser and which rule found it, or ('', '').

    Blank whenever the pages leave any doubt: a wrong adviser on the archive
    card is worse than an empty field the uploader fills in. Past the abstract
    page lie the chapters, where a thesis *about* an advising workflow can
    print 'Adviser - the user who reviews ...', so once the abstract page is
    known the two looser rules stop there.
    """
    pages = list(page_texts)
    accepted = _accepted_abstract(_front_matter_lines(pages))
    if accepted is not None:
        name, ambiguous = _identity_adviser(accepted[1])
        if name:
            return name, 'abstract identity block'
        if ambiguous:
            return '', ''
        pages = pages[:_page_of_line(pages, accepted[0]) + 1]
    name = _labelled_adviser(_front_matter_lines(pages))
    if name:
        return name, 'labelled line'
    name = _approval_sheet_adviser(pages)
    if name:
        return name, 'signature block'
    return '', ''


def extract_adviser(page_texts: Sequence[str]) -> str:
    """The manuscript's adviser, read off its front matter, or ''."""
    return adviser_with_source(page_texts)[0]
