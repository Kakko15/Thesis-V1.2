"""Meaning-based capsule extraction with strict source-grounding checks."""

from __future__ import annotations

import json
import logging
import re

from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from services import gemini_pool, prompts
from services.capsule import CAPSULE_SECTIONS, clean_text
from services.capsule_extract import FIELD_LIMITS
from services.llm_output import coerce_text, strip_code_fence

logger = logging.getLogger(__name__)

_FIELDS = tuple(key for key, _label in CAPSULE_SECTIONS)
_SPACE = re.compile(r'\s+')
_COMPARISON_TRANSLATION = str.maketrans({
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
    '\u2013': '-', '\u2014': '-', '\ufffd': "'",
})


def _comparison_text(value: str) -> str:
    return _SPACE.sub(' ', value.translate(_COMPARISON_TRANSLATION)).strip().casefold()


def source_supported_lines(value: object, source_text: str, limit: int) -> str:
    """Keep only model-selected lines that occur verbatim in the uploaded text."""
    if not isinstance(value, str):
        return ''
    source = _comparison_text(source_text)
    accepted = []
    for raw_line in value.splitlines():
        line = clean_text(raw_line)
        if line and _comparison_text(line) in source:
            accepted.append(line)
    return '\n'.join(accepted)[:limit].rstrip()


def grounded_capsule_payload(payload: object, source_text: str) -> dict[str, str]:
    """Validate the model's exact shape and discard every unsupported sentence."""
    if not isinstance(payload, dict) or set(payload) != set(_FIELDS):
        return {key: '' for key in _FIELDS}
    grounded: dict[str, str] = {}
    used: set[str] = set()
    for key in _FIELDS:
        supported = source_supported_lines(payload.get(key), source_text, FIELD_LIMITS[key])
        unique_lines = []
        for line in supported.splitlines():
            normalized = _comparison_text(line)
            if normalized and normalized not in used:
                used.add(normalized)
                unique_lines.append(line)
        grounded[key] = '\n'.join(unique_lines)
    return grounded


def _llm() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=settings.gemini_chat_model,
        google_api_key=settings.gemini_api_key,
        timeout=settings.gemini_timeout_seconds,
        max_retries=settings.gemini_max_retries,
        max_output_tokens=settings.gemini_max_output_tokens,
    )


async def analyze_capsule(text: str, fallback: dict) -> dict:
    """Analyze the whole capsule once; retain deterministic fields on any failure."""
    local = {key: str(fallback.get(key) or '') for key in _FIELDS}
    try:
        prompt = prompts.capsule_semantic_extraction_prompt(text)
        result = await gemini_pool.arun(
            _llm(), gemini_pool.EXTRACT, lambda client: client.ainvoke(prompt),
        )
        payload = json.loads(strip_code_fence(coerce_text(result)))
        semantic = grounded_capsule_payload(payload, text)
        accepted = [key for key in _FIELDS if semantic[key]]
        if not accepted:
            return {**fallback, 'extraction_method': 'headings'}
        merged = {key: semantic[key] or local[key] for key in _FIELDS}
        return {
            **merged,
            'detected_sections': [key for key in _FIELDS if merged[key]],
            'extraction_method': 'semantic',
        }
    except Exception as error:  # a local extraction remains useful during provider outages
        logger.warning('Semantic capsule extraction unavailable (%s)', type(error).__name__)
        return {**fallback, 'extraction_method': 'headings'}
