"""Deterministic question-type classification for the grounded chat path.

One question shape was structurally unanswerable before this existed: a
corpus-wide question ("which technique is most commonly used?") retrieved the
five chunks nearest to its wording, which usually meant one or two theses, and
the model then had to either refuse or overreach. Classifying the question lets
retrieval sample distinct theses for aggregates (per-paper cap 1) and lets the
prompt carry a task block matched to the shape of the ask.

Regex and precedence only -- no model call, no fuzzy scoring -- so the
classification is reproducible and testable the way the guards are. Precedence
matters: an aggregate question almost always contains enumeration wording
("which theses use..."), so AGGREGATE is checked first; FACTUAL is checked last
because its patterns are the narrowest. Anything unmatched is DEFAULT, which
adds nothing to the prompt and keeps the pipeline exactly as before.
"""
import re

AGGREGATE = 'aggregate'
COMPARISON = 'comparison'
ENUMERATION = 'enumeration'
FACTUAL = 'factual'
DEFAULT = 'default'

_AGGREGATE = re.compile(
    r'\b(?:most\s+(?:common(?:ly)?(?:\s+used)?|used|frequent(?:ly)?|popular)'
    r'|across\s+(?:all\s+)?(?:the\s+)?(?:theses|papers|studies|archive)'
    r'|majority\s+of|what\s+percentage|how\s+often|dominant|prevailing'
    r'|overall\s+trend|trends?\s+in)\b',
    re.IGNORECASE,
)
_COMPARISON = re.compile(
    r'\b(?:compare[ds]?|comparison|versus|vs\.?'
    r'|difference[s]?(?:\s+between)?|differ(?:s|ed)?'
    r'|similarit(?:y|ies)\s+(?:between|of|with)|contrast)\b',
    re.IGNORECASE,
)
_ENUMERATION = re.compile(
    r'\b(?:list|enumerate|name\s+(?:all|the|some)'
    r'|what\s+(?:are|were)\s+(?:the|all)\b'
    r'|which\s+(?:theses|papers|studies))\b',
    re.IGNORECASE,
)
_FACTUAL = re.compile(
    r'\b(?:what\s+year|when\s+was|who\s+(?:wrote|authored|conducted)'
    r'|what\s+(?:dataset|accuracy|metric|sample\s+size)'
    r'|what\s+(?:model|algorithm|tool|framework)\s+(?:did|was|does|do)'
    r'|how\s+(?:accurate|large'
    r'|many\s+(?:respondents|participants|images|samples|records)))\b',
    re.IGNORECASE,
)


def classify_question(question: str) -> str:
    """One of AGGREGATE, COMPARISON, ENUMERATION, FACTUAL or DEFAULT."""
    normalized = re.sub(r'\s+', ' ', question or '').strip()
    if not normalized:
        return DEFAULT
    if _AGGREGATE.search(normalized):
        return AGGREGATE
    if _COMPARISON.search(normalized):
        return COMPARISON
    if _ENUMERATION.search(normalized):
        return ENUMERATION
    if _FACTUAL.search(normalized):
        return FACTUAL
    return DEFAULT
