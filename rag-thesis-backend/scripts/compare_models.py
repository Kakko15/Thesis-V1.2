"""Compare Gemini and Groq on speed and grounded-answer accuracy.

Uses synthetic passages only (no private documents are sent to free-tier keys).
Each question is answered from a context block with a [n] citation instruction.
Scoring is automatic: required keywords present, forbidden claims absent, and
for unanswerable questions the model must say the context does not contain it.
"""
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langchain_google_genai import ChatGoogleGenerativeAI  # noqa: E402

from config import settings  # noqa: E402
from services import gemini_pool  # noqa: E402

CONTEXT = """[1] The Kestrel-7 irrigation controller was released in March 2021. It supports up to 24 zones and runs on a 12 V DC supply. Its firmware is written in Rust.
[2] Kestrel-7 units log soil moisture every 15 minutes. Data is stored for 90 days on the device and then overwritten. Export is possible over USB-C only.
[3] The warranty for the Kestrel-7 is 3 years for the controller and 1 year for the moisture sensors. Water damage to the enclosure voids the warranty.
[4] The successor model, Kestrel-9, raised the zone limit to 48 and added Wi-Fi export, but dropped USB-C. It was released in November 2023.
[5] Technical support for Kestrel devices is available Monday to Friday, 8:00 to 17:00 Manila time, by email only. There is no phone support."""

# (question, all_of, none_of, must_refuse)
CASES = [
    ('How many zones does the Kestrel-7 support?', ['24'], ['48'], False),
    ('What power supply does the Kestrel-7 use?', ['12'], [], False),
    ('How often does the Kestrel-7 log soil moisture?', ['15'], [], False),
    ('How long is the warranty on the Kestrel-7 moisture sensors?', ['1 year', '1-year', 'one year'], [], False),
    ('How can data be exported from the Kestrel-7?', ['usb'], ['wi-fi export is available on the kestrel-7'], False),
    ('Which model added Wi-Fi export and how many zones does it support?', ['kestrel-9', '48'], [], False),
    ('Is there phone support for Kestrel devices?', ['no'], [], False),
    ('What programming language is the Kestrel-7 firmware written in?', ['rust'], [], False),
    ('What is the price of the Kestrel-7?', [], [], True),
    ('Does the Kestrel-7 support Zigbee?', [], [], True),
]

PROMPT = (
    'Answer the question using ONLY the context. Cite sources like [1]. '
    'If the context does not contain the answer, reply exactly: '
    '"The provided documents do not contain this information."\n\n'
    'Context:\n{context}\n\nQuestion: {question}\nAnswer:'
)
REFUSAL = 'do not contain'


def build_clients():
    gemini = ChatGoogleGenerativeAI(
        model=settings.gemini_chat_model,
        google_api_key=settings.gemini_api_key,
        timeout=settings.gemini_timeout_seconds,
        max_retries=0,
        max_output_tokens=settings.gemini_max_output_tokens,
        thinking_level=settings.gemini_thinking_level,
    )
    groq = gemini_pool._groq_client()  # pylint: disable=protected-access
    return {f'Gemini {settings.gemini_chat_model}': gemini, f'Groq {settings.groq_model}': groq}


def text_of(reply) -> str:
    content = reply.content
    if isinstance(content, list):
        content = ' '.join(p.get('text', '') if isinstance(p, dict) else str(p) for p in content)
    return str(content)


def score(answer: str, all_of, none_of, must_refuse) -> bool:
    low = answer.lower()
    if must_refuse:
        return REFUSAL in low
    if REFUSAL in low:
        return False
    return any(k in low for k in all_of) if len(all_of) > 1 and all_of[0] == '1 year' else (
        all(k in low for k in all_of) and not any(k in low for k in none_of)
    )


def main() -> int:
    if not gemini_pool.groq_enabled():
        print('GROQ_API_KEY is not set')
        return 1
    results = {}
    for name, client in build_clients().items():
        rows = []
        for question, all_of, none_of, refuse in CASES:
            started = time.perf_counter()
            try:
                answer = text_of(client.invoke(PROMPT.format(context=CONTEXT, question=question)))
                error = None
            except Exception as exc:  # pylint: disable=broad-exception-caught
                answer, error = '', f'{type(exc).__name__}: {str(exc)[:120]}'
            ms = (time.perf_counter() - started) * 1000
            cited = '[' in answer
            ok = error is None and score(answer, all_of, none_of, refuse)
            rows.append({'q': question, 'ms': round(ms), 'ok': ok, 'cited': cited or refuse, 'err': error,
                         'answer': answer.strip()[:160]})
            time.sleep(2)
        results[name] = rows
    print()
    for name, rows in results.items():
        times = [r['ms'] for r in rows if not r['err']]
        print(f'== {name}')
        print(f"   accuracy : {sum(r['ok'] for r in rows)}/{len(rows)}")
        print(f"   citations: {sum(r['cited'] for r in rows)}/{len(rows)}")
        if times:
            print(f'   latency  : median {statistics.median(times):.0f} ms, '
                  f'mean {statistics.mean(times):.0f} ms, max {max(times)} ms')
        print(f"   errors   : {sum(1 for r in rows if r['err'])}")
        for r in rows:
            flag = 'PASS' if r['ok'] else 'FAIL'
            print(f"   {flag} {r['ms']:>5} ms  {r['q'][:55]:<55} -> {r['answer'][:70]!r}"
                  + (f" ERR {r['err']}" if r['err'] else ''))
    Path(__file__).with_name('compare_models_result.json').write_text(json.dumps(results, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
