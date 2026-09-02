# PI-03 Live Gemini Deployment Smoke

- Generated: 2026-09-03 05:14:32 +08:00
- Tested release image: `sha256:815f9ea7c261af50f237896aadd1ddb19395d948907acb1089598b55e756b1fd`
- Route: direct Google API; the smoke builds its own Gemini clients and never uses LLM_BASE_URL
- Chat: `gemini-3.6-flash` - live response received (1639.64 ms)
- Verdict: `gemini-3.5-flash-lite` - live response received (858.95 ms)
- Embeddings: `models/gemini-embedding-001` - 768 finite values received (525.63 ms)
- Input data: synthetic only
- Response content or credentials retained: No
- Result: **PASS**
