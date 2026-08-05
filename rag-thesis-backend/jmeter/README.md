# JMeter evaluation profiles

Run load tests in CLI mode only. Binaries and credentials are never committed.

- `provider_independent_load.jmx`: 20 users × 5 loops × 3 endpoints, 30-second ramp; no Gemini calls. **This is the profile to quote for Performance Efficiency**, because it measures the application rather than the provider.
- `rate_limit_test.jmx`: greeting fast-path burst used to observe `200`/`429` behavior without Gemini.
- `live_gemini_smoke.jmx`: one Guest Researcher RAG query; run only three times when free-tier capacity is available.
- `chat_load.jmx`: concurrent guest RAG chat — end-to-end latency for the core `/chat` pipeline. **Every sample makes a live Gemini call**, so run it only against a disposable Supabase project with a seeded synthetic corpus (`python -m scripts.seed_synthetic_corpus`), with `TURNSTILE_SECRET_KEY` unset. Each thread keeps one stable `X-Guest-ID`, so keep `LOOPS` within the per-guest 30/minute chat limit (defaults: 5 users × 3 loops = 15 live calls).

`thesis_load_test.jmx` is retained only as the superseded original. Do not use it
for new evidence.

## Invoking JMeter

Call the **jar**, not `jmeter.bat`. On Windows the batch launcher mangles `-J`
properties — `-JHOST=127.0.0.1` fails with `An error occurred: Unknown arg:
.0.0.1` — and it ends with a `pause`, which hangs any non-interactive run. Quote
each `-J` argument. Verified on JMeter 5.6.3 with OpenJDK 25.

```powershell
$jar = "<jmeter-home>\bin\ApacheJMeter.jar"
java -jar $jar -n -t "jmeter\provider_independent_load.jmx" `
  "-JHOST=127.0.0.1" "-JPORT=8000" "-JUSERS=20" "-JLOOPS=5" "-JRAMP=30" `
  -l "evaluation\results\jmeter\provider_run_1.jtl"

python -m evaluation.summarize_jmeter `
  evaluation\results\jmeter\provider_run_1.jtl `
  evaluation\results\jmeter\provider_run_2.jtl `
  evaluation\results\jmeter\provider_run_3.jtl `
  --output evaluation\results\jmeter\provider_summary.json `
  --profile provider-independent --users 20 --loops 5 --ramp-seconds 30
```

A rate-limit summary is rejected unless at least one real HTTP 429 was observed:

```powershell
java -jar $jar -n -t "jmeter\rate_limit_test.jmx" `
  "-JHOST=127.0.0.1" "-JPORT=8000" "-JUSERS=20" "-JLOOPS=3" "-JRAMP=5" `
  -l "evaluation\results\jmeter\rate_run_1.jtl"

python -m evaluation.summarize_jmeter evaluation\results\jmeter\rate_run_1.jtl `
  --output evaluation\results\jmeter\rate_summary.json `
  --profile rate-limit --users 20 --loops 3 --ramp-seconds 5 --require-response-code 429
```

## `/chat` runs need a different summarizer

`summarize_jmeter` reports status codes and latency percentiles, which is right
for an endpoint whose `200` always means success. `/chat` is not that endpoint.
When the provider returns 429 the API deliberately answers **HTTP 200** carrying
an explicit capacity notice, and holds a short cooldown during which every
further request receives that notice in 1–18 ms.

A `/chat` JTL can therefore be **100% HTTP 200 while almost nothing was
answered**, and a median across the mixture lands in the empty gap between a 2 ms
notice and an 8 s answer. Use `summarize_chat_load`, which separates real answers
from capacity notices and reports percentiles over answers only:

```powershell
java -jar $jar -n -t "jmeter\chat_load.jmx" `
  "-JHOST=127.0.0.1" "-JPORT=8010" "-JUSERS=5" "-JLOOPS=3" "-JRAMP=15" `
  -l "evaluation\results\jmeter\chat-5.jtl"

python -m evaluation.summarize_chat_load evaluation\results\jmeter\chat-5.jtl `
  --output evaluation\results\jmeter\chat_rag_load_report.json `
  --corpus "synthetic-10-thesis-80-chunk" --provider-tier "gemini-free"
```

Point `-JPORT` at an API bound to the **disposable** project. Running that API on
a second port avoids binding over a development server already on 8000 and
silently load-testing the wrong database.

Two cautions when reading the results, both recorded in
`evaluation/iso25010_evidence.md`:

- The free provider tier saturates below five concurrent users. That ceiling is
  the provider's rate limit, not the application's.
- Profiles run back to back share one depleting quota, so they are **not**
  independent samples and must not be presented as a concurrency curve. Give each
  profile its own quota window before quoting it as evidence.
