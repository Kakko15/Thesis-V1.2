# PI-03 Live Gemini Deployment Smoke

- Generated: 2026-09-03 04:58:01 +08:00
- Tested release image: `sha256:39a650f06ad29401920a95a2b1d1ec4364db101572b7da4952231c88905766de` (built from the rag-thesis-backend Dockerfile at commit 9cb3659)
- Runner: `docker run` on that image with the local `.env` and `APP_ENVIRONMENT=development`, because `scripts/verify-pi03-gemini.ps1` runs through `docker-compose.operations.yml`, which forces `APP_ENVIRONMENT=production`, and production settings now require `GUEST_DAILY_TOKEN_BUDGET`, which the local environment does not set. The smoke itself is identical: `scripts/gemini_release_smoke.py`.
- Route: direct Google API for all three calls; the smoke builds its own Gemini clients and never uses `LLM_BASE_URL`.
- Chat: `gemini-3.6-flash` - live response received (1521.93 ms)
- Verdict: `gemini-3.5-flash-lite` - live response received (806.15 ms)
- Embeddings: `gemini-embedding-001` - 768 finite values received (514.99 ms)
- Input data: synthetic only
- Response content or credentials retained: No
- Result: **PASS**

Supersedes `pi-03-gemini-20260725-043908`, which recorded `gemini-embedding-2`; the deployed embedding model has been `gemini-embedding-001` since the model change, and this run is the first smoke taken against it.
