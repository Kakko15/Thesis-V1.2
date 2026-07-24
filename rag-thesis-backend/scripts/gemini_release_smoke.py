"""Minimal live Gemini release smoke with privacy-safe JSON evidence."""

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings

from config import settings


def timed_call(callable_):
    started = time.perf_counter()
    result = callable_()
    return result, round((time.perf_counter() - started) * 1000, 2)


def text_present(message) -> bool:
    content = getattr(message, 'content', '')
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        return any(
            isinstance(block, dict) and bool(str(block.get('text', '')).strip())
            for block in content
        )
    return False


def reported_model(message, fallback: str) -> str:
    metadata = getattr(message, 'response_metadata', {}) or {}
    return str(metadata.get('model_name') or metadata.get('model') or fallback)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()

    chat = ChatGoogleGenerativeAI(
        model=settings.gemini_chat_model,
        google_api_key=settings.gemini_api_key,
        timeout=settings.gemini_timeout_seconds,
        max_retries=settings.gemini_max_retries,
        # Gemini 3 thinking tokens share the output allowance. A 32-token cap
        # can exhaust the budget before any visible text is emitted.
        max_output_tokens=256,
        temperature=0,
        thinking_level=settings.gemini_thinking_level,
    )
    verdict = ChatGoogleGenerativeAI(
        model=settings.gemini_verdict_model,
        google_api_key=settings.gemini_api_key,
        timeout=settings.gemini_timeout_seconds,
        max_retries=settings.gemini_max_retries,
        max_output_tokens=64,
        temperature=0,
        thinking_level='minimal',
    )
    embeddings = GoogleGenerativeAIEmbeddings(
        model=settings.gemini_embed_model,
        google_api_key=settings.gemini_api_key,
        output_dimensionality=settings.embedding_dimensions,
    )

    chat_result, chat_ms = timed_call(
        lambda: chat.invoke('Synthetic release check. Reply only with SMOKE_OK.')
    )
    verdict_result, verdict_ms = timed_call(
        lambda: verdict.invoke('Synthetic release check. Reply only with PASS.')
    )
    vector, embedding_ms = timed_call(
        lambda: embeddings.embed_query('Synthetic ISU thesis-library release verification.')
    )

    finite_vector = bool(vector) and all(math.isfinite(value) for value in vector)
    checks = {
        'chat_nonempty': text_present(chat_result),
        'verdict_nonempty': text_present(verdict_result),
        'embedding_dimension': len(vector) == settings.embedding_dimensions,
        'embedding_finite': finite_vector,
    }
    report = {
        'schema_version': 1,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'profile': 'live-gemini-release-smoke',
        'privacy': {
            'synthetic_input_only': True,
            'response_content_preserved': False,
            'credential_material_preserved': False,
        },
        'configuration': {
            'chat_model': settings.gemini_chat_model,
            'verdict_model': settings.gemini_verdict_model,
            'embedding_model': settings.gemini_embed_model,
            'embedding_dimensions': settings.embedding_dimensions,
            'chat_thinking_level': settings.gemini_thinking_level,
        },
        'observed': {
            'chat_model': reported_model(chat_result, settings.gemini_chat_model),
            'verdict_model': reported_model(verdict_result, settings.gemini_verdict_model),
            'embedding_dimensions': len(vector),
            'latency_ms': {
                'chat': chat_ms,
                'verdict': verdict_ms,
                'embedding': embedding_ms,
            },
        },
        'checks': checks,
        'result': 'PASS' if all(checks.values()) else 'FAIL',
    }
    payload = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + '\n', encoding='utf-8')
    print(payload)
    return 0 if report['result'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
