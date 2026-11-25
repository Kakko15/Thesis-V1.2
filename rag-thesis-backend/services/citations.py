"""Structural citation validation for generated RAG answers."""

import re


_CITATION = re.compile(r'\[(\d+)\]')
_GROUPED_CITATION = re.compile(r'\[\s*\d+\s*[,;]\s*\d+')
_COMPLETE_GROUPED_CITATION = re.compile(r'\[\s*(\d+(?:\s*[,;]\s*\d+)+)\s*\]')


def normalize_citation_markers(answer: str) -> str:
    """Convert model-generated `[1, 2]` groups into valid `[1] [2]` markers."""
    def expand(match: re.Match) -> str:
        values = re.split(r'\s*[,;]\s*', match.group(1))
        return ' '.join(f'[{int(value)}]' for value in values)

    return _COMPLETE_GROUPED_CITATION.sub(expand, answer or '')


def cited_ids(answer: str) -> set[int]:
    return {int(value) for value in _CITATION.findall(answer or '')}


def source_citation_id(source: dict, position: int) -> int:
    value = source.get('citation_id')
    return int(value) if value is not None else position


def filter_cited_sources(answer: str, sources: list[dict]) -> list[dict]:
    """Return valid cited sources in citation-number order."""
    wanted = cited_ids(answer)
    indexed = {
        source_citation_id(source, position): source
        for position, source in enumerate(sources, start=1)
    }
    return [indexed[citation_id] for citation_id in sorted(wanted) if citation_id in indexed]


_UNIT_SEPARATOR = re.compile(r'\n\s*\n|\n(?=\s*[-*]\s+|\s*\d+[.)]\s+)')
_LIST_MARKER = re.compile(r'^\s*(?:[-*]|\d+[.)])\s+')
_BOLD_OBJECTIVE_LABEL = re.compile(
    r'\*\*(?:general objective|specific objectives?|objectives? of the study)\*\*:?',
    re.IGNORECASE,
)
# Standalone bold headings/title labels (e.g. `- **FindMe: ...**` or
# `**Key Findings:**`). CITATION_CONTRACT says headings and bold labels are not
# units, but a bold line can also BE a claim (`**The system achieved 98%
# accuracy**`), so the shape alone is not enough: see `_is_bold_label`.
_STANDALONE_BOLD_LABEL = re.compile(r'\*\*(?P<label>[^*\n]{1,180}?)(?<![.!?])\*\*(?P<colon>:?)')
# Verbs that turn a bold line into an assertion about what a study did/found.
# Heading nouns that double as verbs ("Results", "Scores") are deliberately
# absent: `**Key Results**` organizes an answer, it asserts nothing.
_CLAIM_VERBS = frozenset({
    'is', 'are', 'was', 'were', 'has', 'have', 'had', 'achieved', 'achieves', 'achieve',
    'outperformed', 'outperforms', 'outperform', 'improved', 'improves', 'improve',
    'increased', 'increases', 'decreased', 'decreases', 'reduced', 'reduces',
    'showed', 'shows', 'show', 'found', 'finds', 'proved', 'proves', 'demonstrated',
    'demonstrates', 'reached', 'reaches', 'obtained', 'obtains', 'scored',
    'yielded', 'yields', 'resulted', 'performed', 'performs', 'surpassed',
    'surpasses', 'exceeded', 'exceeds', 'used', 'uses', 'utilized', 'utilizes',
    'employed', 'employs', 'applied', 'applies', 'developed', 'develops', 'reported',
    'reports', 'concluded', 'concludes', 'confirmed', 'confirms', 'revealed', 'reveals',
})
_YEAR_TOKEN = re.compile(r'\b(?:19|20)\d\d\b')
# Mandatory non-English opener commanded by OUTPUT_CONTRACT. It is a system
# language disclosure, never a claim drawn from an archived thesis.
_ENGLISH_LANGUAGE_NOTICE = re.compile(
    r'^(?:note:\s*)?(?:the|this)\s+(?:ccsict\s+|thesis\s+)?archive\s+and\s+'
    r'(?:your|my|the|its|iskai\'?s)\s+(?:answers?|responses?|replies)\s+'
    r'(?:are|is)\s+(?:in|written\s+in|provided\s+in)\s+english\.?$',
    re.IGNORECASE,
)
# Mandatory sample-scope closing line commanded by QUESTION_TYPE_TASKS
# (aggregate / enumeration) noting that the reply only covers retrieved items.
# It must also name the archive or the retrieved set (`_ARCHIVE_SCOPE_WORD`):
# without that, "The results may not represent all Filipino farmers." -- a
# limitation stated BY a thesis -- would pass uncited.
_RETRIEVAL_SCOPE_CAVEAT = re.compile(
    r'^(?:note:\s*)?(?:this\s+(?:answer|list|summary|response)|'
    r'the\s+(?:retrieved\s+)?(?:evidence|passages?|studies|results?))\s+'
    r'(?:presented\s+here\s+|supplied\s+|provided\s+|here\s+)?'
    r'(?:covers?\s+(?:only\s+)?the\s+retrieved|'
    r'may\s+not\s+(?:cover|include|list|represent)\s+(?:every|all)|'
    r'reflects?\s+(?:only\s+)?the\s+retrieved|'
    r'is\s+limited\s+to\s+the\s+retrieved)[^.\n]{0,180}\.?$',
    re.IGNORECASE,
)
_ARCHIVE_SCOPE_WORD = re.compile(
    r'\b(?:archive|archived|retrieved|indexed|supplied|this\s+(?:answer|list|summary|response))\b',
    re.IGNORECASE,
)
# A sentence that only reports what the archive / retrieved evidence LACKS
# ("The archive does not contain a blockchain voting thesis."). No retrieved
# passage can support a claim about an absence, so requiring -- or stapling --
# a marker here attributes a negative archive claim to a thesis that never made
# it (the defect `routers/chat.py` documents beside its no-evidence branch).
# Deliberately narrow: one sentence, no figures, the negation must be governed
# by the archive/evidence itself (so "The evidence shows FindMe does not detect
# side faces" stays a cited thesis claim), and no contrastive clause that slips
# a positive finding in ("... but instead focus on document tracking").
_GAP_SUBJECT = (
    r'(?:archive|retrieved\s+(?:evidence|passages?|studies|text|documents?)|'
    r'(?:provided|supplied|available)\s+(?:evidence|text|passages?)|evidence|passages)'
)
_GAP_START = re.compile(
    rf'^(?:however,?\s+|but\s+|note:\s*)?(?:the|this|these)\s+(?:ccsict\s+)?{_GAP_SUBJECT}\b',
    re.IGNORECASE,
)
_GAP_NEGATION = re.compile(
    rf'\b{_GAP_SUBJECT}\s+(?:itself\s+|also\s+|currently\s+)?'
    r'(?:does\s+not|do\s+not|doesn\'t|don\'t|did\s+not|contains?\s+no|provides?\s+no|'
    r'has\s+no|have\s+no|holds?\s+no|lacks?|includes?\s+no|offers?\s+no)\b',
    re.IGNORECASE,
)
_GAP_CONTRAST = re.compile(r'\b(?:instead|rather|whereas|while)\b', re.IGNORECASE)
# Every clause must itself be negative: "The archive does not cover federated
# learning, but it does cover on-device inference [1]" carries a real, cited
# finding in its second clause and must keep its marker.
_CLAUSE_SPLIT = re.compile(r'\b(?:but|however|though|although|yet)\b|;', re.IGNORECASE)
_NEGATION_WORD = re.compile(
    r'\b(?:not|no|none|nothing|neither|nor|without|lacks?|cannot|n\'t)\b|n\'t\b', re.IGNORECASE,
)
_MARKER_RUN = re.compile(r'\s*\[\d+\]')
# Leading aspect label on a comparison bullet, e.g. `**Unexplored research gaps**: `.
# Stripped before gap-statement detection so an honest "The provided evidence does
# not state unexplored gaps for this study." bullet is not flagged as an uncited
# claim and deleted by citation repair (measured 2026-11-26).
_LEADING_ASPECT_LABEL = re.compile(
    r'^(?:\*\*[^*\n]{1,80}\*\*|[A-Za-z][A-Za-z0-9 /&()-]{0,50})\s*:\s*'
)
# A framing sentence that only announces the comparison axis ("The comparison
# between the two studies spans method, dataset, and scope."). The per-thesis
# bullets that follow carry the cited claims. A framing line that ranks the
# studies is a claim and stays substantive.
#
# Measured 2026-11-25 on the app's own "Compare the BSCS alumni tracer study
# and the BLIS alumni profiling study" starter: drafts opened with
# "**The comparison concerns ... results.**" (bold-wrapped, so the anchor never
# saw "The"), "The question compares the **methodology** of ..." and "The two
# studies differ primarily in their **method** and **scope** ...". Each was
# flagged as an uncited claim, and when the repair call did not fix it the
# whole cited comparison was replaced by "I could not verify a direct answer".
_COMPARISON_FRAMING = re.compile(
    r'^(?:'
    r'(?:the|this)\s+comparison\b'
    r'|(?:the|this|your)\s+question\s+(?:compares|contrasts|concerns|asks\s+about)\b'
    r'|(?:the|these|both)\s+(?:two\s+)?(?:studies|theses|papers|projects)\s+'
    r'(?:are\s+compared|can\s+be\s+compared|are\s+contrasted|differ)\b'
    r')[^.!?\n]{0,220}[.!?]?$',
    re.IGNORECASE,
)
_EMPHASIS = re.compile(r'\*\*|__')
_COMPARATIVE_CLAIM = re.compile(
    r'\b(?:outperform\w*|better|worse|higher|lower|faster|slower|superior|inferior|'
    r'more\s+accurate|less\s+accurate|beats?|exceed\w*|surpass\w*)\b',
    re.IGNORECASE,
)


def _strip_markers(text: str) -> str:
    return _MARKER_RUN.sub('', text or '').strip()


def _has_figures(text: str) -> bool:
    return bool(re.search(r'\d', _YEAR_TOKEN.sub(' ', text or '')))


def is_archive_gap_statement(text: str) -> bool:
    """Whether a unit only states what the archive or retrieved evidence lacks."""
    plain = _strip_markers(_LIST_MARKER.sub('', (text or '').strip()))
    plain = _LEADING_ASPECT_LABEL.sub('', plain, count=1).strip()
    if not plain or '\n' in plain or re.search(r'[.!?]\s+\S', plain):
        return False
    if _has_figures(plain) or _GAP_CONTRAST.search(plain):
        return False
    clauses = [clause for clause in _CLAUSE_SPLIT.split(plain) if clause.strip(' ,')]
    if any(not _NEGATION_WORD.search(clause) for clause in clauses):
        return False
    return bool(_GAP_START.search(plain) and _GAP_NEGATION.search(plain))


def _is_comparison_framing(plain: str) -> bool:
    text = _EMPHASIS.sub('', _strip_markers(plain)).strip()
    return bool(
        _COMPARISON_FRAMING.fullmatch(text)
        and not _has_figures(text)
        and not _COMPARATIVE_CLAIM.search(text)
    )


def _label_tokens(text: str) -> list[str]:
    return re.findall(r'[a-z0-9]+', (text or '').lower())


def _matches_source_title(label: str, titles: tuple[str, ...]) -> bool:
    """Whether a bold label names one of the retrieved theses."""
    label_norm = ' '.join(_label_tokens(_YEAR_TOKEN.sub(' ', label)))
    if len(label_norm) < 3:
        return False
    for title in titles:
        title_norm = ' '.join(_label_tokens(title))
        if not title_norm:
            continue
        if label_norm == title_norm or title_norm.startswith(label_norm + ' '):
            return True
        if label_norm.startswith(title_norm):
            return True
    return False


def _is_bold_label(plain: str, titles: tuple[str, ...]) -> bool:
    """A standalone bold heading or thesis-title label, not a bolded claim."""
    match = _STANDALONE_BOLD_LABEL.fullmatch(plain)
    if not match:
        return False
    label = match.group('label').strip()
    if match.group('colon') or label.endswith(':'):
        return True
    if titles and _matches_source_title(label, titles):
        return True
    tokens = _label_tokens(label)
    if any(token in _CLAIM_VERBS for token in tokens):
        return False
    # Figures make a bold line a reported result ("98% accuracy"). Years are
    # allowed because a title label is often suffixed with one.
    if re.search(r'\d', _YEAR_TOKEN.sub(' ', label)):
        return False
    return len(tokens) <= 14


def _is_structural_unit(plain: str, titles: tuple[str, ...]) -> bool:
    """Units that organize or scope an answer without asserting a thesis finding."""
    # Standalone bold labels (such as `**General Objective**` or a thesis title
    # heading a nested bullet block) organize a cited answer without asserting
    # research findings themselves.
    if _BOLD_OBJECTIVE_LABEL.fullmatch(plain) or _is_bold_label(plain, titles):
        return True
    if _ENGLISH_LANGUAGE_NOTICE.fullmatch(plain):
        return True
    if _RETRIEVAL_SCOPE_CAVEAT.fullmatch(plain) and _ARCHIVE_SCOPE_WORD.search(plain):
        return True
    return is_archive_gap_statement(plain) or _is_comparison_framing(plain)


def _is_substantive(text: str, titles: tuple[str, ...] = ()) -> bool:
    """Whether a segment asserts a research claim that must carry a citation."""
    if not text or text.startswith('#'):
        return False
    plain = _LIST_MARKER.sub('', text).strip()
    if _is_structural_unit(plain, titles):
        return False
    # Short colon-ended lines immediately introducing a cited list are
    # headings/lead-ins, not standalone research claims.
    if plain.endswith(':') and len(plain) <= 120 and '\n' not in plain:
        return False
    return len(re.sub(r'\s+', ' ', plain)) >= 10


def _source_titles(sources: list[dict] | None) -> tuple[str, ...]:
    return tuple(dict.fromkeys(
        str(source.get('title')) for source in (sources or []) if source.get('title')
    ))


def _unit_segments(answer: str) -> list[tuple[int, int, str]]:
    """Every unit (substantive or not) as ``(start, end, stripped_text)``."""
    text = answer or ''
    segments: list[tuple[int, int, str]] = []
    cursor = 0
    separators = [
        (match.start(), match.end()) for match in _UNIT_SEPARATOR.finditer(text)
    ]
    for segment_end, next_start in [*separators, (len(text), len(text))]:
        raw = text[cursor:segment_end]
        stripped = raw.strip()
        if stripped:
            lead = len(raw) - len(raw.lstrip())
            segments.append((cursor + lead, cursor + lead + len(stripped), stripped))
        cursor = next_start
    return segments


def _substantive_spans(answer: str, titles: tuple[str, ...] = ()) -> list[tuple[int, int, str]]:
    """Locate each substantive unit as ``(start, end, text)`` within ``answer``.

    Positions, not just text, because two identical paragraphs or list items
    are two distinct units that both need a citation. The repair below used to
    patch by string match, so on a repeated unit ``str.replace`` found the
    already-patched first occurrence again: unit one ended up with a doubled
    marker and unit two stayed uncited. Validation then failed and an otherwise
    grounded answer was discarded for the generic fallback.
    """
    return [
        (start, end, stripped)
        for start, end, stripped in _unit_segments(answer)
        if _is_substantive(stripped, titles)
    ]


def _substantive_units(answer: str, titles: tuple[str, ...] = ()) -> list[str]:
    return [text for _start, _end, text in _substantive_spans(answer, titles)]


def strip_gap_statement_citations(answer: str) -> str:
    """Remove citation markers from units that only state what the archive lacks.

    A model told to cite every line will also cite "The archive does not
    contain a blockchain voting thesis [2]", presenting thesis 2 as the
    authority for an absence it never mentions. The marker is removed rather
    than the sentence, so the reader still sees the honest gap statement.
    """
    text = answer or ''
    for start, end, stripped in reversed(_unit_segments(text)):
        if _CITATION.search(stripped) and is_archive_gap_statement(stripped):
            cleaned = _MARKER_RUN.sub('', stripped)
            cleaned = re.sub(r'\s+([.!?])$', r'\1', cleaned).rstrip()
            text = f'{text[:start]}{cleaned}{text[end:]}'
    return text


def enforce_citation_coverage(answer: str, sources: list[dict]) -> str:
    """Deterministically repair marker range and substantive-unit coverage.

    This runs only after the bounded AI repair attempt, as the last rung before
    the grounded fallback.

    It used to map every out-of-range marker AND every uncited substantive unit
    onto `allowed[0]` whatever the context held, and call that "structural".
    That is sound only while every block on the table comes from the SAME
    thesis. Once the context spans several theses -- the ordinary grounded path
    selects up to five chunks across as many papers -- nothing about the answer
    says an uncited claim came from paper 1 rather than paper 3, or from nowhere
    at all. `validate_citations` then passed, and the reader was shown one
    specific thesis as the authority for a sentence the model never attributed
    to it. In a library whose product is the citation that is the most damaging
    thing this file could do, and it was invisible: the answer looked better
    cited afterwards, not worse. Audited 2026-09-12.

    So the repair is now gated on the PAPER, not on the marker count. When every
    source is a chunk of one thesis the assignment is forced rather than
    guessed: the citation a reader actually sees is the thesis, the whole draft
    was generated from that thesis, and choosing between its chunks cannot
    misattribute it. That keeps the overview and exact-paper paths repairable,
    which is where a model dropping its own markers is both common and harmless.
    Across several theses the answer is left as the model wrote it, fails
    validation, and the caller serves the grounded retrieval fallback: a visibly
    hedged answer instead of a confidently misattributed one.
    """
    allowed = sorted({
        source_citation_id(source, position)
        for position, source in enumerate(sources, start=1)
    })
    if not allowed:
        return answer or ''
    repaired = normalize_citation_markers(answer)
    paper_ids = {source.get('id') for source in sources}
    # A single, identified thesis. An unidentified source is not treated as
    # "the same paper" as another unidentified one -- with nothing to compare,
    # the safe reading is that they may differ.
    if len(paper_ids) != 1 or not next(iter(paper_ids)):
        return repaired
    fallback = allowed[0]
    repaired = _CITATION.sub(
        lambda match: match.group(0) if int(match.group(1)) in allowed else f'[{fallback}]',
        repaired,
    )
    # Patch back-to-front so each insertion leaves the earlier offsets valid.
    for _start, end, unit in reversed(_substantive_spans(repaired, _source_titles(sources))):
        if not cited_ids(unit):
            repaired = f'{repaired[:end]} [{fallback}]{repaired[end:]}'
    return repaired


def prune_uncited_units(answer: str, sources: list[dict]) -> str:
    """Remove substantive units that carry no valid citation; keep the cited rest.

    The last rung before the grounded fallback, after the AI repair and
    `enforce_citation_coverage` have both failed. Unlike that function it never
    INVENTS an attribution: an uncited sentence is dropped, not assigned to a
    thesis, so everything left is exactly what the model itself cited. Measured
    2026-11-25: multi-thesis comparisons arrived as fully cited per-thesis
    bullets plus one uncited opening or closing summary, and the fallback threw
    the cited bullets away with it. Returns '' when no cited unit would remain,
    so the caller still falls back rather than serving an empty answer.
    """
    allowed = {
        source_citation_id(source, position)
        for position, source in enumerate(sources, start=1)
    }
    text = answer or ''
    kept_cited = False
    for start, end, unit in reversed(_substantive_spans(text, _source_titles(sources))):
        unit_ids = cited_ids(unit)
        if unit_ids and unit_ids.issubset(allowed):
            kept_cited = True
            continue
        text = f'{text[:start]}{text[end:]}'
    if not kept_cited:
        return ''
    text = re.sub(r'[ \t]+\n', '\n', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def uncited_units(answer: str, sources: list[dict]) -> list[tuple[int, str]]:
    """Return `(unit_index, text)` pairs for substantive units missing valid citations."""
    allowed = {
        source_citation_id(source, position)
        for position, source in enumerate(sources, start=1)
    }
    missing: list[tuple[int, str]] = []
    for index, unit in enumerate(_substantive_units(answer, _source_titles(sources)), start=1):
        unit_ids = cited_ids(unit)
        if not unit_ids or not unit_ids.issubset(allowed):
            missing.append((index, unit))
    return missing


def validate_citations(answer: str, sources: list[dict]) -> tuple[bool, list[str]]:
    """Validate marker range and coverage; this is not semantic entailment."""
    allowed = {
        source_citation_id(source, position)
        for position, source in enumerate(sources, start=1)
    }
    used = cited_ids(answer)
    errors = []
    if _GROUPED_CITATION.search(answer or ''):
        errors.append('grouped citation markers are not allowed')
    invalid = sorted(used - allowed)
    if invalid:
        errors.append(f'out-of-range citations: {invalid}')
    for index, unit in enumerate(_substantive_units(answer, _source_titles(sources)), start=1):
        unit_ids = cited_ids(unit)
        if not unit_ids or not unit_ids.issubset(allowed):
            errors.append(f'uncited substantive unit {index}')
    if sources and not used:
        errors.append('answer contains no citations')
    return not errors, errors
