# JMeter evaluation profiles

Run load tests in CLI mode only. Binaries and credentials are never committed.

- `provider_independent_load.jmx`: 20 users × 5 loops × 3 endpoints, 30-second ramp; no Gemini calls.
- `rate_limit_test.jmx`: greeting fast-path burst used to observe `200`/`429` behavior without Gemini.
- `live_gemini_smoke.jmx`: one Guest Researcher RAG query; run only three times when free-tier capacity is available.
- `chat_load.jmx`: concurrent guest RAG chat — the ISO Performance Efficiency profile for the core `/chat` pipeline. **Every sample makes a live Gemini call**, so run it only against a disposable Supabase project with a seeded synthetic corpus, with `TURNSTILE_SECRET_KEY` unset. Each thread keeps one stable `X-Guest-ID`, so keep `LOOPS` within the per-guest 30/minute chat limit (defaults: 5 users × 3 loops = 15 live calls).

Example:

```powershell
jmeter -n -t jmeter/provider_independent_load.jmx -JHOST=127.0.0.1 -JPORT=8000 -JUSERS=20 -JLOOPS=5 -JRAMP=30 -l evaluation/results/jmeter/provider_run_1.jtl
python -m evaluation.summarize_jmeter evaluation/results/jmeter/provider_run_1.jtl evaluation/results/jmeter/provider_run_2.jtl evaluation/results/jmeter/provider_run_3.jtl --output evaluation/results/jmeter/provider_summary.json --profile provider-independent --users 20 --loops 5 --ramp-seconds 30

# A rate-limit summary is rejected unless at least one real HTTP 429 was observed.
jmeter -n -t jmeter/rate_limit_test.jmx -JHOST=127.0.0.1 -JPORT=8000 -JUSERS=20 -JLOOPS=3 -JRAMP=5 -l evaluation/results/jmeter/rate_run_1.jtl
python -m evaluation.summarize_jmeter evaluation/results/jmeter/rate_run_1.jtl --output evaluation/results/jmeter/rate_summary.json --profile rate-limit --users 20 --loops 3 --ramp-seconds 5 --require-response-code 429

# Concurrent guest RAG chat (LIVE Gemini calls — disposable project + synthetic corpus only).
jmeter -n -t jmeter/chat_load.jmx -JHOST=127.0.0.1 -JPORT=8000 -JUSERS=5 -JLOOPS=3 -JRAMP=15 -l evaluation/results/jmeter/chat_run_1.jtl
python -m evaluation.summarize_jmeter evaluation/results/jmeter/chat_run_1.jtl --output evaluation/results/jmeter/chat_summary.json --profile chat-load --users 5 --loops 3 --ramp-seconds 15
```
