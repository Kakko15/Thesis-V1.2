"""Deterministic request controls for the retrieval-only thesis assistant."""

import re


REFUSAL_MESSAGE = (
    'I can help you discover, compare, summarize, and cite existing archived studies, '
    'but I cannot write thesis chapters, assignments, proposals, hypotheses, or original '
    'academic arguments for you. Ask me what the archive contains about your topic instead.'
)

_GENERATION_VERB = r'(?:write|draft|compose|generate|create|produce|complete|make)'
# Artifacts this system must never author on a user's behalf.
_ARTIFACT = (
    r'(?:thesis|chapters?|rrl|review\s+of\s+related\s+literature|methodolog(?:y|ies)|'
    r'conclusions?|hypothes(?:is|es)|research\s+proposals?|problem\s+statements?|'
    r'conceptual\s+frameworks?|assignments?|essays?|academic\s+arguments?)'
)
# Determiners, quantifiers, and adjectives that legitimately sit between the
# verb and the artifact in a real request ("write me a full chapter"). This is
# deliberately a closed list: matching arbitrary words between the two is what
# made the previous rule fire on ordinary retrieval questions.
_MODIFIER = (
    r'(?:me|us|my|our|the|a|an|another|this|that|these|those|some|one|two|three|'
    r'new|original|full|entire|whole|complete|final|sample|draft|brief|short|'
    r'detailed|good|proper|\d+)'
)

# The verb must actually govern the artifact. "write a chapter" qualifies;
# "...used to create the system" alongside the word "methodology" does not.
_VERB_GOVERNS_ARTIFACT = re.compile(
    rf'\b{_GENERATION_VERB}\s+(?:{_MODIFIER}\s+){{0,3}}{_ARTIFACT}\b',
    re.IGNORECASE,
)
# The artifact is claimed as the requester's own work ("my thesis chapter").
_OWNED_ARTIFACT = re.compile(
    rf'\b(?:my|our)\s+(?:{_MODIFIER}\s+){{0,2}}{_ARTIFACT}\b',
    re.IGNORECASE,
)
# A generation verb aimed at the requester's own artifact, even loosely phrased
# ("write about my thesis", "draft something for our chapter"). Requiring the
# possessive keeps this off questions about what archived authors wrote.
_GENERATE_OWNED_ARTIFACT = re.compile(
    rf'\b{_GENERATION_VERB}\b(?:\s+\S+){{0,4}}?\s+(?:my|our)\s+'
    rf'(?:{_MODIFIER}\s+){{0,2}}{_ARTIFACT}\b',
    re.IGNORECASE,
)
# The sentence asks *this assistant* to produce something, rather than asking
# what the archived studies did.
_DIRECTED_AT_ASSISTANT = re.compile(
    # Imperative, at the start of the message or of a later sentence.
    rf'(?:^|[.!?;]\s+)(?:(?:please|kindly|pls|now|just|first)\s+)*{_GENERATION_VERB}\b'
    # Second-person request.
    r'|\b(?:can|could|would|will|shall|should)\s+(?:you|u)\b'
    r'|\byou\s+(?:should|must|will|can|need\s+to|have\s+to)\b'
    # First-person demand.
    r'|\bi\s+(?:want|need|would\s+like)\b'
    r'|\bhelp\s+(?:me|us)\b'
    r'|\bfor\s+(?:me|us)\b'
    r'|\bon\s+(?:my|our)\s+behalf\b',
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


def _is_generation_request(normalized: str) -> bool:
    """True only when a generation verb governs a prohibited artifact *and* the
    sentence asks this assistant to produce it.

    Two independent searches — "contains a generation verb" and "contains a
    prohibited artifact" — refused ordinary retrieval questions, because the
    verb and the artifact never had to be related to each other. "What
    conclusion did the authors make about accuracy?" was blocked. Requiring
    the verb to govern the artifact, and the request to be addressed to the
    assistant, keeps the refusal contract while allowing those questions.
    Rule 6 of the grounded prompt still refuses anything this misses.
    """
    if _GENERATE_OWNED_ARTIFACT.search(normalized):
        return True
    if not _VERB_GOVERNS_ARTIFACT.search(normalized):
        return False
    return bool(
        _DIRECTED_AT_ASSISTANT.search(normalized)
        or _OWNED_ARTIFACT.search(normalized)
    )


def prohibited_reason(text: str) -> str | None:
    """Return a stable block category, or None for allowed retrieval requests."""
    normalized = re.sub(r'\s+', ' ', text or '').strip()
    if _INJECTION.search(normalized):
        return 'prompt_injection'
    if _is_generation_request(normalized):
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
