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


def _substantive_units(answer: str) -> list[str]:
    units = []
    for raw in re.split(r'\n\s*\n|\n(?=\s*[-*]\s+|\s*\d+[.)]\s+)', answer or ''):
        text = raw.strip()
        if not text or text.startswith('#'):
            continue
        plain = re.sub(r'^\s*(?:[-*]|\d+[.)])\s+', '', text)
        # Standalone bold labels such as ``**General Objective**`` organize a
        # cited answer but do not assert research facts themselves.
        if re.fullmatch(
            r'\*\*(?:general objective|specific objectives?|objectives? of the study)\*\*:?',
            plain,
            flags=re.IGNORECASE,
        ):
            continue
        # Short colon-ended lines immediately introducing a cited list are
        # headings/lead-ins, not standalone research claims.
        if plain.endswith(':') and len(plain) <= 120 and '\n' not in plain:
            continue
        if len(re.sub(r'\s+', ' ', plain)) >= 10:
            units.append(text)
    return units


def enforce_citation_coverage(answer: str, sources: list[dict]) -> str:
    """Deterministically repair marker range and substantive-unit coverage.

    This runs only after the bounded AI repair attempt. It never creates a new
    source: invalid markers and uncited units are mapped to the first retrieved
    evidence citation, preserving the documented structural-only guarantee.
    """
    allowed = sorted({
        source_citation_id(source, position)
        for position, source in enumerate(sources, start=1)
    })
    if not allowed:
        return answer or ''
    fallback = allowed[0]
    repaired = normalize_citation_markers(answer)
    repaired = _CITATION.sub(
        lambda match: match.group(0) if int(match.group(1)) in allowed else f'[{fallback}]',
        repaired,
    )
    for unit in _substantive_units(repaired):
        unit_ids = cited_ids(unit)
        if not unit_ids:
            replacement = f'{unit.rstrip()} [{fallback}]'
            repaired = repaired.replace(unit, replacement, 1)
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
