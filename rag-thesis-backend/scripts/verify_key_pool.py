"""Check that every configured Gemini key in the pool actually works.

`services/gemini_pool.py` falls through to reserve keys when the primary reports
exhaustion. Its rotation logic is unit-tested against fakes, but that says
nothing about whether the keys in `.env` are real: a truncated paste, a revoked
key, or a key from a project without the Generative Language API enabled all
look identical until the moment the primary runs out — which, in practice, is
during a demo.

This makes one minimal call per key and reports each independently. It is
deliberately not a load test: exhausting a key to observe rotation costs real
quota and proves less than confirming every key answers at all.

    python -m scripts.verify_key_pool
    python -m scripts.verify_key_pool --output evidence.json

Exit code is 0 only when every configured key answered. Keys are never printed;
only a masked fingerprint appears in output and evidence.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from services.chat_notices import is_capacity_error

PROMPT = 'Reply with the single word: ready'


def masked(api_key: str) -> str:
    """A stable fingerprint that identifies a key without revealing it."""
    return f'{api_key[:6]}...{api_key[-4:]}' if len(api_key) > 12 else '<too short>'


def classify(error: BaseException) -> str:
    """Name the failure in the terms the operator has to act on."""
    if is_capacity_error(error):
        return 'quota_exhausted'
    text = str(error).lower()
    if 'api key not valid' in text or 'api_key_invalid' in text or 'unauthenticated' in text:
        return 'invalid_key'
    if 'permission' in text or 'has not been used' in text or 'is disabled' in text:
        return 'api_not_enabled'
    return type(error).__name__


def check(api_key: str) -> dict:
    client = ChatGoogleGenerativeAI(
        model=settings.gemini_chat_model,
        google_api_key=api_key,
        timeout=settings.gemini_timeout_seconds,
        max_retries=0,
        max_output_tokens=8,
    )
    started = time.perf_counter()
    try:
        client.invoke(PROMPT)
    except Exception as error:  # pylint: disable=broad-exception-caught
        return {
            'key': masked(api_key),
            'ok': False,
            'failure': classify(error),
            'latency_ms': round((time.perf_counter() - started) * 1000, 2),
        }
    return {
        'key': masked(api_key),
        'ok': True,
        'failure': None,
        'latency_ms': round((time.perf_counter() - started) * 1000, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--output', type=Path, help='write privacy-safe JSON evidence here')
    args = parser.parse_args()

    primary = settings.gemini_api_key.strip()
    if not primary:
        print('GEMINI_API_KEY is not set; nothing to check.')
        return 1
    reserves = settings.gemini_reserve_key_list

    print(f'Checking {1 + len(reserves)} key(s) against {settings.gemini_chat_model}\n')
    results = [{'role': 'primary', **check(primary)}]
    for index, key in enumerate(reserves, start=1):
        results.append({'role': f'reserve-{index}', **check(key)})

    for row in results:
        status = 'ok' if row['ok'] else f"FAILED ({row['failure']})"
        print(f"  {row['role']:11s} {row['key']:16s} {row['latency_ms']:>9.2f} ms   {status}")

    working = sum(1 for row in results if row['ok'])
    print(f'\n{working}/{len(results)} key(s) answered.')
    if working < len(results):
        print('A failing key is dead weight in the pool: rotation will spend a round '
              'trip on it before moving on. Fix or remove it.')
    elif len(results) > 1:
        print('Every key answers. Note that separate quota requires separate Google '
              'projects; keys sharing one project also share its limit.')

    if args.output:
        args.output.write_text(json.dumps({
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'chat_model': settings.gemini_chat_model,
            'pool_size': len(results),
            'working': working,
            'results': results,
        }, indent=2), encoding='utf-8')
        print(f'Wrote {args.output}')

    return 0 if working == len(results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
