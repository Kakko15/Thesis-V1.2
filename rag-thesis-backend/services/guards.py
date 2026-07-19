"""Deterministic request controls for the retrieval-only thesis assistant."""

import re


REFUSAL_MESSAGE = (
    'I can help you discover, compare, summarize, and cite existing archived studies, '
    'but I cannot write thesis chapters, assignments, proposals, hypotheses, or original '
    'academic arguments for you. Ask me what the archive contains about your topic instead.'
)

_GENERATION_VERBS = re.compile(
    r'\b(write|draft|compose|generate|create|produce|complete|make)\b', re.IGNORECASE
)
_PROHIBITED_ARTIFACTS = re.compile(
    r'\b(my\s+)?(thesis|chapter|rrl|review of related literature|methodology|conclusion|'
    r'hypothesis|research proposal|problem statement|conceptual framework|assignment|essay|'
    r'academic argument)\b',
    re.IGNORECASE,
)
_INJECTION = re.compile(
    r'\b(ignore|disregard|override) (all |any )?(previous|prior|system) instructions?|'
    r'\b(reveal|show|print) (me )?(the )?(system )?(prompt|instructions?)|'
    r'\bbypass (the )?(rules?|restrictions?|guardrails?)|\bact as (a|an)|'
    r'\bpretend (to be|you are)|\bchange your role|\bdeveloper mode|\bjailbreak\b',
    re.IGNORECASE,
)
_FOLLOWUP_REFERENCE = re.compile(
    r'\b(it|its|they|them|their|this|that|these|those|former|latter|above|same)\b', re.IGNORECASE
)
_FOLLOWUP_START = re.compile(
    r'^\s*(and\s+)?(what|how|why|when|where|who)\s+(about|else|was|were|did|does|is|are)\b',
    re.IGNORECASE,
)


def prohibited_reason(text: str) -> str | None:
    """Return a stable block category, or None for allowed retrieval requests."""
    normalized = re.sub(r'\s+', ' ', text or '').strip()
    if _INJECTION.search(normalized):
        return 'prompt_injection'
    if _GENERATION_VERBS.search(normalized) and _PROHIBITED_ARTIFACTS.search(normalized):
        return 'academic_content_generation'
    return None


def is_ambiguous_followup(question: str, prior_questions: list[str]) -> bool:
    """Identify questions that need prior conversational references resolved."""
    if not prior_questions:
        return False
    normalized = re.sub(r'\s+', ' ', question or '').strip()
    if not normalized:
        return False
    return bool(
        _FOLLOWUP_REFERENCE.search(normalized)
        or _FOLLOWUP_START.search(normalized)
        or (len(normalized.split()) <= 5 and normalized.endswith('?'))
    )


def fallback_standalone_question(question: str, prior_questions: list[str]) -> str:
    """Deterministic fallback when the optional rewrite call is unavailable."""
    previous = prior_questions[-1] if prior_questions else ''
    combined = f'Previous research question: {previous}\nFollow-up: {question}'.strip()
    return combined[:4000]
