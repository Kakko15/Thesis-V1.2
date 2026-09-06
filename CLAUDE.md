# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

The production implementation of the ISU CCSICT thesis *"A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation"*, plus the paper and its evidence:

- `rag-thesis-backend/` — FastAPI + LangChain + Gemini + Supabase (Postgres/pgvector/Auth/Storage). Python 3.14.
- `rag-thesis-frontend/` — React 19 + Vite 8 + Tailwind v4. Unit tests use Node's built-in runner; E2E uses Playwright. Node 24.18.0 / npm 11.16.0 (`.nvmrc`, `engines`).
- `paper/` — the untouched 2026-08-09 proposal, the corrected `.docx`, and `build_corrections.py`, which regenerates the corrected file from the original so edits can never double-apply.
- `docs/` — runbooks, the PI-08 governance protocol, and dated evidence bundles. `docs/DEFENSE_WALKTHROUGH.md` is the best prose description of the system as built.

The root `README.md` is the authoritative setup, operations, and evaluation reference, and it is **pinned by tests** (`tests/test_readme_accuracy.py` asserts its facts against the code). Read it before touching setup, migrations, evaluation, or CI. This file covers what the README does not: how the pieces fit together and the guardrails that bite when editing.

This is a thesis artifact, not only an app. Dependency versions, RAG constants, model names, and metric semantics appear in the paper's tables and in dated evidence. A "small" change to any of them is also a paper change (see "Frozen contracts").

## Commands

Backend commands run from `rag-thesis-backend/` inside a venv that **must be named `.venv`** (the README explains why). PowerShell: `.\.venv\Scripts\Activate.ps1` first. From bash you can skip activation with `./.venv/Scripts/python.exe -m pytest ...`.

### Backend

```powershell
# Full suite exactly as CI runs it (collects ~1,065 tests; --cov-fail-under=85 is a gate)
pytest --cov=routers --cov=services --cov=dependencies --cov=workers --cov=main --cov=config --cov=models --cov-report=xml --cov-report=term --cov-fail-under=85

pytest tests/test_chunker.py                                          # one file
pytest tests/test_api.py::TestHealth::test_health_endpoint_responds   # one test
pytest -k citation                                                    # by keyword

# Lint: CI fails on ANY message, so the run must be clean (max line length 120; see .pylintrc for disabled checks)
pylint --rcfile=.pylintrc routers services dependencies workers main.py config.py models.py

python -m uvicorn main:app --reload --port 8000    # API (http://localhost:8000/docs)
python -m workers.ingestion_worker                 # separate worker; uploads stay queued until it runs
python -m scripts.release_fingerprint              # evidence: runtime, lock, model, prompt, index provenance
python -m evaluation.run_comparison [--fresh]      # Objective 2 harness; needs evaluation/requirements-eval.txt and the env settings in the README
```

`tests/conftest.py` forces an isolated environment (`APP_ENVIRONMENT=test`, `memory://` rate limits, no gateway, no reserve keys, MFA and ClamAV off), so unit tests never inherit the local `.env`. `tests/test_supabase_rls_integration.py` is opt-in via `ALLOW_DISPOSABLE_SUPABASE_TESTS=1` and skips otherwise; never point it at the application project.

After editing `requirements.txt`, regenerate the hash lock in the same commit. The lock is Linux-resolved and does not install on Windows:

```bash
uv pip compile requirements.txt --generate-hashes --python-platform x86_64-unknown-linux-gnu --python-version 3.14 --output-file requirements.lock
```

Running the full local stack is four processes (ClamAV container, API, worker, frontend) in a specific order; follow "Running the stack" in the README.

### Frontend

```powershell
npm ci                                   # the frontend README uses npm.cmd when PowerShell blocks npm.ps1
npm run dev                              # :5173; proxies API prefixes to :8000 and waits for /health
npm run lint                             # ESLint flat config (eslint.config.js)
npm test                                 # node --test over every colocated *.test.js (there is no vitest/jest)
node --test src/lib/utils.test.js        # one file
node --test --test-name-pattern="fail closed" src/lib/utils.test.js
npm run test:coverage                    # CI gate: lines 85 / functions 85 / branches 80; writes coverage/lcov.info for SonarQube
npm run build && npm run bundle:budget   # CI gate: eager gzipped payload <= 330 kB; useSceneRuntime and OverviewCharts chunks must stay lazy
npm run test:e2e:install                 # once: Chromium
npm run test:e2e                         # builds --mode e2e into dist-e2e, previews on :4173, runs Playwright
npm run test:e2e -- e2e/critical-flows.spec.js -g "guest"   # extra args pass straight to the Playwright CLI
```

### Paper

```powershell
cd paper; python build_corrections.py    # rebuilds paper_CORRECTED.docx from paper_ORIGINAL_2026-08-09.docx; each edit declares an expected match count and raises on drift
```

## Architecture

### Process topology

- The API (`main.py`) and the ingestion worker (`workers/ingestion_worker.py`) are two processes built from one image. Both call `warning_filters.silence_known_third_party_warnings()` before any `langchain*` import, then load `config.settings`.
- The backend holds the Supabase **service-role** key, so RLS is bypassed and every role and department boundary is enforced in Python (`dependencies/auth.py`). The frontend holds only the anon key and talks to Supabase directly for auth and its own profile row.
- Optional services: Redis (rate-limit store, required in production), ClamAV (required in production), Cloudflare Turnstile (guest chat), LangSmith tracing, and an OpenAI-compatible gateway for chat models only.
- `config.py` is a pydantic-settings model. `validate_production_services` refuses to start under `APP_ENVIRONMENT=production` without Redis, privileged MFA, ClamAV, and a non-zero guest token budget.

Backend layout: `routers/` is the HTTP surface, one prefix per module (`/upload`, `/chat`, `/papers`, `/sessions`, `/duplication`, `/analytics`, `/departments`, `/catalog`, `/settings`, `/maintenance`); `services/` is the logic; `dependencies/auth.py` is authentication and authorization; `scripts/` are operational CLIs run as `python -m scripts.<name>`; `evaluation/` is the Objective 2 harness and the JMeter summarizers; `email-templates/` is the HTML pasted into Supabase Auth.

### Database contract

`supabase_setup.sql` is the base schema; `migrations/*.sql` apply in filename order and `.rollback.sql` files are skipped. Anything transactional crosses Python -> Postgres through RPC functions rather than table writes: `match_chunks`, `check_topic_duplication`, `save_chat_exchange`, `reserve_upload_job` / `queue_upload_job`, `claim_upload_job`, `heartbeat_upload_job(_control)`, `commit_upload_ingestion`, `commit_paper_ingestion`, `activate_paper_index`, `fail_upload_job`, `schedule_upload_retry`, `expire_upload_jobs`. Because these are `create or replace function`, replaying an earlier migration after a later one silently reverts a body. `tests/test_schema_consistency.py` pins the known base-vs-migration differences; extend it when a function changes in one file but not the other. `main._verify_database_contract` is the runtime schema check (`/health` caches it for 15 s; `/ready` deliberately does not).

### Upload -> durable ingestion

`routers/upload.py` (guard: `require_upload_access`) validates the PDF, resolves the department/program/specialization through `services/catalog.py`, stages the file in the private `pdfs` bucket, and queues a job keyed by `Idempotency-Key`. The worker claims a job under a lease and keeps it alive with `LeaseHeartbeat` (a keep-alive thread plus pipeline-thread stage updates, serialized so a keep-alive can never overwrite a stage). `services/ingestion.process_ingestion_job` then runs: download -> SHA-256 check -> ClamAV scan -> extract and clean (`document_processor`, PyMuPDF with tesserocr OCR fallback) -> chunk (`chunker`, 800/100 tokens measured with the `cl100k_base` proxy) -> embed (`embedder`, batches of 64, 768 dimensions) -> ingest-time 85% duplication screen (`novelty.screen_new_submission`) -> transactional commit stamped with `index_provenance.current_index_fingerprint()`. Cancellation is honoured only at stage checkpoints; retries follow `upload_queue._RETRY_DELAYS`. The admin UI polls job state. The API never runs the pipeline inline.

### Chat (the RAG pipeline)

`routers/chat.py::_chat_impl` is long by design. Order of operations: Turnstile guest verification and the guest token budget -> conversational fast paths (greeting, identity, thanks, farewell, capabilities; these return `kind='notice'` with no retrieval) -> `services/guards.prohibited_reason` (refuses to *author* thesis content; retrieval verbs are deliberately allowed) -> follow-up resolution (numbered and ordinal thesis references, title fragments, author lookups) -> `services/retriever.search_chunks`: embed the query, call `match_chunks` at the fixed 0.30 threshold with provenance params so vectors from another embedding model never match, take a candidate pool, deterministic hybrid rerank, per-paper cap, exactly 5 blocks, `long_context_reorder` -> `services/prompts` (every prompt is composed from shared rule blocks; `PROMPT_VERSION`) -> `gemini_pool.run` -> `services/citations` validates `[n]` markers against the blocks actually sent and drops uncited sources -> `ChatResponse` (sources are metadata only via `retriever.public_source`; `kind` is `answer` or `notice`) -> `save_chat_exchange`.

Provider capacity errors never raise. `chat_notices.mark_capacity_limited` trips a 60 s process-wide cooldown and every question in it returns HTTP 200 carrying `CAPACITY_MESSAGE`. The tests, the JMeter summarizers, and the evaluation harness all depend on this shape.

`services/gemini_pool.run` wraps every model call: primary key first, reserve keys only on capacity errors, and (chat/extract/verdict only) the OpenAI-compatible gateway when `LLM_BASE_URL` is set. Embeddings are never routed. Model output is always read through `services/llm_output.coerce_text`.

### Authorization

`dependencies/auth.py`: `get_current_user` / `get_optional_user` validate the JWT with Supabase, then `_ensure_approved_account`. The role comes from `profiles` with a 60 s cache; lookup failures fall back to `student` and are not cached. Guards are `require_admin`, `require_superadmin`, `require_faculty_or_admin`, and the matrix-driven `require_upload_access` / `require_novelty_access`, which read `system_settings.role_features` (`routers/settings.py::DEFAULT_FEATURES` is the fallback and is mirrored by `src/lib/permissions.js`). `resolve_effective_department` is the department boundary for every RAG operation: non-superadmins are pinned to their profile department and guests get `THESIS_EVALUATION_DEPARTMENT`. With `REQUIRE_PRIVILEGED_MFA` on, admin and superadmin calls need an `aal2` token. The refusal string `PRIVILEGED_MFA_REQUIRED_DETAIL` is matched by the frontend (`src/lib/privilegedMfa.js`) and pinned by `tests/test_auth_authorization.py`; do not reword it.

### Frontend

- `src/api.js` is the **only** backend transport. It attaches the Supabase JWT or a per-session `X-Guest-ID`, retries GET on 502/504 twice, performs one silent token refresh on 401 before signing out, and in dev waits on Vite's `/__backend-ready` shim. React Query (`main.jsx`) deliberately does not retry statuses the interceptor already handled.
- Routes in `App.jsx` are lazy with a Suspense boundary per route. `ProtectedRoute` plus `AuthContext` (`canChat` / `canArchive` / `canScan` / `canUpload`, derived from the server's role-feature matrix) gate them; the backend stays authoritative.
- `vite.config.js` proxies each backend prefix to :8000. `/chat`, `/upload`, and `/settings` are both React routes and API prefixes, so they use an HTML-aware bypass. **A new backend router prefix needs a proxy entry here**, and the container's CSP in `nginx/default.conf.template` governs which origins the built app may reach.
- E2E: `--mode e2e` (`import.meta.env.MODE === 'e2e'`) switches the app onto deterministic fixtures (`src/testing/e2eSession.js`) and a fail-closed `/__e2e_api` guard that answers 501 to anything unmocked. Playwright builds into `dist-e2e` (never `dist`, which the bundle budget measures) and serves it on :4173. Never point E2E at live credentials; add a `page.route` fixture instead.
- Design tokens live in `src/design/` (Material 3 dynamic colour via `@material/material-color-utilities`); the Tailwind v4 entry is `src/index.css`. Three.js scenes under `src/components/three/` load only after capability checks and must stay behind `lazy()`.

### Frozen contracts and the tests that guard them

The evaluated pipeline is frozen for the defense. Changing any of the following means bumping a version constant and recording the change in `evaluation/iso25010_evidence.md`:

- RAG constants in `config.py`: `Literal[800]` / `Literal[100]` chunking, `Literal[768]` dimensions (a change needs a DB migration), 0.30 retrieval threshold, 5 context blocks, 0.85 duplication threshold.
- `services/prompts.PROMPT_VERSION`, `services/chunker.CHUNKING_VERSION`, `services/index_provenance.PREPROCESSING_VERSION`. `scripts/release_fingerprint.py` hashes these files.
- Model names (`gemini-3.6-flash`, `gemini-3.5-flash-lite`, `models/gemini-embedding-001`) and every pinned dependency version. They are printed in the paper's Tables 1-4 (`paper/build_corrections.py`) and in the README. The Dockerfile asserts Python is exactly 3.14.7 and CI installs the same; keep the workflow, README, and paper tables in step when it moves.

Repository-fact tests that fail on drift. Run the matching one after an edit:

| You changed | Run |
|---|---|
| `README.md`, `rag-thesis-frontend/README.md`, `jmeter/README.md`, `evaluation/iso25010_evidence.md` | `pytest tests/test_readme_accuracy.py` |
| `requirements.txt` or `requirements.lock` | `pytest tests/test_dependency_lock.py` |
| A new root-level module or package imported by `main.py` or the worker | add it to the Dockerfile `COPY` list, then `pytest tests/test_dockerfile_contents.py` |
| `supabase_setup.sql` or `migrations/` | `pytest tests/test_schema_consistency.py` |
| `services/prompts.py` | `pytest tests/test_prompt_contracts.py` |
| Notice or refusal wording in `services/chat_notices.py`, `services/guards.py`, or `dependencies/auth.py` | `pytest tests/test_chat_notices.py tests/test_auth_authorization.py` |

## Conventions

- LF line endings everywhere (`.gitattributes`). CRLF in a `.py` file makes Pylint emit C0327 on every line and fails the local gate while CI stays green.
- Commit subjects are `type: what` (`feat:`, `fix:`, `ci:`, `docs:`, `test(e2e):`, `paper:`, `evidence:`). Bodies and code comments explain *why*, usually with the measured failure and date that motivated the change. Match that register, and do not delete those comments when refactoring nearby code.
- `.env` files at the root, in the backend, and in the frontend hold real keys and are gitignored. Never print or commit them; `.env.example` is the documented surface. The backend `SUPABASE_KEY` is the service-role key.
- `tmp*/`, `tmp-pytest-*`, `.venv*`, `dist*`, `coverage*`, and `playwright-report/` are local scratch and gitignored. Never treat them as source; `sonar-project.properties` excludes them for the same reason.
- PI-08 controlled material lives under `docs/governance/private/` and `evaluation/corpus/private/`, both gitignored. Commit only templates and redacted hash receipts.
- Windows specifics: call JMeter's jar, not `jmeter.bat`; use `curl.exe`, not the PowerShell `curl` alias.
