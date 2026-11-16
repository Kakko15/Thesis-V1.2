"""Check every configured key (Gemini pool + Groq pool, plus embeddings). Masks keys."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings  # noqa: E402

from config import settings  # noqa: E402
from services import gemini_pool  # noqa: E402


def mask(key: str) -> str:
    return f'{key[:6]}...{key[-4:]}'


def timed(label, key, call):
    started = time.perf_counter()
    try:
        call()
        status = 'ok'
    except Exception as exc:  # pylint: disable=broad-exception-caught
        text = str(exc)
        status = ('RATE-LIMITED (429)' if '429' in text or 'RESOURCE_EXHAUSTED' in text
                  else f'FAILED {type(exc).__name__}: {text[:90]}')
    print(f'  {label:<10} {mask(key):<16} {(time.perf_counter() - started) * 1000:>6.0f} ms  {status}')
    return status == 'ok'


def main() -> int:
    good = total = 0
    gemini_keys = [settings.gemini_api_key, *settings.gemini_reserve_key_list]
    print(f'Gemini chat ({settings.gemini_chat_model}):')
    for i, key in enumerate(gemini_keys):
        client = ChatGoogleGenerativeAI(model=settings.gemini_chat_model, google_api_key=key,
                                        max_retries=0, timeout=30, max_output_tokens=50)
        total += 1
        good += timed('primary' if i == 0 else f'reserve-{i}', key, lambda c=client: c.invoke('Say OK'))
        time.sleep(1)
    print(f'Gemini verdict ({settings.gemini_verdict_model}) on primary:')
    client = ChatGoogleGenerativeAI(model=settings.gemini_verdict_model, google_api_key=gemini_keys[0],
                                    max_retries=0, timeout=30, max_output_tokens=50)
    total += 1
    good += timed('verdict', gemini_keys[0], lambda: client.invoke('Say OK'))
    print(f'Gemini embeddings ({settings.gemini_embed_model}, {settings.embedding_dimensions}d):')
    for i, key in enumerate(gemini_keys):
        emb = GoogleGenerativeAIEmbeddings(model=settings.gemini_embed_model, google_api_key=key,
                                           output_dimensionality=settings.embedding_dimensions)
        total += 1
        good += timed('primary' if i == 0 else f'reserve-{i}', key,
                      lambda e=emb: len(e.embed_query('test')) == settings.embedding_dimensions or 1 / 0)
        time.sleep(1)
    print(f'Groq ({settings.groq_model}):')
    for i, key in enumerate(settings.groq_key_list):
        client = gemini_pool._groq_client(key)  # pylint: disable=protected-access
        total += 1
        good += timed('groq-' + str(i + 1), key, lambda c=client: c.invoke('Say OK'))
    print(f'\n{good}/{total} checks passed')
    return 0 if good == total else 1


if __name__ == '__main__':
    raise SystemExit(main())
