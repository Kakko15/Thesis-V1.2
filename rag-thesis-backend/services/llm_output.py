"""Normalization for text returned by the Gemini chat models.

Shared so the three call sites cannot drift apart: `routers/chat.py` and
`routers/duplication.py` each had a correct private copy, while
`routers/upload.py` hand-rolled a fragile variant of both.
"""

import re

# The two providers name the same event differently and in different case: the
# Gemini SDK reports `MAX_TOKENS`, an OpenAI-compatible gateway reports
# `length`. Both mean the reply stopped at the output-token ceiling rather than
# because the model finished, so both are compared casefolded.
_TRUNCATION_FINISH_REASONS = frozenset({'max_tokens', 'length'})


class TruncatedGeneration(RuntimeError):
    """A model reply stopped at the output-token ceiling instead of finishing."""


def finish_reason(result) -> str:
    """The provider's own stop reason, casefolded. Empty when it reports none.

    Never raises. `response_metadata` is absent entirely on a bare string
    result, nothing constrains a provider to put a mapping there, and an
    unreadable stop reason must read as "not truncated" rather than fail a
    question that the model may well have answered perfectly well.
    """
    metadata = getattr(result, 'response_metadata', None)
    if not isinstance(metadata, dict):
        return ''
    return str(metadata.get('finish_reason') or '').strip().lower()


def is_truncated(result) -> bool:
    """Whether generation was cut off at the ceiling rather than completing.

    This is the only signal that distinguishes a short answer from a severed
    one. Without it a fragment reaches citation validation, which sees missing
    markers, "repairs" them, and serves the fragment as finished work.
    """
    return finish_reason(result) in _TRUNCATION_FINISH_REASONS


# A model asked for raw JSON still fences or labels it periodically. Anchored at
# the ends so a fence inside the payload is left alone.
_FENCE_OPEN = re.compile(r'\A\s*```[ \t]*(?:json)?[ \t]*\r?\n?', re.IGNORECASE)
_FENCE_CLOSE = re.compile(r'\r?\n?[ \t]*```\s*\Z')
# An unfenced `json` label, but only where a JSON value actually follows, so
# ordinary prose beginning with those letters is untouched.
_BARE_LABEL = re.compile(r'\A\s*json\b[ \t]*(?=[\r\n{\[])', re.IGNORECASE)


def coerce_text(result) -> str:
    """Flatten a chat result into text, joining multi-part content blocks.

    `result.content` from a Gemini chat model may be a list of content blocks,
    in which case calling `.strip()` on it raises AttributeError.
    """
    content = result.content if hasattr(result, 'content') else str(result)
    if isinstance(content, list):
        return ''.join(
            block.get('text', '') if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


def strip_code_fence(text: str) -> str:
    """Remove a surrounding markdown code fence or `json` label before parsing.

    Replaces `text.strip().lstrip('`').lstrip('json').rstrip('`')`, which was
    not prefix removal at all: `str.lstrip('json')` strips *any* leading run of
    the characters j, o, s and n, so text beginning with one of them lost real
    characters. Both wrappings the old chain handled are still handled here.
    """
    cleaned = (text or '').strip()
    cleaned = _FENCE_OPEN.sub('', cleaned)
    cleaned = _FENCE_CLOSE.sub('', cleaned)
    cleaned = _BARE_LABEL.sub('', cleaned)
    return cleaned.strip()
