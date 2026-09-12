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


def _is_substantive(text: str) -> bool:
    """Whether a segment asserts a research claim that must carry a citation."""
    if not text or text.startswith('#'):
        return False
    plain = _LIST_MARKER.sub('', text)
    # Standalone bold labels such as ``**General Objective**`` organize a
    # cited answer but do not assert research facts themselves.
    if _BOLD_OBJECTIVE_LABEL.fullmatch(plain):
        return False
    # Short colon-ended lines immediately introducing a cited list are
    # headings/lead-ins, not standalone research claims.
    if plain.endswith(':') and len(plain) <= 120 and '\n' not in plain:
        return False
    return len(re.sub(r'\s+', ' ', plain)) >= 10


def _substantive_spans(answer: str) -> list[tuple[int, int, str]]:
    """Locate each substantive unit as ``(start, end, text)`` within ``answer``.

    Positions, not just text, because two identical paragraphs or list items
    are two distinct units that both need a citation. The repair below used to
    patch by string match, so on a repeated unit ``str.replace`` found the
    already-patched first occurrence again: unit one ended up with a doubled
    marker and unit two stayed uncited. Validation then failed and an otherwise
    grounded answer was discarded for the generic fallback.
    """
    text = answer or ''
    spans: list[tuple[int, int, str]] = []
    cursor = 0
    separators = [
        (match.start(), match.end()) for match in _UNIT_SEPARATOR.finditer(text)
    ]
    for segment_end, next_start in [*separators, (len(text), len(text))]:
        raw = text[cursor:segment_end]
        stripped = raw.strip()
        if _is_substantive(stripped):
            lead = len(raw) - len(raw.lstrip())
            spans.append((cursor + lead, cursor + lead + len(stripped), stripped))
        cursor = next_start
    return spans


def _substantive_units(answer: str) -> list[str]:
    return [text for _start, _end, text in _substantive_spans(answer)]


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
    for _start, end, unit in reversed(_substantive_spans(repaired)):
        if not cited_ids(unit):
            repaired = f'{repaired[:end]} [{fallback}]{repaired[end:]}'
    return repaired


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
    for index, unit in enumerate(_substantive_units(answer), start=1):
        unit_ids = cited_ids(unit)
        if not unit_ids or not unit_ids.issubset(allowed):
            errors.append(f'uncited substantive unit {index}')
    if sources and not used:
        errors.append('answer contains no citations')
    return not errors, errors
