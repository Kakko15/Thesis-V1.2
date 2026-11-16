"""Live check that the Groq fallback key and model answer. Prints no secrets."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import settings  # noqa: E402
from services import gemini_pool  # noqa: E402


def main() -> int:
    if not gemini_pool.groq_enabled():
        print('GROQ_API_KEY is not set')
        return 1
    print(f'Model: {settings.groq_model}')
    client = gemini_pool._groq_client()  # pylint: disable=protected-access
    started = time.perf_counter()
    try:
        reply = client.invoke('Reply with exactly: OK')
    except Exception as error:  # pylint: disable=broad-exception-caught
        print(f'FAILED: {type(error).__name__}: {str(error)[:300]}')
        return 1
    elapsed = (time.perf_counter() - started) * 1000
    print(f'ok  {elapsed:.0f} ms  reply={str(reply.content)[:60]!r}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
