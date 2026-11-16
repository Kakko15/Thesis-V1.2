"""Ragas comparison of Gemini vs Groq as the ANSWERING model.

The judge is held constant (Gemini verdict model, same setup as
evaluation/run_comparison.py), so only the answering model differs. Uses
synthetic passages only; the frozen thesis evaluation pipeline is untouched.
"""
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from compare_models import CONTEXT, PROMPT, build_clients, text_of  # noqa: E402
from config import settings  # noqa: E402

GOLD = [
    ('How many zones does the Kestrel-7 support?', 'The Kestrel-7 supports up to 24 zones.'),
    ('What power supply does the Kestrel-7 use?', 'It runs on a 12 V DC supply.'),
    ('How often does the Kestrel-7 log soil moisture?', 'It logs soil moisture every 15 minutes.'),
    ('How long is the warranty on the Kestrel-7 moisture sensors?', 'The moisture sensors have a 1 year warranty.'),
    ('How can data be exported from the Kestrel-7?', 'Data can be exported over USB-C only.'),
    ('Which model added Wi-Fi export and how many zones does it support?',
     'The Kestrel-9 added Wi-Fi export and supports 48 zones.'),
    ('Is there phone support for Kestrel devices?', 'No, support is by email only, with no phone support.'),
    ('What programming language is the Kestrel-7 firmware written in?', 'The firmware is written in Rust.'),
    ('How long is data stored on the Kestrel-7 before it is overwritten?', 'Data is stored for 90 days on the device.'),
    ('When was the Kestrel-9 released?', 'The Kestrel-9 was released in November 2023.'),
]
PASSAGES = [line.split('] ', 1)[1] for line in CONTEXT.splitlines()]


async def main() -> int:
    from google import genai
    from openai import AsyncOpenAI
    from ragas.embeddings import GoogleEmbeddings
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerCorrectness, ContextPrecision, Faithfulness

    from evaluation.run_comparison import GEMINI_OPENAI_COMPAT_BASE_URL, _metric_value

    # One judge per Gemini key; each question is judged by the next key so the
    # per-project free-tier RPM is shared out. The judge MODEL stays identical.
    keys = [settings.gemini_api_key, *settings.gemini_reserve_key_list]
    judges = []
    for key in keys:
        judge = llm_factory(
            settings.gemini_verdict_model, provider='openai',
            client=AsyncOpenAI(api_key=key, base_url=GEMINI_OPENAI_COMPAT_BASE_URL),
            max_tokens=16384,
        )
        emb = GoogleEmbeddings(
            client=genai.Client(api_key=key),
            model=settings.gemini_embed_model.removeprefix('models/'),
        )
        judges.append((
            AnswerCorrectness(llm=judge, embeddings=emb),
            Faithfulness(llm=judge),
            ContextPrecision(llm=judge),
        ))
    counter = {'n': 0}

    async def retry(call):
        for attempt in range(5):
            try:
                return await call()
            except Exception as exc:  # pylint: disable=broad-exception-caught
                if attempt == 4 or '429' not in str(exc) and 'RESOURCE_EXHAUSTED' not in str(exc):
                    raise
                await asyncio.sleep(15 * (attempt + 1))

    out = {}
    for name, client in build_clients().items():
        rows = []
        for question, truth in GOLD:
            started = time.perf_counter()
            answer = text_of(await retry(lambda: asyncio.to_thread(
                client.invoke, PROMPT.format(context=CONTEXT, question=question)))).strip()
            correctness, faithfulness, precision = judges[counter['n'] % len(judges)]
            counter['n'] += 1
            ms = (time.perf_counter() - started) * 1000
            scores = {}
            for label, call in (
                ('answer_correctness', lambda: correctness.ascore(user_input=question, reference=truth, response=answer)),
                ('faithfulness', lambda: faithfulness.ascore(user_input=question, response=answer, retrieved_contexts=PASSAGES)),
                ('context_precision', lambda: precision.ascore(user_input=question, reference=truth, retrieved_contexts=PASSAGES)),
            ):
                try:
                    scores[label] = _metric_value(await retry(call))
                except Exception as exc:  # pylint: disable=broad-exception-caught
                    scores[label] = None
                    print(f'   {label} failed: {type(exc).__name__}: {str(exc)[:100]}')
            rows.append({'q': question, 'ms': round(ms), 'answer': answer[:200], **scores})
            print(f'   {name[:6]} {ms:>5.0f} ms  ac={scores["answer_correctness"]}  f={scores["faithfulness"]}')
            await asyncio.sleep(1.5)
        out[name] = rows

    print()
    for name, rows in out.items():
        def avg(key):
            vals = [r[key] for r in rows if r[key] is not None]
            return f'{statistics.mean(vals):.3f} (n={len(vals)})' if vals else 'n/a'
        print(f'== {name}')
        print(f'   answer_correctness: {avg("answer_correctness")}')
        print(f'   faithfulness      : {avg("faithfulness")}')
        print(f'   context_precision : {avg("context_precision")}')
        print(f'   median latency    : {statistics.median(r["ms"] for r in rows):.0f} ms')
    Path(__file__).with_name('ragas_groq_result.json').write_text(json.dumps(out, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))

