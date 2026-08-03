"""Normalization for text returned by the Gemini chat models.

Shared so the three call sites cannot drift apart: `routers/chat.py` and
`routers/duplication.py` each had a correct private copy, while
`routers/upload.py` hand-rolled a fragile variant of both.
"""

import re

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
