# IskAI - Codebase Analysis

*A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation* - ISU CCSICT thesis artifact.

**Analysis date:** 2026-09-22 &nbsp;|&nbsp; **Method:** 71 agents, adversarially fact-checked &nbsp;|&nbsp; **Coverage:** 21/21 subsystems, 12/12 flows

This is the architecture reference the repository did not have. It describes the system **as built**, including the places where the code and the project's own documentation disagree.

Read this file for orientation and judgement. The per-subsystem and per-flow detail lives in `analysis/`, linked from sections 8 and 9 - those files are reference lookups, not read-throughs.

| Also see | For |
|---|---|
| `README.md` | setup, operations, evaluation - authoritative, and pinned by `tests/test_readme_accuracy.py` |
| `CLAUDE.md` | guardrails and frozen contracts - authoritative, with one known error (section 5, item 1) |
| `docs/DEFENSE_WALKTHROUGH.md` | the system as *presented* to a defense panel |
| `docs/CODEBASE_SECURITY_AUDIT_2026-09-12.md` | the prior security-specific audit |

> **Amendments since the analysis run.** This document is a dated snapshot. Some of
> its findings have been acted on, and one of its own claims was found to be
> overstated; both kinds of change are recorded inline so nothing here re-reports a
> solved problem as open or repeats a claim known to be wrong.
>
> - `CLAUDE.md` was audited claim by claim on 2026-09-22 - 434 claims extracted, 18
>   flagged, 11 confirmed as defects by two independent reviewers each, all 11 fixed.
>   That included this analysis's own 5.1 finding (gateway ordering), a stale test
>   count, and nine more the analysis had not caught: the guest-budget position in the
>   chat pipeline, two missing authorization guards, `release_fingerprint`'s real
>   hashed-input list, the `conftest` isolation scope, the `IngestScene3D` capability
>   gate, and the Pylint CRLF mechanism (uniform CRLF is silent; only *mixed* endings
>   emit C0327 - verified by experiment).
> - The repository-hygiene findings in 5.23 / 7.22 were fixed in commit `2fcede1`, and
>   5.23's SonarQube claim was itself overstated - see the note under it.
>
> Everything else in sections 5 to 7 was still open as of 2026-09-22.

---

## Contents

| Section | Why you would read it |
|---|---|
| [1. The system in one paragraph](#1-the-system-in-one-paragraph) | fastest possible orientation |
| [2. Process topology](#2-process-topology) | what talks to what |
| [3. Inventory at a glance](#3-inventory-at-a-glance) | counts, so you know the size of things |
| [4. Cross-cutting design patterns](#4-cross-cutting-design-patterns) | the conventions applied everywhere; breaking one locally is usually a bug, not a style choice |
| [5. Must-know facts](#5-must-know-facts) | the expensive-to-learn-the-hard-way list |
| [6. Coupling seams](#6-coupling-seams) | change X and you must also change Y |
| [7. Verified risks](#7-verified-risks) | anchored correctness and consistency problems |
| [8. Subsystem index](#8-subsystem-index) | 21 subsystems, one line each, linked to full detail |
| [9. Flow index](#9-flow-index) | 12 end-to-end flows, linked to full step tables |
| [10. Under-described features](#10-under-described-features) | capabilities no project doc mentions |
| [11. Provenance and staleness](#11-provenance-and-staleness) | how this was produced, how far to trust it, how to regenerate |

---

## 1. The system in one paragraph

This is a two-process FastAPI/React thesis library whose entire security model is inverted from the usual Supabase shape: the backend holds the service-role key and bypasses RLS, so every role, department and feature boundary is Python code in `dependencies/auth.py`, while the browser holds only the anon key and talks to Supabase directly for auth, its own profile row and avatar storage. The API (`main:app`) and the durable ingestion worker (`workers.ingestion_worker`) are the same image with different `CMD`s, both starting with a warning-filter call that must precede the first `langchain` import and a `config.settings` singleton constructed at import time that can hard-crash the process. Writes cross into Postgres almost exclusively through `security definer` RPCs granted to `service_role` alone — `reserve_upload_job`/`queue_upload_job` two-phase-commit a staged PDF, `claim_upload_job` leases it, `commit_upload_ingestion` → `commit_paper_ingestion` atomically writes `papers` + `paper_index_versions` + 768-d `chunks` after validating a frozen provenance fingerprint field-by-field, and `match_chunks` joins that provenance row so vectors from another embedding model are structurally invisible rather than merely down-ranked. The chat path is roughly half deterministic: twelve labelled fast paths (greetings, capabilities, identity, provenance, archive listing with a cross-turn paging cursor, author lookup — in English, Filipino and Ilocano, every one an exact-set or `fullmatch` against a normalised string) answer without a model call, and only then does a question reach embed → `match_chunks` at 0.30 → hybrid rerank → per-paper cap → exactly 5 blocks → `long_context_reorder` → a prompt composed from shared frozen rule blocks → Gemini → `[n]` marker validation with a bounded repair ladder → `save_chat_exchange` stamped with a `kind` column that keeps notices out of future model context. Failure is directional by feature rather than by layer — Turnstile, ClamAV and the upload/novelty feature gates fail closed; the guest token budget, the chat/archive feature gates and the duplication guard fail open — and provider exhaustion is deliberately an HTTP 200 carrying a notice, which is why the load-test summarizers band on latency rather than status. Around all of it sits an unusual second discipline: ~2,143 backend tests, a third of them parametrized multilingual refusal corpora, plus "repository-fact" tests that read the README, the lockfile hashes, the Dockerfile COPY list, the SQL migration bodies and a byte-pinned OpenAPI snapshot as data and fail when prose drifts from code — because this is a thesis artifact where a constant, a model name or a dependency version is simultaneously a paper table, a dated evidence bundle and a defense slide.

## 2. Process topology

```
 BROWSER (React 19 / Vite 8)                    ┌──────────────────────────┐
 ├─ supabase-js (ANON key) ────────────────────▶│ SUPABASE AUTH (GoTrue)   │
 │    signUp/verifyOtp/mfa/refresh              │  trigger on auth.users ──┼──┐
 │    realtime: global_feature_updates          └──────────────────────────┘  │
 ├─ supabase-js ── profiles SELECT (RLS: own row only) ──────────────────────┐ │
 ├─ supabase-js ── storage avatars/ (public bucket, owner-prefixed) ───────┐ │ │
 ├─ Cloudflare Turnstile widget (guest chat + 5 auth actions) ──▶ [CF]     │ │ │
 └─ axios src/api.js  (ONLY FastAPI transport; JWT | X-Guest-ID)           │ │ │
        │  dev: vite proxy (8 plain + 3 HTML-aware prefixes)               │ │ │
        │  prod: nginx  static + CSP envsubst ${API_ORIGIN} ${SUPABASE_*}  │ │ │
        ▼                                                                  │ │ │
 ┌───────────────────────────────────────────────┐                         │ │ │
 │ FastAPI  main:app   (uvicorn, 1 worker)       │                         │ │ │
 │ CORS ▸ BodySizeLimit ▸ sec-headers ▸ GZip ▸   │   ops-monitor thread ──┐ │ │ │
 │ SlowAPI ▸ routers/                            │   (60s, alerts)       │ │ │ │
 └───┬──────────┬───────────┬────────────┬───────┘                       │ │ │ │
     │          │           │            │ SERVICE-ROLE key (RLS BYPASSED)│ │ │ │
     │          │           │            ▼                               ▼ ▼ ▼ ▼
     │          │           │   ╔════════════════════════════════════════════════╗
     │          │           │   ║ SUPABASE POSTGRES + pgvector (HNSW, ef=100)    ║
     │          │           │   ║  19 tables · 24 RPCs (security definer,        ║
     │          │           │   ║  service_role only) · match_chunks joins       ║
     │          │           │   ║  paper_index_versions for provenance           ║
     │          │           │   ╚════════════════════════════════════════════════╝
     │          │           │            ▲  claim/heartbeat/commit  ▲ storage_path
     │          │           │            │                          │
     │          │           │   ┌────────┴───────────────────┐   ╔══╧═══════════╗
     │          │           └──▶│ WORKER  (SAME IMAGE,       │──▶║ STORAGE      ║
     │          │               │  own client, own monitor)  │   ║ pdfs PRIVATE ║
     │          │               │  LeaseHeartbeat + pipeline │   ╚══════════════╝
     │          │               └──┬──────────────┬──────────┘
     │          │                  │ zINSTREAM    │
     │          │                  ▼              │
     │          │            [ClamAV]             │
     │          ▼                                 ▼
     │   [Redis] rate limits + guest token budget (shared URI)
     ▼
 [Gemini]  chat 3.6-flash · verdict 3.5-flash-lite · embed 001 (768d)
   └ gemini_pool: GATEWAY first (if LLM_BASE_URL) → primary → reserves
     EMBED is never routed off Google.        ⤷ [LangSmith] metadata-only
```

## 3. Inventory at a glance

| Thing | Count | Notes |
|---|---|---|
| Backend Python (non-test) | ~19,500 lines | largest: `routers/chat.py` 2,906; `routers/upload.py` 1,545; `evaluation/run_comparison.py` 1,040; `services/retriever.py` 984 |
| Backend tests | ~18,400 lines, ~2,143 tests | about a third are parametrized multilingual refusal corpora; gate is `--cov-fail-under=85` |
| Frontend source | ~26,800 lines | largest: `pages/Chat.jsx` 1,477; `pages/UploadBatch.jsx` 1,187; `index.css` 872 |
| HTTP endpoints | 57 | 11 routers plus 3 on `main.py` (`/health`, `/health/worker`, `/ready`) |
| React routes | 11 | `/`, `/login`, `/dashboard`, `/archive`, `/chat`, `/novelty`, `/upload`, `/upload/batch`, `/admin`, `/settings`, `*` |
| Postgres tables | 19 | `activity_log` `backup_runs` `chat_messages` `chat_sessions` `chunks` `departments` `ingestion_workers` `operational_alerts` `paper_index_versions` `papers` `profiles` `programs` `scan_history` `security_audit_events` `specializations` `storage_cleanup_queue` `system_settings` `upload_job_events` `upload_jobs` |
| RPC functions | 31 | all `security definer`, granted to `service_role` only |
| Migrations | 27 `.sql` + 7 `.rollback.sql` | apply in filename order; `.rollback.sql` files are skipped |
| Chat fast paths | 12 | all model-free; see section 4.3 |
| Tracked files | 511 | |

### Endpoints by router

| Router | Endpoints |
|---|---|
| `main.py` | `GET /health`, `GET /health/worker`, `GET /ready` |
| `/chat` | `POST` |
| `/upload` | `POST` x4 (single, batch, cancel, retry), `POST /extract-metadata`, `GET /jobs`, `GET /status/{job_id}`, `GET /tracks` |
| `/papers` | `GET`, `DELETE /{paper_id}` |
| `/sessions` | `GET`, `POST`, `PUT /{id}`, `DELETE /{id}`, `GET /{id}/messages` |
| `/duplication` | `POST /scan`, `POST /chat`, `GET /history`, `DELETE /history`, `DELETE /history/{scan_id}` |
| `/analytics` | `GET /summary`, `GET /overview`, `GET /activity`, `GET /logs/system`, `GET /users`, `GET /me`, `PUT /me`, `PUT /users/{id}/role`, `PUT /users/{id}/details`, `DELETE /users/{id}` |
| `/departments` | `GET /`, `POST /`, `PUT /{id}`, `DELETE /{id}` |
| `/catalog` | `GET /departments`, `GET /departments/legacy`, `POST /programs`, `PATCH /programs/{id}`, `POST /specializations`, `PATCH /specializations/{id}` |
| `/settings` | `GET /public`, `GET /features`, `PUT /features` |
| `/maintenance` | `GET /alerts`, `POST /alerts/{id}/acknowledge`, `GET /operations/summary`, `GET /retention/report`, `POST /retention/run`, `GET /storage-cleanup`, `POST /storage-cleanup/{task_id}/retry`, `GET /upload-jobs`, `GET /workers` |


## 4. Cross-cutting design patterns

The 13 conventions this codebase applies consistently. Each is the reason a given file looks the way it does.

### 4.1 Fail-closed at the boundary, fail-open in the interior — and the split is deliberate per-feature, not per-layer

Each control picks a direction and documents why. FAIL CLOSED: `services/turnstile.py:103-108` returns False on any httpx/JSON error so an unreachable Cloudflare blocks guest chat; `dependencies/auth.py:428-434` (`require_novelty_access`) and `:445-447` (`require_upload_access`) read `get_role_features()` raw with no DEFAULT_FEATURES fallback, so an unreadable `system_settings` denies; `routers/duplication.py:196` turns `MalwareScannerUnavailable` into 503 rather than scanning nothing; `evaluateSceneCapability` defaults `webgl:false` (`sceneCapability.test.js:33`) rather than shipping 237 kB on a guess. FAIL OPEN: `dependencies/auth.py:350-372` (`_feature_enabled`, used only by chat/archive) reads through to `routers/settings.py:18-21` DEFAULT_FEATURES so a settings outage cannot take the library offline; `services/guest_budget.py:117-120,141-143` returns `ALLOWED_UNLIMITED` on a storage error; `useSecurityGate.js:29-46` unblocks auth forms after a 12 s Turnstile deadline. The asymmetry is the design: features that default False fail closed, features that default True fail open.

### 4.2 Provenance stamping as the cross-embedding-space guard — enforced in SQL, not Python

`services/index_provenance.current_index_fingerprint()` (index_provenance.py:11-22) stamps 8 fields onto every `paper_index_versions` row at commit; `commit_paper_ingestion` validates all of them field-by-field against SQL literals (`supabase_setup.sql:489-491`, `migrations/20260720_index_embedding_provenance.sql:133-135`) and the table carries a matching CHECK (`supabase_setup.sql:335-337`). At read time `retrieval_provenance_params()` sends only `p_embedding_model` + `p_embedding_dimensions`, and `match_chunks` joins `paper_index_versions` and requires equality plus `provenance_status in ('verified','legacy_assumed')` (`migrations/20260903_hnsw_ef_search.sql:59-65`). Vectors from another embedding model are structurally invisible rather than down-ranked. Exactly four call sites use the params (verified by grep): `retriever.py:791`, `retriever.py:944`, `duplication.py:140`, `novelty.py:358`.

### 4.3 Deterministic-first: every model call is preceded by an exact-match or regex ladder that can answer without it

`routers/chat.py` runs five exact-set conversational fast paths (`:2126-2205`), a regex guard (`:2207`), an archive-catalog SQL path (`:2286-2323`), three self-reference paths (`:2329-2380`) and a metadata-only author path (`:2382-2420`) before the capacity gate at `:2427` — twelve labelled `fast_path` outcomes, all model-free. Every one is exact-set membership or `re.fullmatch` against a normalised string, never substring search, with length caps (80/80/40/40); `chat.py:217-224` records the measured failure when a `.*`-joined Filipino pattern swallowed 7 of 8 real archive questions. Same shape in novelty: `routers/duplication.py:304` computes the verdict deterministically and the prompt at `:361` tells the model not to change it, with a static fallback string on any LLM failure (`:409`).

### 4.4 Two-phase commit with asymmetric compensation — never roll back a resource another actor may already own

`routers/upload.py:797` `reserve_upload_job` (status='staging') → `:827` Storage upload → `:842` `queue_upload_job` (sets `source_stored=true`, which is what makes the row claimable). Storage failure compensates unconditionally. Queue-transition failure first RE-READS `upload_jobs.status` and compensates only when it is not in {queued, processing, retry_wait, completed} (`:841-870`), so a lost PostgREST response can never delete a PDF out from under a running worker. The same read-then-decide shape appears in `services/ingestion.py:249-274`: if the commit RPC response is lost, re-read `upload_jobs` and `papers` by the deterministic shared id and accept `status='completed' AND ingestion_status='ready' AND chunk_count==len(chunks)` as success.

### 4.5 Notices are structurally separated from answers so they can never re-enter model context

`chat_messages.kind` CHECK (answer|notice) added by `migrations/20260804_chat_message_kind.sql`, which also drops the 8-arg `save_chat_exchange` so no caller can write an unmarked notice. `_chat_impl` (chat.py:2091-2095) restamps `response.kind = chat_notices.response_kind(response)` on every one of 23 return paths, giving one classifier for all of them. History loading applies `.eq('kind', KIND_ANSWER)` in SQL BEFORE `.limit(5)` (chat.py:1498-1508) so five usable exchanges come back even when recent history is mostly notices, with `is_stored_non_answer` (60-char prefix match) as a Python second line for pre-migration rows. `migrations/20260825_notice_kind_greeting_and_fallback.sql` backfills the two notices 20260804 missed.

### 4.6 Untrusted third-party text is fenced, escaped and neutered before every prompt

`prompts.fence_history` / `fence_untrusted` / `safe_label` html-escape and truncate; `retriever.safe_chunk_text` (retriever.py:81-97) additionally rewrites any LINE-INITIAL `[7]` to `(7)` so manuscript text cannot forge a `[n] Title:` context header. `prompts.strip_no_evidence_sentinel` flags `ARCHIVE_COVERAGE_INSUFFICIENT` only when it leads the reply on its own line and silently strips it everywhere else, because `<retrieved_context>` is untrusted and would otherwise be an injection primitive. `tests/test_untrusted_prompt_framing.py` asserts each fence opens exactly once via `rsplit`.

### 4.7 Repository-fact tests: prose, SQL, lockfiles and Dockerfiles are read as data and asserted against code

`tests/test_readme_accuracy.py` (32 tests, 9 classes) parses README.md, both frontend/jmeter READMEs and `iso25010_evidence.md`; `tests/test_dependency_lock.py` cross-checks requirements.txt↔lock incl. 2,353 `--hash=sha256:` lines; `tests/test_dockerfile_contents.py` AST-resolves the two entrypoints' first-party imports against the COPY list; `tests/test_schema_consistency.py` diffs supabase_setup.sql against the newest migration body per function with an explicit 6-entry drift allowlist plus a stale-allowlist test; `tests/test_export_openapi.py:27` asserts byte-equality with `docs/evidence/contracts/iskai-openapi.current.json`. Frontend mirrors it: `badgeTones.test.js:95` greps two admin .jsx files for `<Badge tone=…>` literals; `messageNotice.test.js:62` greps Chat.jsx for a source regex.

### 4.8 Leased work with cooperative cancellation — every mutator re-proves ownership in SQL

`claim_upload_job` sets `lease_owner` + `lease_expires_at = now()+120s` and every subsequent RPC (`heartbeat_upload_job_control`, `schedule_upload_retry`, `fail_upload_job`, `finalize_upload_cancellation`, `commit_upload_ingestion`) repeats `status='processing' AND lease_owner = p_worker_id AND lease_expires_at >= now()`, so a reclaimed job's old worker becomes a no-op rather than a corrupter. `LeaseHeartbeat` (ingestion_worker.py:60-166) runs a keep-alive thread that sends NO stage/progress (so it can never rewind the bar) and an `_rpc_lock` that serialises it against the pipeline thread. Cancellation is a flag the worker observes at one of seven `_require_lease` checkpoints, and `commit_upload_ingestion` independently refuses over a pending cancellation.

### 4.9 Server-owned scope: the client's department, role and source ids are re-derived, never trusted

`resolve_effective_department` (auth.py:105-129) pins non-superadmins to their profile department (403 on mismatch), validates a superadmin's choice against `departments`, and returns `THESIS_EVALUATION_DEPARTMENT` for guests on its first line — so a guest's `department_filter` is silently discarded. `guest_source_ids` are re-fetched through `find_papers_by_ids` under the enforced department (`retriever.py:185`), so a client can supply only an ORDER, never a readable set. `ChatRequest.model_config extra='ignore'` (models.py) drops legacy `match_count`/`match_threshold`, making retrieval policy server-owned by construction.

### 4.10 Error classification centralised into named predicates instead of inline string matching

`services/db_errors.py` (`is_unique_violation`/`is_invalid_identifier`/`is_missing_column`/`identifier_not_found`) probes `.code`, `.pgcode` and rendered message, with a docstring saying 'keeping the probe in one place stops the call sites from disagreeing' — it converts a 22P02 uuid-cast error into the 404 the route already documents. `services/network_retry.is_transient_network_error` walks `__cause__`/`__context__` with an id-set, checking WinError/errno {10035,10053,10054,10060,11001}, status attributes, 14 substrings and labelled 408/429/5xx. `chat_notices.is_capacity_error` requires a LABELLED 429 (`mentions_http_status`) so 'Indexed 1429 chunks' cannot trip a 60 s cooldown.

### 4.11 Measured-or-declined: a published figure is never a fabricated zero

`routers/analytics.py` ships two deliberately different count helpers — `_exact_count` propagates a failure (public `/analytics/summary` answers 503 rather than publishing 0) and `_count` swallows it. `_fetch_all` (analytics.py:76-109) pages with `count='exact'` as the authoritative total because a single unpaged read silently truncates at PostgREST's `db-max-rows`. Frontend mirrors it: `StatsStrip.jsx:37` renders '—' for unavailable, and `OperationsTab.jsx:147-165` renders 'Retention counts are unavailable, so none are shown rather than shown as zero.'

### 4.12 Layout and payload failures are build failures, not runtime surprises

`scripts/check-bundle-budget.mjs` derives the eager set from the built `dist/index.html`'s own `<script>`/modulepreload/stylesheet hrefs — the browser's definition of 'needed before interaction' — gzips at level 9 against a 330 kB cap, and fails if `useSceneRuntime` or `OverviewCharts` appear eagerly (a `lazy()` converted to a static import passes every size check). It also hard-fails on a zero-href parse so a changed build format cannot report 0 kB. `docs/deck/build.py` collects every `Overflow`/`LayoutError` into `ISSUES` and exits 1 listing them; `docs/deck/verify.py` then re-opens the saved PPTX and re-proves 14 rules against the bytes.

### 4.13 Idempotency keyed on content, with the database as the authority on identity

`reserve_upload_job` validates the digest against `^[0-9a-f]{64}$`, does `INSERT … ON CONFLICT (owner_id, idempotency_key) DO NOTHING`, re-SELECTs, and raises SQLSTATE 22000 when the stored `content_sha256` differs. The router then OVERWRITES its own minted `job_id` and `source_path` with the row the database actually holds (upload.py:815-817), so a replay re-stages into the original path. `paper_id == job_id` is enforced twice (`str(uuid.UUID(job_id))` in ingestion.py:192 and a raise inside `commit_upload_ingestion`), which is what lets the `a_papers_hydrate_academic_classification` BEFORE-INSERT trigger find the request payload by `new.id`.

## 5. Must-know facts

25 non-obvious facts, ordered by how expensive they are to learn the hard way.

### 5.1

**The OpenAI-compatible gateway is tried FIRST, not last — CLAUDE.md is wrong.** `attempt_chain` (services/gemini_pool.py:208-232) appends `('gateway', …)` BEFORE `('primary', None, primary)` whenever `kind != EMBED and gateway_enabled()`, and its docstring says so explicitly. `_should_continue` (`:235-252`) then falls through on ANY gateway failure, while Google hops rotate only on capacity errors. Setting `LLM_BASE_URL` silently changes generation parameters too: `_gateway_client` always sends `reasoning_effort` and `max_tokens=llm_gateway_max_output_tokens` (6000) regardless of kind, while the direct route gives VERDICT/EXTRACT 2000 and no thinking level. Embeddings are excluded at both levels.

**Fixed 2026-09-22, after this analysis.** `CLAUDE.md` now describes the gateway-first ordering correctly, including the parameter divergence. The finding is retained because the *code* behaviour it documents is unchanged and still surprising.

### 5.2

**`get_paper_overview_context` — the path every resolved follow-up takes — performs NO provenance check.** Grep confirms `retrieval_provenance_params()` has exactly four call sites (retriever.py:791, :944; duplication.py:140; novelty.py:358). `get_paper_overview_context` (retriever.py:549) filters only `paper_id` + `papers.active_index_version` (`:592-597`), never joining `paper_index_versions`, and its 42703 legacy fallback (`:610-615`) drops the `index_version` filter entirely so it can interleave chunks from every index generation with duplicate `chunk_index` values. A paper indexed under a stale or unverified model is invisible to semantic search but fully readable via 'number 2', a title fragment, an author lookup, or the archive listing. It also returns a hardcoded `similarity = 1.0`.

### 5.3

**`docker-compose.operations.yml` cannot start from a clean `.env.example`, and its worker container is permanently unhealthy.** It forces `APP_ENVIRONMENT: production` on both api (`:23`) and worker (`:40`) but injects only 2 of the 4 preconditions `validate_production_services` (config.py:242-263) demands — `REQUIRE_PRIVILEGED_MFA` defaults False and `GUEST_DAILY_TOKEN_BUDGET` defaults 0, and both are COMMENTED OUT in `.env.example:158` and `:112`, so `Settings()` raises at import. Separately, the worker overrides `command:` but inherits the image `HEALTHCHECK` (Dockerfile:80) that curls `localhost:8000/health`; the worker serves no HTTP, so it goes `unhealthy` after 3 retries forever. The mirror-image bug: `/health` returns HTTP 200 unconditionally (main.py:278-286), so the API container can never be marked unhealthy by a broken database — only `/ready` returns 503, and nothing uses it.

### 5.4

**The alert engine runs in two processes concurrently in the shipped topology — the exact race main.py's docstring claims to have fixed.** `OPERATIONS_MONITOR_ENABLED: "true"` is set on BOTH `api` (compose:26) and `worker` (compose:43). The API runs a 60 s thread; the worker calls `evaluate_operations` every `ingestion_maintenance_seconds` (300); and `GET /maintenance/operations/summary` (maintenance.py:46) invokes it a third time — a side-effecting GET that upserts alerts, resolves alerts and fires blocking HMAC webhooks with `time.sleep` retries inside the request thread. The careful single-generation guard at main.py:74-93 only prevents two threads inside ONE interpreter; `resolve_alert` is an unguarded UPDATE and `notify_webhook` has no idempotency key.

### 5.5

**Three 'frozen' RAG constants are Literal-typed and crash on drift; three are plain Fields that accept a silent production override.** `embedding_dimensions: Literal[768]`, `chunk_size_tokens: Literal[800]`, `chunk_overlap_tokens: Literal[100]` (config.py:21,74-75) vs `retrieval_threshold: Field(ge=0,le=1)`, `retrieval_match_count: Field(ge=1,le=20)`, `duplication_threshold: Field(ge=0,le=1)` (`:76-78`). `RETRIEVAL_THRESHOLD=0.5` is accepted at startup, leaves no trace in `paper_index_versions` (only the chunking trio is stamped), and changes the pipeline the paper reports. `Settings` also sets neither `frozen=True` nor `validate_assignment=True`, so `settings.chunk_size_tokens = 400` at runtime is accepted silently — the Literal guards construction only.

### 5.6

**Setting `RETRIEVAL_MATCH_COUNT` above `RETRIEVAL_CANDIDATE_POOL` silently disables the whole selection stage.** `pool_size = max(candidate_pool, final_count)` and the rollback lever is `if pool_size == final_count` (retriever.py:785, :810). Both settings are in range (pool 5-20, match_count 1-20), so match_count=20 makes pool_size=20==final_count: rerank, the per-paper cap and the AGGREGATE `per_paper_cap=1` are all skipped, and the context becomes 20 blocks instead of 5 — with no log line, while `release_fingerprint` still records both settings as if selection were active.

### 5.7

**`models/gemini-embedding-2` vs `models/gemini-embedding-001`: the legacy provenance backfill writes a model name retrieval can never match, and a test pins it that way.** `supabase_setup.sql:354` and `migrations/20260720_index_embedding_provenance.sql:48` insert `'models/gemini-embedding-2'` while `config.py:18` is `models/gemini-embedding-001`. Since `match_chunks` requires `piv.embedding_model = p_embedding_model`, every row that backfill created is permanently unreachable by semantic search — and `tests/test_migration_and_reindex.py:95` asserts the literal string, so the two values are pinned apart from each other. `scripts/reindex_citations.py` also refuses those papers without `--allow-model-change`.

### 5.8

**Provider capacity, guest-budget exhaustion and every refusal are HTTP 200 carrying a notice string, not 429/503.** `_capacity_response` / `_guest_budget_response` / `REFUSAL_MESSAGE` all return a normal `ChatResponse`. Anything that reads status codes — a monitor, a load test, `summarize_jmeter` — sees a healthy request. That is why `evaluation/summarize_chat_load.py` exists and bands purely on latency (`!=200` failure, `<100 ms` capacity notice, `100–2000 ms` ambiguous, `>=2000 ms` answer): `chat_summary_20u.json` reports 60×200 and 0.0% errors for a profile that answered nothing.

### 5.9

**`upload_jobs.stage` has NO CHECK constraint and three producers, and the frontend has two divergent, untested label maps.** Python emits download/malware_scan/extract/chunk/embed/screen/index; SQL independently emits `store`, `queued`, `done`, `error`, `cancelled`; the column DEFAULT is a twelfth value, `'extract'` (supabase_setup.sql:780). `wizardSteps.js:18-33` has 7 keys plus a `STAGE_ALIASES` table whose comment records the last break ('findIndex returned -1 … the whole stepper rendered inert'); `batchState.js:361` has 12 keys, different wording, no aliases and no test. Renaming a stage in `services/ingestion.py` passes all 2,143 backend tests.

### 5.10

**Two silent authorization divergences in `dependencies/auth.py`.** (1) `require_chat_access` and `require_archive_access` go through `_feature_enabled`, which falls back to DEFAULT_FEATURES; `require_novelty_access` (`:428`) and `require_upload_access` (`:445`) index the raw `get_role_features()` dict, so an unreadable `system_settings` denies faculty novelty while `GET /settings/features` still serves them `novelty: true` and the nav item renders. They also lack the `isinstance(dict)` guard, so a malformed jsonb row is a 500 rather than a 403. (2) `_require_feature` deliberately skips `_require_privileged_mfa` (documented at `:384-388`), so an aal1 admin can chat and browse while every `/upload` and `/duplication` call 403s.

### 5.11

**Per-user rate limiting silently degrades to per-IP whenever `SUPABASE_JWT_SECRET` is unset — the default.** `rate_limit_key` (rate_limiting.py:12-33) returns `user:<sub>` only when the secret is set AND the token is HS256-verifiable; `src/api.js:79-87` sends `X-Guest-ID` only when unauthenticated, so an authenticated request with no secret has no discriminator at all and falls to `ip:<addr>`. `validate_production_services` does not require the secret, and `auth.py:186-208` explicitly supports asymmetric-key projects where it cannot exist. A whole campus behind one NAT then shares 30 chat/min and 10 upload/min. slowapi also keys buckets by URL path, so the 10/minute 'shared' upload limit is actually per-path — and per-job-id for `/upload/jobs/{id}/cancel`.

### 5.12

**Guest chat turns are logged with `department = NULL` and are therefore missing from the counter shown to guests.** `services/activity.py:19-29` resolves department from the argument, then `detail['department']`, then a `profiles` lookup keyed on `user_id` — which is None for a guest. Only 2 of ~14 `chat_query` log sites pass the key (chat.py:2308, :2895). `/analytics/summary` counts `{'action':'chat_query','department': CCSICT}` (analytics.py:164-167), so the landing-page figure omits all guest fast-path traffic, and a department admin's activity feed omits it too. Four terminal branches log nothing at all: the no-evidence return (chat.py:2645) and all three capacity returns.

### 5.13

**Notice classification has three presentation layers that disagree after a reload.** `_model_response()` is built inline in chat.py:854-859 and is NOT in `NOTICE_MARKERS`, so it persists as `kind='answer'` and is replayed to the model as context. The two `SYSTEM_ORIGIN_MESSAGE` branches differ: `:2200` sets `notice_type='conversation'` (no chip) and `:2376` does not (system-notice chip) — identical text, different rendering. And `no_relevant_thesis` is not a `chat_messages` column, so `routers/sessions.py:97-101` re-derives `notice_type` from the answer TEXT, giving a reloaded no-evidence notice a different chip than the live one.

### 5.14

**Nothing in CI runs the evidence chain, and one link is uncommitted.** `.github/workflows/quality.yml` has 6 jobs (7 check-runs, because `containers` is a 2-way matrix) and invokes no script in `scripts/` or `evaluation/`. `release_fingerprint.py --output` is never called by anything — no fingerprint JSON exists under `docs/evidence/`. Meanwhile `AdminOverview.jsx` (tracked, modified) statically imports `src/data/objective2Summary.json`, which is UNTRACKED and NOT gitignored (`git check-ignore` exits 1), so a clean clone fails `npm run build`; and its pinning test skips silently when the file is absent. `docs/deck/assets/captures/manifest.json` marks `archive` and `novelty` as `mode: "fixture"`, so a default `python -m docs.deck.build` SystemExits on slide 3.

### 5.15

**`services/retriever.py` never imports `services/db_errors.py`** (grep: 0 occurrences). It carries a private `_is_missing_column_error` (`:476-482`) that checks only `.code`, the literal substring `"'code': '42703'"` and `str(error)` — no `.pgcode`, no `.details` — while the shared helper (db_errors.py:55-66) probes all of them and its docstring says 'keeping the probe in one place stops the call sites from disagreeing'. It gates five legacy-column fallbacks in retriever.py, one of which is the provenance-less overview query.

### 5.16

**`refresh_after_ingest` is an unsynchronised read-modify-write across the whole department.** `store_rescan` (novelty.py:416-431) reads `papers.duplication_scan`, merges `{'rescan': …}` and writes the column back with a plain `.update()` — no version check, no RPC. `refresh_after_ingest` snapshots `others` up front and iterates. Two overlapping ingestions in one department each clobber the other's rescan table, so one newly indexed thesis silently never appears in anyone else's screening. Reachable at `INGESTION_CONCURRENCY > 1` (config allows 8) or a scaled worker, and the function swallows every exception by design so a lost update is invisible.

### 5.17

**The on-demand novelty scan can never report `exact_duplicate`, and fixing it the obvious way breaks the endpoint.** `duplication.py:304` calls `verdict_for_concentration(top_paper_percentage)` without the flag, and `scan_history.verdict_level` carries `check (… in ('clear','review_suggested','high_overlap'))` (supabase_setup.sql:705), so passing it would 23514 the insert. The frontend already renders the label (`utils.js:251` 'Exact duplicate—not indexed'). Meanwhile the ingest path DOES raise `DuplicateManuscriptIngestionError` for the same manuscript — the two screening paths grade a verbatim copy differently. Separately the verdict grades on CONCENTRATION (25/70 bands) while `duplication_percentage`/`matched_chunk_percentage` store COVERAGE, and concentration is never persisted — the UI re-derives it from `top_matches[].match_count`.

### 5.18

**A single transient heartbeat error permanently kills an in-flight ingestion attempt with no record.** `LeaseHeartbeat.update` catches every exception and sets `_valid = False` with no path back (ingestion_worker.py:140-147). The next `_require_lease` raises `LeaseLostError`, which `process_claimed_job` catches and logs WITHOUT scheduling a retry or recording a failure — the row sits in `processing` until its 120 s lease expires and a later claim burns another of three attempts. Also: `_RETRY_DELAYS = (30, 120, 600)` but the 600 s rung is unreachable at the default `ingestion_max_attempts=3`, because the gate is `attempt_count < max_attempts` against an already-incremented counter.

### 5.19

**Three 'frozen' constants are baked into UI prose and a 3D HUD that no test compares to config.** `wizardSteps.js:21-23` reads 'Chunk (800 tokens)' / 'Embed (768d)' / 'Screen novelty (85%)'; `batchState.js:362-363` repeats them with different wording; `IngestScene3D.jsx:23-66` hardcodes '800-TOKEN SEMANTIC SLICING', '768D', 'COSINE SIMILARITY MATRIX 85%', 'GEMINI EMBEDDING 001'; `Upload.jsx:88-101` adds '768d' and '800 tok' chips. Changing `config.py` leaves four surfaces lying to users, and `release_fingerprint` does not hash any of them.

### 5.20

**`evaluate_operations`'s `retries_exhausted` alert never clears, and its job window can hide the newest work.** `exhausted = [row for row in jobs if row.get('status') == 'failed']` (operations.py:317) has no time window and no attempt-budget test — deliberately, because a malware-flagged manuscript fails on attempt 1 of 3 — so one permanently failed upload pins a `critical` alert open forever and re-notifies every 15 minutes. The job read is capped at 500 rows ordered `created_at` ASC, so past 500 open/failed jobs the NEWEST ones are invisible exactly when the queue is in trouble. And `status` is `'healthy'` whenever any worker is healthy and the scanner is up, regardless of a 10,000-deep stale queue.

### 5.21

**`/health/worker` and `evaluate_operations` disagree about what 'healthy' means, and the looser one is what a monitor pages on.** main.py:299-308 picks ONE row with `.limit(1)` and no `ORDER BY`, and calls it healthy when `scanner_status != 'unavailable'`; operations.py:284-293 requires `scanner_status in {'healthy'}` (plus `'disabled'` only when `MALWARE_SCAN_MODE=disabled`). In production a worker reporting `'unknown'` is 200-healthy on the endpoint while raising a critical `scanner_unavailable` alert, and with several workers the unordered `.limit(1)` makes the answer depend on row order.

### 5.22

**`enforce_citation_coverage` — the deterministic rung of the citation ladder — is a no-op on the ordinary grounded path.** It returns early unless every source shares one paper id (citations.py:132-133), and the grounded path selects up to 5 chunks across up to 5 papers. So a failed AI repair goes straight to `_grounded_retrieval_fallback`; the rung only does real work on the overview and exact-paper paths. Relatedly, `reports_no_evidence` substring-matches 32 phrases including 'does not mention' anywhere in the text, and that branch (chat.py:2813) SKIPS `validate_citations` and both repairs entirely.

### 5.23

**Two tracked scratch files sit at the backend root and neither is gitignored.** `rag-thesis-backend/probe7b.py` (imports `tests.test_guards_multilingual`, `exec()`s `/tmp/probe6.py`) and `rag-thesis-backend/tmp-probe/probe.py` — `git check-ignore` exits 1 for both, because `.gitignore` has `tmp/`, `tmp-pytest-*/`, `tmp-pylint-cache/` but nothing matching `tmp-probe/`. They escape pytest (`testpaths=tests`), pylint (explicit module list) and coverage — but `sonar.sources=rag-thesis-backend` analyses them as project code. `probe7b.py` cannot even import without `/tmp/probe6.py` present.

**Partly corrected, and acted on, 2026-09-22.** This finding overstated the SonarQube exposure: `sonar.exclusions` already carried `rag-thesis-backend/tmp-*/**`, so `tmp-probe/probe.py` was never analysed - only `probe7b.py` was. Both files have since been untracked (left on disk), `.gitignore` gained `tmp-*/`, `probe*.py` and a repo-wide `__pycache__/`, and `sonar-project.properties` gained `rag-thesis-backend/probe*.py`. Commit `2fcede1`.

### 5.24

**`--mode e2e` fixtures win over `.env` by Vite's define precedence, and the SPA reads `profiles` directly with the anon key.** `vite.config.js:84-89` replaces `VITE_SUPABASE_URL`/`VITE_API_URL`/`VITE_SUPABASE_ANON_KEY` as `userDefine`, which is spread AFTER `importMetaKeys`, so a real credential in `.env` cannot leak into an e2e build — do not move these to `.env.e2e`, which reverses it. Separately, `AuthContext.fetchProfile` reads `profiles` straight through supabase-js under RLS policy `profiles_select_own`; `GET /analytics/me` exists and is never called by the SPA.

### 5.25

**Pylint's `mixed-line-endings` (C0327) is the trap behind the LF rule, and it only bites locally.** `.gitattributes` `* text=auto eol=lf` keeps the index clean (verified: 0 CRLF/mixed index blobs), but 11 tracked files are CRLF in the working tree right now and `git status` shows them clean. None is currently in pylint's target list (`routers services dependencies workers main.py config.py models.py`); one CRLF write into `services/` reproduces the documented 10.00→9.94 failure while CI — which checks out fresh on Linux — stays green with no hint why.

## 6. Coupling seams

23 places where a change in one file silently requires a change in another. The ones with no test are the dangerous ones - they pass the whole suite and fail at runtime or in front of a user.

### 6.1

**New backend router prefix ⇒ `rag-thesis-frontend/vite.config.js:93-105` proxy entry.** Eight prefixes are plain string targets; `/upload`, `/chat` and `/settings` need `spaAwareApiProxy` because they are also React routes (its `bypass` returns `/index.html` only for GET + `Accept: text/html`). The reverse coupling is a latent trap nothing documents: a NEW React route starting with `/papers`, `/analytics` or `/departments` would be swallowed by the proxy in dev and work in the container, where nginx `try_files` serves index.html.

### 6.2

**New custom request header in `src/api.js` ⇒ `main.py:198` `allow_headers`; new response header the browser must read ⇒ `:200` `expose_headers`; new router verb ⇒ `:197` `allow_methods`.** No test pins any of the three (`grep allow_headers tests/` is empty). The comment at `:191-196` records that PATCH was already missing once, making two documented superadmin routes unreachable from any browser while working from curl and `/docs`. Dropping `X-Guest-Verification` from `expose_headers` makes `useGuestChatGate.js:67` permanently deaf — guests get a bare 403 with no challenge.

### 6.3

**Bump `CHUNKING_VERSION` / `PREPROCESSING_VERSION` / the 800/100/768 literals in Python ⇒ six SQL sites.** `supabase_setup.sql:335-337` (CHECK `verified_index_provenance_is_current`), `:357-363` (backfill CASE), `:489-491` (`commit_paper_ingestion` validation) and the same three blocks at `migrations/20260720_index_embedding_provenance.sql:24-26,52-58,133-135`. No test compares SQL to Python — `test_schema_consistency.py` is SQL-vs-SQL only. The failure is every ingestion raising 'Verified 768-dimensional index provenance is required', retrying three times and landing in `failed`, with a green suite.

### 6.4

**Change any of 800 / 100 / 768 / 0.85 ⇒ four frontend prose surfaces.** `wizardSteps.js:21-23`, `batchState.js:362-363` (same numbers, different wording), `IngestScene3D.jsx:23-66` (the 3D HUD), `Upload.jsx:88-101` (telemetry chips). None is compared to `config.py` by any test, and none is hashed by `release_fingerprint`.

### 6.5

**Rename a worker stage in `services/ingestion.py` ⇒ `wizardSteps.js:18-33` PIPELINE_STAGES + STAGE_ALIASES AND `batchState.js:361` STAGE_LABELS.** Two divergent frontend maps (7 keys with aliases vs 12 keys without), only the first with a test. `upload_jobs.stage` has no CHECK constraint, SQL independently emits `store`/`queued`/`done`/`error`/`cancelled`, and the column default is a twelfth value `'extract'` — so nothing on the backend enumerates the legal set and pytest cannot catch a rename.

### 6.6

**Edit the role×feature matrix ⇒ four copies.** `routers/settings.py:18-21` DEFAULT_FEATURES (+ `_FEATURE_ROLES`/`_FEATURE_NAMES` at `:22-23`), `supabase_setup.sql:746` seeded jsonb, `src/lib/permissions.js:10-13` DEFAULT_ROLE_FEATURES, and two inline array literals at `SystemManagementTab.jsx:90,95` that build the PUT payload. `_validated_features` demands the exact {student,faculty} × exactly-four-boolean shape, so a backend-only addition makes every superadmin save 422. No test compares any pair.

### 6.7

**Reword `PRIVILEGED_MFA_REQUIRED_DETAIL` (auth.py:224) ⇒ `src/lib/privilegedMfa.js:16`.** The frontend matches the lowercase substring `'multi-factor authentication is required'`; `tests/test_auth_authorization.py:200-223` pins the full backend sentence across five guards, so a rewording turns the backend test green in the same commit and leaves `PrivilegedMfaGate` silent — an admin verified by emailed OTP sees a UI whose every privileged call 403s with no enrolment prompt.

### 6.8

**Change any notice string in `services/chat_notices.py` ⇒ `NOTICE_MARKERS`, the two backfill migrations, and the frontend chip logic.** `is_stored_non_answer` prefix-matches `marker[:60]`, so no two notices may share a 60-char prefix (`test_chat_notices.py:259`), and every marker a pre-migration build could emit must appear as a ≤48-char normalised fragment in `20260804_chat_message_kind.sql` or `20260825_notice_kind_greeting_and_fallback.sql` unless listed in `MARKERS_WITHOUT_HISTORICAL_ROWS` (`:296-321`). A notice defined outside `NOTICE_MARKERS` (as `_model_response()` is) persists as `kind='answer'` and is replayed to the model.

### 6.9

**Add a root-level Python module imported by either entrypoint ⇒ `Dockerfile:56-61` COPY list.** `tests/test_dockerfile_contents.py` AST-resolves only the DIRECT imports of `main.py` and `workers/ingestion_worker.py`, so a module imported transitively through a service passes the test and ModuleNotFoundErrors the container — the exact class of bug the test was written for (commit da9e931, `warning_filters.py`). `is_copied` also treats a package as covered if ANY path under it is copied, and only `scripts/gemini_release_smoke.py` is.

### 6.10

**Edit `requirements.txt` ⇒ regenerate `requirements.lock` in the same commit** (Linux-resolved, `--generate-hashes`, py3.14). `tests/test_dependency_lock.py` cross-checks every direct pin, every `--hash=sha256:` (2,353 lines), the 'linux' header marker, tesserocr+tessdata-eng presence, and `cryptography` major ≥ 50 in BOTH files. Note CI's pip cache is keyed on `requirements.lock`, so a txt-only edit gets a cache hit and installs the stale set.

### 6.11

**Move the Python patch version ⇒ five files.** `Dockerfile:27` (the only mechanically enforced one, via a build-time assert), `.github/workflows/quality.yml:47`, `README.md:74`, `paper/build_corrections.py:184` (the paper's version table) and `evaluation/iso25010_evidence.md:952`. The Dockerfile comment naming the coupling omits the evidence file, and the evidence file's own anchor for the CI pin is stale (cites `:33`, actual `:47`).

### 6.12

**Change a `select()` field list or add a column ⇒ `tests/test_hardening_fixes.py:701`.** It regex-parses every CREATE TABLE and ALTER TABLE ADD COLUMN in `supabase_setup.sql` + `migrations/` and asserts the six pinned SELECT lists (`analytics._PROFILE_FIELDS`, `_ACTIVITY_FIELDS`, `sessions._SESSION_FIELDS`, `_MESSAGE_FIELDS`, `operations.ALERT_FIELDS`, `WORKER_FIELDS`) EQUAL the declared column sets, not merely subset them. A migration adding a column to `profiles` fails the suite until the Python list is extended.

### 6.13

**Add or re-annotate any route ⇒ regenerate `docs/evidence/contracts/iskai-openapi.current.json`.** `tests/test_export_openapi.py:27` asserts byte-equality against `scripts.export_openapi.render_openapi()`. Adding a query parameter anywhere is a CI failure until the snapshot is regenerated — the same footing as `PROMPT_VERSION`.

### 6.14

**Edit prose in `README.md`, the frontend/jmeter READMEs or `iso25010_evidence.md` ⇒ `tests/test_readme_accuracy.py`.** It pins: every migration-only table named in backticks, every relative link resolving, all four current JMeter plans existing and listed (and the superseded one NOT presented as runnable), `npm run <script>` for lint/test:coverage/build/bundle:budget appearing in the ROOT README (currently satisfied by one chained line at `README.md:293`), the frontend README's npm version matching `packageManager`, the admin-tab count spelled in words matching `lazy(() => import('./admin/` occurrences in `Admin.jsx`, and SonarQube build `26.7.0.124771`.

### 6.15

**Rename the `useSceneRuntime` hook or drop it from one scene ⇒ `scripts/check-bundle-budget.mjs:40-49` MUST_STAY_LAZY.** The guard matches chunk-name PREFIXES, and `useSceneRuntime` names the three.js chunk only because it is the module HeroScene, AuthScene and IngestScene3D happen to share. Rename it and the prefix stops matching: the check passes silently while the guarantee is gone, leaving only the 330 kB total as a backstop (current headroom: 5.3 kB).

### 6.16

**Change `nginx/default.conf.template`'s CSP ⇒ `index.html`'s Google Fonts links, `docker-compose.operations.yml:58-61`'s envsubst variables, and `src/design/fontDelivery.test.js`.** Three placeholders (`${API_ORIGIN}`, `${SUPABASE_ORIGIN}`, `${SUPABASE_WS_ORIGIN}`) but only two are pinned by `test_operations_security.py:282`, and neither `PUBLIC_API_ORIGIN` nor `SUPABASE_WS_ORIGIN` appears in any `.env.example` or the README. envsubst substitutes a missing variable with the empty string, so an unset `SUPABASE_WS_ORIGIN` yields a syntactically valid CSP that silently blocks the `global_feature_updates` realtime channel.

### 6.17

**Replay `supabase_setup.sql` or an older migration after a newer one ⇒ silent behavioural revert.** Everything is `create or replace function`, and 14 functions are redefined across migrations (pinned as an exact set by `test_schema_consistency.py:246`). Concretely: the base file ships the PRE-CANCELLATION bodies of `claim_upload_job`, `claim_upload_cleanup`, `expire_upload_jobs` and `schedule_upload_retry`, so a replay strands cancelled jobs' PDFs and lets a cancel-requested job be re-claimed. `migrations/20260717_rag_items_9_16.sql:96` additionally DROPs and re-creates a 4-arg `match_chunks` overload with no provenance join and no `ef_search`, which would coexist alongside the 7-arg one.

### 6.18

**Change `PROMPT_VERSION` or any wording in `services/prompts.py` ⇒ `evaluation/iso25010_evidence.md` + a re-run.** `tests/test_prompt_contracts.py` asserts all 11 SHARED_RULES markers appear in all four generation prompts, that an unknown `question_type` composes byte-identically to the untyped form, that repair prompts carry CITATION+OUTPUT but never EVIDENCE, and that `manifest['prompt_version'] == prompts.PROMPT_VERSION` — but nothing forces the version string to MOVE when the text changes. Only `run_comparison`'s checkpoint-provenance guard catches it, and only on a resume.

### 6.19

**Change a `match_chunks` parameter name in SQL ⇒ three hand-written Python dicts.** `retriever.py:786-795`, `duplication.py:135-140`, `novelty.py:353-358` — no shared builder. supabase-py passes RPC args by name, so a rename is a runtime-only failure every test misses (the stubs accept any key), and `novelty.py`'s call site has no parameter assertion at all. Note two of the three deliberately omit `p_thesis_category` entirely rather than passing null, so the RPC must tolerate a missing named parameter.

### 6.20

**Add a `select('*')` anywhere in production code ⇒ `tests/test_hardening_fixes.py:590` AST scan fails** (self-guarded by a planted wildcard). Likewise, calling any of 34 blocking helpers outside an `await` inside an `async def` in `routers/`/`services/`/`main.py` fails `test_event_loop_responsiveness.py:449` — a substring match on the call's source segment, so renaming a helper or aliasing an import silently removes it from the audit.

### 6.21

**Bump `EXPECTED_PAPER_COUNT` in `scripts/corpus_manifest.py:21` ⇒ the paper's Sections 1.3 / 3.1.3 / 3.2.1, `corpus_manifest.template.json`, and a new corpus ID with four fresh approvals.** `tests/test_corpus_manifest.py` (26 tests) pins 12, and `lock` is write-once (`open(mode='x')` on both outputs, with the manifest unlinked if the receipt write fails).

### 6.22

**Regenerate the Objective 2 run ⇒ `scripts/export_objective2_summary.py`'s pinned constants, `tests/test_objective2_summary_export.py`'s expected figures, `src/data/objective2Summary.json`, `evaluation/iso25010_evidence.md`, `docs/evidence/OBJECTIVE_2_COMPARISON_2026-09-13.html` (hand-written, no generator) and Section 3.2.5.** `SOURCE`/`RUN_ID`/`RUN_DATE`/`QUOTED_STRATUM` are hardcoded, and the test asserts the `present` stratum stays n=16 / p=0.1257 / NOT significant with a CI straddling zero — so a run where it becomes significant is a deliberate, forced paper edit.

### 6.23

**Add a `Literal` value to `chat_notices.NOTICE_TYPE_CONVERSATION` or `ChatResponse.notice_type` ⇒ three places.** The literal `'conversation'` is written seven times in `routers/chat.py` (2137, 2153, 2172, 2186, 2204, 2340, 2360) instead of the constant, plus `models.ChatResponse.notice_type: Literal['conversation']` and `messageNotice.js:31`.

## 7. Verified risks

24 correctness, consistency and security problems, each read in source and cross-checked against its counterpart before being recorded. These are observations, not a work order - several are inert in the current deployment and say so.

### 7.1

**`get_paper_overview_context` serves chunk text with no index-provenance verification, and its legacy fallback drops even the index filter.** Grep confirms `retrieval_provenance_params()` has exactly four call sites and this is not one of them. `services/retriever.py:592-597` filters only `paper_id` + `papers.active_index_version`; `:610-615` (the 42703 fallback) filters only `paper_id`, so it can interleave chunks from every index generation with duplicate `chunk_index` values feeding citation numbering. Every resolved follow-up — 'number 2', ordinal, title fragment, quoted title, author — takes this path. A paper whose active index is unverified or built under a different embedding model is invisible to `match_chunks` and fully readable here.

### 7.2

**`docker-compose.operations.yml` runs the alert state machine in two processes and cannot boot from the documented env surface.** `OPERATIONS_MONITOR_ENABLED: "true"` on api (`:26`) and worker (`:43`) makes both call `evaluate_operations`, plus a third invocation on every superadmin `GET /maintenance/operations/summary` — the exact `upsert_alert`/`resolve_alert` flap `main.py:74-93`'s docstring says it fixed, where that guard is per-interpreter only. `resolve_alert` is an unguarded UPDATE and `notify_webhook` has no idempotency key, so duplicate HMAC webhook deliveries and open/resolved flapping are both reachable. Separately the file forces `APP_ENVIRONMENT: production` but supplies only 2 of the 4 preconditions `config.py:242-263` requires; `REQUIRE_PRIVILEGED_MFA` (False) and `GUEST_DAILY_TOKEN_BUDGET` (0) both default to rejected values and are commented out at `.env.example:158` and `:112`.

### 7.3

**The worker container is permanently `unhealthy` and the API container can never be marked unhealthy.** `rag-thesis-backend/Dockerfile:80` bakes a HEALTHCHECK that urlopens `http://localhost:8000/health`; the `worker` service overrides `command:` but not the healthcheck (compose:34-47) and serves no HTTP, so it fails 3 retries and stays failed. Conversely `/health` returns HTTP 200 unconditionally (main.py:278-286) with `status: 'degraded'` only in the body, so a broken schema contract still reads healthy to Docker. `/ready` is the probe that returns 503 and nothing uses it — it is also absent from the Vite dev proxy.

### 7.4

**Setting `RETRIEVAL_MATCH_COUNT` above `RETRIEVAL_CANDIDATE_POOL` silently disables reranking, the per-paper cap and the 5-block guarantee.** `pool_size = max(candidate_pool, final_count)` (retriever.py:785) with the lever `if pool_size == final_count` (`:810`). Both are env-settable within their declared ranges. At match_count=20 the context becomes 20 pure-cosine blocks, `per_paper_cap=1` for AGGREGATE questions is ignored, and nothing logs it while `release_fingerprint` still records both values.

### 7.5

**The legacy provenance backfill writes `models/gemini-embedding-2` into rows that `match_chunks` can then never return, and a test pins the literal.** `supabase_setup.sql:354` and `migrations/20260720_index_embedding_provenance.sql:48` vs `config.py:18` (`models/gemini-embedding-001`), with `tests/test_migration_and_reindex.py:95` asserting the wrong one. Those rows are also refused by `scripts/reindex_citations.py:168` without `--allow-model-change`, so the `legacy_assumed` provenance status and `is_embedding_compatible`'s acceptance of it are dead for exactly the rows they were written for. `activate_paper_index` compounds it by checking only `provenance_status`, never the embedding model — an incompatible index can be activated successfully and then return zero rows forever while the admin UI shows the paper as `ready`.

### 7.6

**`refresh_after_ingest` loses updates under concurrency, silently.** `store_rescan` (novelty.py:416-431) does a read-modify-write of `papers.duplication_scan` with a plain `.update()`, no `if_version`, no RPC; `refresh_after_ingest` (`:446`) snapshots the department's `others` list and iterates. Two overlapping ingestions each clobber the other's `rescan` table, so one thesis never appears in the other papers' screening. `config.py:136` allows `ingestion_concurrency` up to 8, and the function swallows every exception by design (`:485-487`, `:514-515`).

### 7.7

**Rate limiting degrades to a single per-IP bucket on any asymmetric-key Supabase project.** `services/rate_limiting.py:12-33` mints `user:<sub>` only when `settings.supabase_jwt_secret` is set (default `''`, config.py:186) and HS256 verification succeeds; `src/api.js:79-87` omits `X-Guest-ID` for authenticated sessions, so the fallback is `ip:<addr>`. `validate_production_services` never requires the secret, and `auth.py:186-208` explicitly supports projects where it cannot exist. slowapi additionally keys per URL path, so the documented 'shared' 10/minute upload limit is per-endpoint and per-job-id for cancellation.

### 7.8

**A single transient heartbeat exception permanently poisons an ingestion attempt with no failure record.** `LeaseHeartbeat.update` sets `_valid = False` on any exception with no recovery path (ingestion_worker.py:140-147); `_require_lease` then raises `LeaseLostError`, which `process_claimed_job` catches and logs without calling `schedule_retry` or `fail_job` (`:184-185`). The row sits in `processing` until the 120 s lease expires and a later claim consumes another of three attempts. Also `_RETRY_DELAYS[2]` (600 s) is unreachable at the default `ingestion_max_attempts=3` because `schedule_retry` is gated on `attempt_count < max_attempts` against a post-incremented counter.

### 7.9

**Guest activity is written with `department = NULL` and is therefore excluded from the public counter that quotes it.** `services/activity.py:19-29` falls back to a `profiles` lookup only when `user_id` is truthy; 12 of ~14 `chat_query` log sites omit `detail['department']`. `routers/analytics.py:164-167` counts `chat_query` filtered on `department = CCSICT`, so the landing figure systematically undercounts guest traffic, and `/analytics/activity` and `/analytics/logs/system` (department-filtered for admins) omit it entirely. Four terminal branches log nothing at all — the no-evidence return (chat.py:2645) and all three capacity returns — so a tripped 60 s cooldown swallows a minute of traffic from every dashboard.

### 7.10

**The on-demand novelty verdict cannot express `exact_duplicate`, and the one-line fix would 23514 the insert.** `routers/duplication.py:304` omits the flag; `supabase_setup.sql:705` constrains `scan_history.verdict_level` to three values; `rag-thesis-frontend/src/lib/utils.js:251` already renders the fourth. A reviewer pre-scanning a verbatim archived thesis is told 'High overlap', while uploading the same file raises `DuplicateManuscriptIngestionError` and refuses the ingest. The verdict also grades on concentration while the persisted `duplication_percentage`/`matched_chunk_percentage` store coverage, and concentration is never persisted at all — the UI re-derives it from `top_matches[].match_count`, so an all-matched-papers-deleted scan renders 0.00% under a `high_overlap` badge.

### 7.11

**`_persist_turn` is the one write on `scan_history` with no owner predicate, in a file that defends against exactly that elsewhere.** `routers/duplication.py:77-89` does `.update({'chat_log': updated}).eq('id', scan_id)` with no `user_id` filter, while the two delete endpoints carry it on both read and write with a comment explaining 'so a guessed id cannot remove another account's row even if the check above were ever reordered away' (`:591-606`). Ownership today rests entirely on statement ordering (the `.eq('user_id', …)` read at `:466-471`). It is also a lost-update read-modify-write, so two concurrent follow-ups drop a turn.

### 7.12

**`routers/duplication.py:505-512` builds the follow-up prompt from EVERY entry in `matched_chunks` with no slice and no character cap**, while the conversation history immediately above it is capped at `chat_log[-5:]` and fenced through `prompts.fence_untrusted`, and `followup_rewrite_prompt` caps its untrusted turns at 4000/300 chars. A heavily-matched long manuscript produces a prompt that grows linearly with the match count and either exceeds context (permanent 502 on every follow-up for that scan) or is silently truncated provider-side.

### 7.13

**`services/retriever.py` re-implements `is_missing_column` privately and never imports `services/db_errors.py`** (grep: 0 occurrences). `_is_missing_column_error` (`:476-482`) checks only `.code`, the literal `"'code': '42703'"` substring and `str(error)`, while the shared helper also probes `.pgcode` and `.details`/`.message` and exists specifically so call sites cannot disagree. It gates five legacy fallbacks, including the provenance-less `get_paper_overview_context` query — so an SDK that surfaces the SQLSTATE differently makes retriever.py re-raise where every other router degrades.

### 7.14

**`PUT /settings/features` still carries the update-then-insert race its sibling's comment says was removed.** `routers/settings.py:67-78` updates, and on an empty result inserts; two concurrent first-writes both insert and the loser hits a 23505 that nothing catches, surfacing as a 500. `:47-55` documents exactly this shape as the reason `GET /settings/features` stopped inserting, and `services/db_errors.is_unique_violation` already exists to classify it.

### 7.15

**Role and feature caches are per-process with no cross-process invalidation, in a deployment that presumes replicas.** `_FEATURES_CACHE` (auth.py:324-348) has a 60 s TTL and, unlike `_ROLE_CACHE`, no lock; `invalidate_features_cache()` and `invalidate_role_cache()` clear only the process that served the write, and nothing on the backend subscribes to the `global_feature_updates` realtime channel the frontend uses. `config.py:246` refuses to start in production without a shared Redis store, i.e. the design anticipates more than one API replica — so revoking `upload`/`novelty` or demoting an admin stays unenforced elsewhere for up to 60 s. `services/turnstile.py:11-13` documents the same assumption explicitly; these two do not.

### 7.16

**`BodySizeLimitMiddleware`'s 413 carries no OWASP headers, contradicting the comment above it.** Registration order (main.py:155-187) yields CORS → BodySizeLimit → security_headers → GZip → SlowAPI, and `_send_too_large` (request_limits.py:80-92) writes straight to the outer `send`, bypassing `security_headers`. The block at main.py:182-186 asserts that registering CORS last means 'every response carries its headers — including rate-limit rejections and errors raised inside the inner middleware', which holds for CORS and not for the security headers, on the one response path an unauthenticated caller can trigger.

### 7.17

**LangSmith tracing is primed only in the API process, so the worker traces manuscript text without the redaction flags.** `main.py:42-52` `setdefault`s `LANGSMITH_HIDE_INPUTS`/`HIDE_OUTPUTS` from `config.py:195-196` (both default True); `workers/ingestion_worker.py` has no equivalent block (grep for LANGSMITH: no hits) while sharing the same `env_file` (compose:22, :37). Enabling tracing in `.env` therefore gives the process that handles extract → chunk → embed unredacted tracing, because the protective default only exists in Python and only main.py pushes it into the environment. `.env.example:188-189` ships both commented out.

### 7.18

**`uvicorn.access` bypasses `PrivacyFilter` entirely.** `configure_safe_logging` attaches the filter to the root logger and to root's handlers at call time, but uvicorn's `LOGGING_CONFIG` gives `uvicorn.access` its own handler with `propagate: False`, and nothing in the repo passes a `log_config`. Since `redact_log_text` explicitly strips URL query strings, the one logger that prints request lines is the one not covered. `configure_safe_logging()` also runs AFTER `from config import settings` and the `Limiter` construction (main.py:30-39), so anything those imports log goes out unredacted.

### 7.19

**`/docs`, `/redoc` and `/openapi.json` are exposed in every environment** — no `docs_url`/`redoc_url`/`openapi_url` override exists anywhere in the repo — and they are the documented invocation path for at least one superadmin operation (the CORS comment at main.py:191-196 records PATCH catalog routes 'working perfectly from curl and the OpenAPI docs page' while unreachable from a browser). Seven endpoints have no frontend binding at all, including `POST /maintenance/retention/run?apply=true`, which permanently deletes audit history.

### 7.20

**`acknowledge_alert` and `run_retention` put `record_security_event` inside the same try that maps to 503** (maintenance.py:100-133). The mutation has already committed when the audit write fails, so the operator is told the action failed while retention rows are permanently gone and no audit record exists. `routers/upload.py:1256-1261` wraps the identical call in its own try/except precisely to avoid this.

### 7.21

**`_fetch_all` pages with `.range()` and no `ORDER BY`** (analytics.py:76-109). Page boundaries past `db-max-rows` are undefined, so `per_track`, `per_year`, `total_chunks` and `avg_duplication_percentage` can double-count or skip rows while the `count='exact'` totals stay correct — which is what hides it. Worse, `routers/papers.py:30-37` (`GET /papers`, the whole archive) never got the pager at all: one unpaged `.execute()`, so the archive silently truncates at 1000 ready papers and 'Showing N of M indexed theses' reports a wrong M.

### 7.22

**Two committed scratch files at the backend root escape every gate except SonarQube.** `probe7b.py` (45 lines; `exec()`s `/tmp/probe6.py`, imports `tests.test_guards_multilingual`, cannot import without that tmp file) and `tmp-probe/probe.py` (35 lines) — `git check-ignore` exits 1 for both because `.gitignore` has no `tmp-probe/` pattern. Outside `testpaths=tests`, outside the pylint module list, outside `--cov`, not in the Dockerfile COPY list — but inside `sonar.sources=rag-thesis-backend`.

### 7.23

**The Objective 2 admin card cannot build from a clean clone.** `rag-thesis-frontend/src/pages/admin/AdminOverview.jsx` is tracked and modified to `import OBJECTIVE2 from '../../data/objective2Summary.json'`, and that file is untracked and NOT gitignored (verified). `tests/test_objective2_summary_export.py` is `skipif(not SOURCE.exists() or not OUT.exists())`, so the pin that would catch the drift silently skips in exactly the state where the file is missing. Its generator also refuses to run without `evaluation/results/checkpoints/5e8fb7f21db6.provenance.json`, which is covered by the `evaluation/results/` ignore.

### 7.24

**The deck cannot be built with default flags.** `docs/deck/assets/captures/manifest.json` records `archive` and `novelty` as `"mode": "fixture"` (verified), and `Captures.get()` SystemExits on any non-live entry unless `--allow-fixture-captures`; both keys are consumed by slides 3 and 7. `--allow-missing` does not rescue it because the mode check runs after the existence check. So the only buildable deck today puts fabricated `/archive` and `/novelty` screenshots on the objective-3 slide.

## 8. Subsystem index

21 subsystems. Full detail - control flow, public surface, invariants, gotchas, the tests that pin them, and the adversarial fact-check for each - is in the linked file.

### Backend subsystems

Detail: [`analysis/SUBSYSTEMS_BACKEND.md`](analysis/SUBSYSTEMS_BACKEND.md)

| Subsystem | What it is | Gotchas logged |
|---|---|---|
| `bootstrap` | Builds the two processes that run from one image — the FastAPI API (`main:app`) and the durable ingestion worker (`workers.ingestion_worker`) — from a single pydantic-settings object load... | 26 |
| `chat-router` | `POST /chat` is the single generation-phase entrypoint: it turns one user message into either a deterministic system notice (no model call), a catalog/metadata answer read straight from P... | 33 |
| `retrieval` | This is the evidence-selection half of the RAG pipeline: it turns a natural-language question into exactly five numbered, metadata-rich context blocks and a parallel `sources` list that c... | 22 |
| `prompts-guards-llm` | This is the layer between `routers/chat.py`'s RAG orchestration and the Gemini provider | 24 |
| `upload-router` | This is the write-side entry point of the thesis archive: it authenticates an uploader against the role-feature matrix, validates and hashes a PDF, resolves the manuscript's department/pr... | 23 |
| `ingestion-pipeline` | Runs thesis-PDF ingestion out of process, so the API never blocks on parsing, OCR, embedding, or duplication screening | 31 |
| `novelty` | Screens manuscripts for topic overlap against the departmental thesis archive at a fixed 0.85 cosine-similarity threshold, implementing the paper's Section 1.3 "Duplication Parameter" and... | 28 |
| `authz` | The backend holds the Supabase service-role key, so Postgres RLS is bypassed on every query and *all* identity, role, department and feature enforcement happens in Python | 25 |
| `other-routers` | This is the institutional-administration half of the API: the landing-page and admin dashboard statistics, user/role administration and the audit log (`routers/analytics.py`), archive met... | 35 |
| `database` | Defines the entire persistence and transactional contract for the RAG thesis library: 20 tables, 31 functions (7 trigger functions + 24 callable RPCs), one HNSW vector index, and the RLS... | 21 |

### Frontend subsystems

Detail: [`analysis/SUBSYSTEMS_FRONTEND.md`](analysis/SUBSYSTEMS_FRONTEND.md)

| Subsystem | What it is | Gotchas logged |
|---|---|---|
| `fe-core` | This subsystem is the entire client-side contract with the backend and with Supabase: one axios instance that is the only transport to FastAPI, a React Router 8 route table split into a f... | 30 |
| `fe-chat` | Renders the single user-facing RAG surface: a request/response (NOT streaming) chat against `POST /chat`, with citation-grouped evidence cards, an 85% duplication banner, per-message prov... | 23 |
| `fe-upload-archive` | The four privileged React routes that put manuscripts into the pgvector archive and read them back out: a 4-step single-file upload wizard with client-side polling of the durable ingestio... | 31 |
| `fe-admin-auth` | The privileged and account-management half of the React SPA: the four-tab administration console (/admin), the six-section account surface (/settings), the multi-step sign-in card (/login... | 37 |
| `fe-design` | Supplies the whole React app with a runtime-generated Material 3 colour system (three seed palettes x light/dark x standard/high-contrast), a Tailwind v4 token layer, ~23 shared UI primit... | 51 |
| `fe-quality` | Three independent gate layers guard the React client: (1) Node's built-in test runner over 22 colocated `*.test.js` files covering only pure, importable JS helpers — no JSX, no DOM, no Re... | 26 |

### Platform, evaluation and documentation subsystems

Detail: [`analysis/SUBSYSTEMS_PLATFORM.md`](analysis/SUBSYSTEMS_PLATFORM.md)

| Subsystem | What it is | Gotchas logged |
|---|---|---|
| `be-scripts` | Twenty-three operator-run entrypoints that live outside the API and worker processes: release/evidence generators (release_fingerprint, export_openapi, export_objective2_summary, gemini_r... | 37 |
| `evaluation` | This subsystem produces the paper's Objective 2 finding (does RAG beat an unaugmented Gemini baseline on the same forty faculty-validated questions?) and its Objective 4 performance/quali... | 37 |
| `be-tests` | 54 test modules plus `conftest.py` that collect 2,143 tests and run in ~37 seconds with zero real I/O (measured: `2140 passed, 3 skipped in 36.62s` on the repo's `.venv`) | 18 |
| `docs-paper` | This subsystem is the thesis artifact's evidentiary layer: it is what a defense panel reads, opens and checks, and several parts of it are executable rather than prose | 27 |
| `ci-repo` | A single GitHub Actions workflow (`.github/workflows/quality.yml`) is the ISO/IEC 25010 evidence instrument for the thesis's Objective 4: six jobs that install hash-verified dependencies,... | 25 |

## 9. Flow index

12 flows traced end to end across frontend, API, services, worker and SQL. Full step tables with anchors, plus branches, failure modes, persistence and surprises: [`analysis/FLOWS.md`](analysis/FLOWS.md).

Quote the number or the title to pull one up, e.g. "read flow 6 in `docs/analysis/FLOWS.md`".

| # | Flow | Trigger | Steps | Branches | Failure modes |
|---|---|---|---|---|---|
| 1 | [Guest asks a question from the public landing page](analysis/FLOWS.md#1-guest-ask) | A visitor on `/` clicks one of the four guest-chat CTAs (rag-thesis-frontend/src/pages/landing/Hero.jsx:154, Hero.jsx... | 59 | 13 | 25 |
| 2 | [Authenticated user asks a substantive question (the full RAG path)](analysis/FLOWS.md#2-auth-ask) | User types a question into the composer textarea on /chat and presses Enter (or Ctrl/Cmd+Enter when `sendKey === 'ctr... | 75 | 16 | 28 |
| 3 | [Follow-up referencing an earlier numbered source, ordinal, or author](analysis/FLOWS.md#3-followup) | A user (guest or authenticated) submits a chat message that contains a reference resolvable only from the conversatio... | 59 | 18 | 20 |
| 4 | [Refusal, notice and capacity-degradation paths](analysis/FLOWS.md#4-refusals) | A user (guest or signed-in) submits a message in the composer on /chat. `Chat.jsx::send` (rag-thesis-frontend/src/pag... | 44 | 13 | 26 |
| 5 | [Single PDF submitted through the upload wizard](analysis/FLOWS.md#5-upload-submit) | An authenticated user whose role-feature matrix grants `upload` navigates to /upload, drops a PDF on the Dropzone, co... | 52 | 12 | 36 |
| 6 | [Worker picks up a queued job and makes the paper searchable](analysis/FLOWS.md#6-worker-ingest) | `queue_upload_job` has flipped an `upload_jobs` row from `staging` to `status='queued', stage='queued', progress=8, s... | 48 | 11 | 25 |
| 7 | [Batch upload and admin job monitoring](analysis/FLOWS.md#7-batch-upload) | An authenticated user whose role has the `upload` feature (or any admin/superadmin) navigates to `/upload/batch` (rag... | 56 | 14 | 39 |
| 8 | [On-demand novelty / duplication scan](analysis/FLOWS.md#8-novelty-scan) | A faculty/admin/superadmin user drops or picks a `.pdf` or `.txt` file in the Novelty Check dropzone (`rag-thesis-fro... | 45 | 12 | 22 |
| 9 | [Account lifecycle: sign-up, approval, MFA, privileged access](analysis/FLOWS.md#9-account-lifecycle) | A visitor opens /login, switches to the "Create account" tab and submits SignUpForm (rag-thesis-frontend/src/pages/au... | 46 | 15 | 28 |
| 10 | [Browsing, filtering and reading the archive](analysis/FLOWS.md#10-archive-browse) | A signed-in user navigates to `/archive` — by clicking the "Thesis Library" nav item (`rag-thesis-frontend/src/compon... | 40 | 10 | 18 |
| 11 | [Admin console: analytics, operations, maintenance, settings](analysis/FLOWS.md#11-admin-ops) | An authenticated admin or superadmin navigates to /admin (or switches tabs inside it). Secondary triggers: Operations... | 70 | 14 | 19 |
| 12 | [Producing defense evidence: evaluation, fingerprint, load test, deck](analysis/FLOWS.md#12-evidence-pipeline) | An operator manually invokes one of five commands from a developer machine: `python -m evaluation.run_comparison [--f... | 50 | 13 | 19 |

## 10. Under-described features

Capabilities present in the code but absent or under-described in `README.md`, `CLAUDE.md` and `DEFENSE_WALKTHROUGH.md`. Each was located in source. 18 findings.

- **Whole second answering mode in chat: deterministic archive inventory / count / paginated enumeration, with a conversation-level listing cursor. Asking "how many theses are indexed?", "list the theses available here", or the Filipino/Ilocano equivalents bypasses pgvector AND the LLM entirely and is answered from `list_archive_papers` with a hand-built markdown numbered list carrying `[n]` markers; a follow-up ("any others", "what are those?", "is that all") continues from an offset derived by replaying the session history. Page size is 10 (`_ARCHIVE_INVENTORY_LIMIT`). It returns `kind='answer'` with real `sources`, so those sources become the `reference_sources` that "number 2" later indexes into.**
  - The chat map describes the fast paths as "greeting, identity, thanks, farewell, capabilities; these return kind='notice' with no retrieval". This path is none of those: it retrieves (from the papers table), returns an answer not a notice, ships sources, and is stateful across turns. No map or flow mentions it, yet it is the answer a user gets for the most obvious question they can ask the archive.
  - `rag-thesis-backend/routers/chat.py:510 (_ARCHIVE_INVENTORY_LIMIT=10), :874 (_is_archive_inventory_question), :940 (_matches_local_count), :947 (_is_archive_count_confirmation), :957 (_is_archive_count_question), :982 (_is_archive_continuation_question), :1015 (_archive_listing_cursor), :1045-1119 (_archive_inventory_response), :2282-2320 (the dispatch); rag-thesis-backend/services/retriever.py:407 (list_archive_papers)`

- **Every ordinary chat question also runs an 85%-threshold topic-duplication check in parallel with retrieval, and a flagged hit renders a red "Potential topic duplication — NN.NN% similarity" card naming the matched thesis, plus a second Gemini call (`_summarize_duplication`) that writes a prose summary of the matched study. The alert is persisted into `chat_messages.duplication_alert` and re-rendered when the session is reopened. For guests it charges the token budget a second time.**
  - The novelty flow dismisses this as "the third, unrelated check_topic_duplication path used only by chat" and the maps only list the function signature. Nothing describes it as a user-facing feature — that proposing a topic in chat produces a plagiarism-style advisory with its own LLM-written blurb, or that it costs a second model call on the critical path of every retrieval question.
  - `rag-thesis-backend/routers/chat.py:1969-1986 (check_duplication gathered with search_chunks), :1888 (_summarize_duplication), :1998-2001, :2713-2729, :2902; rag-thesis-frontend/src/pages/Chat.jsx:365-400 (DuplicationBanner), :766`

- **Twelve distinct labelled conversational fast paths exist, not five. Four are entirely undescribed: `model_identity` ("what model are you?" → a reply that interpolates `settings.gemini_chat_model`, so any guest can read the configured model name), `archive_inventory`, `system_identity` (Filipino "ano ba itong system na ito", gated on there being no reference_sources), and `self_platform` (a deliberately ungated correction when the user names the platform itself).**
  - `_model_response()` is built inline in chat.py and is NOT a member of `chat_notices.NOTICE_MARKERS`, so `response_kind()` classifies it as `answer` and it is persisted as one — it then re-enters the transcript as answer-kind history. The maps enumerate NOTICE_MARKERS exhaustively but never note this one message that deliberately sits outside it.
  - `rag-thesis-backend/routers/chat.py:2126-2135 (model_identity), :2147, :2166, :2180, :2198, :2307, :2329-2341 (system_identity), :2346-2360 (self_platform), :2412, :2592, :2664; the model reply text at :854-859`

- **Prompt editing / conversation branching. A user can click the edit pencil on any earlier prompt, rewrite it, and resend; the client computes the turn index and the server DELETES that saved turn and every later one before re-answering, permanently destroying the rest of the branch.**
  - `edit_from_turn` appears in the models list and `branchBeforePrompt` in the frontend surface, but no flow traces the edit round-trip, and nothing states that editing a prompt is destructive to the persisted transcript.
  - `rag-thesis-frontend/src/pages/Chat.jsx:449-540 (UserBubble inline editor), :992, :1009 (branchBeforePrompt), :1410; rag-thesis-frontend/src/pages/chat/transcript.js:139; rag-thesis-backend/routers/chat.py:2035 (400 'A prompt edit requires a saved session.'), :2044-2050, :1530-1554 (_truncate_session_from_turn), :1439 (_history_before_turn); rag-thesis-backend/models.py:38`

- **Per-answer action menu in chat: Redo response (regenerate), Copy response, Listen (browser SpeechSynthesis TTS over a de-markdowned transcript), Copy with sources, Download research note (.txt blob named `iskai-research-note.txt`), Ask a follow-up, and a "Response details" modal exposing response type, generation path, citation count, evidence-passage count, distinct archived studies, archive basis and timestamp.**
  - The functions are listed in the chat-experience map, but no flow says a user can hear an answer read aloud, export it as a file, or open a provenance panel. The details modal in particular is a user-visible surface for pipeline internals.
  - `rag-thesis-frontend/src/pages/Chat.jsx:579-725 (AiResponseActions + details Modal), :610-639 (speechSynthesis); rag-thesis-frontend/src/pages/chat/responseActions.js:40 (plainResponseText), :50 (copyText), :66 (responseWithSources), :79 (downloadResearchNote), :91 (responseDetails)`

- **Novelty page has three capabilities beyond the scan itself: (a) a per-scan follow-up Q&A conversation (`POST /duplication/chat`, 20/minute, owner-scoped, appends to `scan_history.chat_log`, newest 20 returned); (b) scan history browse, delete-one and clear-all; (c) plain-text `.txt` manuscript upload as an alternative to PDF; plus a superadmin-only department selector that re-targets the scan.**
  - The novelty flow stops at "the rendered result and the JSON report". The conversational layer over a stored scan is a second LLM surface with its own rate limit and its own persisted log, and none of the history-management actions are described anywhere.
  - `rag-thesis-backend/routers/duplication.py:54 (DuplicationChatReq), :463-550 (duplication_chat), :552 (history), :576 (delete one), :603 (clear all), :230-237 (.txt accepted); rag-thesis-frontend/src/pages/Novelty.jsx:39 (SCAN_MIME_TYPES incl. text/plain), :69, :84 (accept=".pdf,.txt"), :145 (scanDuplicationChat), :333, :348, :365, :409-412 (superadmin dept Select)`

- **Archive detail modal renders a duplication-screening provenance panel that contrasts the at-upload screening against the current post-ingest rescan, with a collapsible "What the screening saw at upload" history block and an explanation of why the two differ. This is the only place a user sees the effect of `novelty.refresh_after_ingest` / `store_rescan`.**
  - The archive flow is described as "browsing, filtering and reading". The helpers are listed in the design-system map as bare names. Nothing says the archive surfaces a per-paper screening verdict with drift history, which is the user-visible output of a worker-side background mutation.
  - `rag-thesis-frontend/src/pages/Archive.jsx:239-300 (ScreeningDetail), :475-508 (ArchiveDetailModal); rag-thesis-frontend/src/lib/utils.js (hasRescan / currentScreening / atUploadScreening / screeningIsUnchanged / screeningHasDrifted / isScreeningFlagged / verdictLabel / verdictExplanation); rag-thesis-backend/services/novelty.py:416 (store_rescan), :446 (refresh_after_ingest)`

- **Seven backend endpoints have no frontend binding at all and are reachable only through the always-public interactive docs (`/docs` is never disabled — no `docs_url=None` anywhere): GET /maintenance/storage-cleanup, POST /maintenance/storage-cleanup/{id}/retry (deletes storage objects and paper rows), POST /maintenance/retention/run?apply=true (destructive purge of upload_job_events / resolved alerts / security_audit_events), POST+PATCH /catalog/programs, POST+PATCH /catalog/specializations (including `active: false`, which silently removes programs from the public landing marquee, archive filters and upload pickers), and GET /catalog/departments (the `contract_version` envelope).**
  - The admin flow narrates the four React tabs; the maps list these routes as surface but no flow explains who invokes them or how. The CORS comment proves /docs is the intended invocation path, which makes Swagger UI an undocumented admin surface.
  - `rag-thesis-backend/routers/maintenance.py:121, :144, :156; rag-thesis-backend/routers/catalog.py:181 (GET /departments), :193 (POST /programs), :208 (PATCH /programs), :220 (POST /specializations), :232 (PATCH /specializations); rag-thesis-backend/models.py:259-261 (CatalogEntityUpdate: name + active); rag-thesis-backend/main.py:142-151 (FastAPI() with no docs_url override); rag-thesis-backend/main.py:187-197 (CORS comment explicitly says PATCH was added because "a documented superadmin operation was unreachable from any browser while working perfectly from curl and the OpenAPI docs page"); rag-thesis-frontend/src/api.js:395-418 (no bindings)`

- **PUT /analytics/me accepts and validates `program_id` / `specialization_id` (through `resolve_academic_selection` with `require_program=True` for students, 422 on a specialization that does not belong to the program, 503 when the catalog migration is missing) but NO frontend surface ever sends them. ProfileSection only ever posts `full_name` and `avatar_url`.**
  - `profiles.program_id`/`specialization_id` are indexed columns with a validating BEFORE-UPDATE trigger and are read back by GET /analytics/me, yet a student can only populate them via /docs or curl. No map or flow notes that this half of the profile contract has no UI.
  - `rag-thesis-backend/routers/analytics.py:550-570; rag-thesis-backend/services/catalog.py (resolve_academic_selection); rag-thesis-frontend/src/pages/settings/ProfileSection.jsx:50, :76, :136 (the only three updateMyProfile call sites); rag-thesis-frontend/src/api.js:356`

- **Settings is a six-section console and four of the six are undescribed as features: Chat (localStorage-only default thesis-category filter and an Enter-vs-Ctrl+Enter send-key toggle, plus a "Clear all conversations" bulk delete that fans out one DELETE /sessions/{id} per session via Promise.allSettled and reports partial failure), Appearance, Privacy (principles copy plus an "Account removal" button that is a `mailto:ccsict@isu.edu.ph` link — there is no self-service deletion), and About.**
  - The maps list the section components as exported names only. No flow covers the settings surface, so the bulk-delete (N sequential authenticated DELETEs from one click) and the fact that account deletion is a mailto stub are both unrecorded.
  - `rag-thesis-frontend/src/pages/Settings.jsx:16 (SECTIONS registry); rag-thesis-frontend/src/pages/settings/ChatSection.jsx:38-88 (ClearConversations), :89-153; rag-thesis-frontend/src/pages/settings/PrivacySection.jsx:44-53; rag-thesis-frontend/src/lib/chatPrefs.js:231, :240`

- **Settings → Security exposes four self-service account operations: change email (Supabase `updateUser({email})` then a 6-digit `email_change` OTP verify), change password (email-code gated), "Sign out on all other devices" (`signOut({scope:'others'})`), and TOTP 2FA enrol/unenrol via a QR dialog. Separately, ProfileSection uploads and deletes avatars directly into the public Supabase `avatars` bucket with client-side MIME/2 MB validation and orphan cleanup on failure.**
  - The account-lifecycle flow runs "sign-up → verification → approval → sign-in + second step → authorization → idle expiry → sign-out". Credential rotation, session revocation and avatar storage are all outside that chain, and avatar upload is the only path in the product where the browser writes to Supabase Storage directly.
  - `rag-thesis-frontend/src/pages/settings/SecuritySection.jsx:30, :47, :115, :131, :185-221, :233; rag-thesis-frontend/src/components/MfaEnrollDialog.jsx; rag-thesis-frontend/src/components/TwoFactorSettings.jsx; rag-thesis-frontend/src/pages/settings/ProfileSection.jsx:19-120 (AvatarEditor)`

- **Cloudflare Turnstile is not only a guest-chat gate. `useSecurityGate` + `SecurityCheck` are wired into six Supabase Auth actions with distinct action labels — `signin`, `signup`, `password_reset`, `password_reset_resend`, `password_reset_verify`, and OTP sign-in — and the token is passed to Supabase as `options.captchaToken`, never to the FastAPI backend.**
  - The auth/abuse map covers only `services/turnstile.py` and `turnstile_expected_action='guest_chat'`, and the chat map notes "useSecurityGate … Not used by chat" without saying what does use it. The backend's expected-action check is irrelevant to these five, because the verification happens at Supabase.
  - `rag-thesis-frontend/src/pages/auth/SignInForm.jsx:34, :208; SignUpForm.jsx:33, :274; ForgotPasswordStep.jsx:31, :139, :192, :235; OtpSignInStep.jsx:26, :79; rag-thesis-frontend/src/pages/auth/authUtils.js (authOptions); rag-thesis-frontend/src/components/security/useSecurityGate.js:372`

- **App-wide UX capabilities in the shell: a Ctrl/Cmd+K command palette (fuzzy search over every permitted nav destination plus "Appearance and energy" and "Profile and security"), an Appearance dialog that mutates a five-axis preference set (theme, palette, motion, effects, contrast) persisted under `isu-thesis-preferences-v2`, a live health indicator polling GET /health every 30 s and rendering Online/Degraded/Offline, and hover/focus route prefetching that warms both the lazy chunk and its React Query data.**
  - The design-system map lists these as component signatures. No flow explains that there is a keyboard-driven navigator, that appearance is a persisted five-axis user preference (the four theme states the a11y suite tests are a *user* setting, not just a test matrix), or that the sidebar continuously polls a backend endpoint.
  - `rag-thesis-frontend/src/components/AppShell.jsx:33-49 (HealthStatus), :139-147 (Ctrl+K), :161-171, :186-198, :313-314; rag-thesis-frontend/src/components/CommandPalette.jsx:7; rag-thesis-frontend/src/components/AppearanceDialog.jsx; rag-thesis-frontend/src/context/PreferencesContext.jsx; rag-thesis-frontend/src/lib/routePrefetch.js:236`

- **Idle-session enforcement is a user-facing interruption: a warning modal with a depleting countdown ring and a "Stay signed in" button appears 60 s before a role-dependent idle deadline, there is a 12-hour absolute session cap independent of activity, and on expiry the user is signed out and redirected to `/login?next=<path>` so the original destination is restored after re-auth.**
  - The account-lifecycle flow lists "idle expiry" as one word. The privileged-vs-standard idle limits, the 60-second grace modal, the absolute cap and the `?next=` round-trip are four separate behaviours a user will hit, none of them described.
  - `rag-thesis-frontend/src/components/IdleSessionGuard.jsx:24, :53-101, :199; rag-thesis-frontend/src/lib/idleSession.js:7 (IDLE_LIMIT_MS per role), :13 (IDLE_WARNING_MS 60 s), :17 (ABSOLUTE_SESSION_MS 12 h), :23 (idleLimitForRole), plus safeNextPath / loginPathWithNext / formatCountdown`

- **Batch upload has two capabilities the batch flow does not cover: an in-flight batch is serialized to `localStorage` under `activeUploadBatch` (owner-scoped, rejected on owner mismatch or the legacy bare-array shape) so a page reload rehydrates the rows and resumes polling; and each row can be cancelled individually via POST /upload/jobs/{id}/cancel. The single-upload wizard has the same cancel button, and also links out to /upload/batch.**
  - The batch flow corrects three premises about concurrency and stage rendering but never mentions crash/reload recovery or per-row cancellation, and the maps list `serializeActiveBatch`/`restoreActiveBatch` as signatures only. The synthetic `expired` status after 3 missing polls is also a user-visible state with no server counterpart.
  - `rag-thesis-frontend/src/pages/upload/batchState.js:37 (ACTIVE_BATCH_STORAGE_KEY), :383 (serializeActiveBatch), :400 (restoreActiveBatch), :34-36 (MISSING_POLLS_BEFORE_EXPIRED=3); rag-thesis-frontend/src/pages/UploadBatch.jsx:990 (cancelUploadJob); rag-thesis-frontend/src/pages/Upload.jsx:408 (cancel), :444-448 (link to /upload/batch)`

- **The admin Overview tab renders a full Objective-2 research-evidence table in-product: five strata × {n, baseline, RAG, change, p-value, significant/not}, a gold "the figure the paper quotes" badge on the topic-present stratum, a "How to read this" caveat paragraph, and faithfulness / context-precision diagnostics — all read from a committed JSON file that is currently UNTRACKED in git.**
  - The evidence flow states "the paper carries none of the Objective 2 measured figures" and treats the export as a build artifact. It does not say the running admin console publishes the per-stratum result with p-values to every admin, nor that the data file backing that panel is not in the repository — so a fresh clone fails to build this page.
  - `rag-thesis-frontend/src/pages/admin/AdminOverview.jsx:185-290; rag-thesis-frontend/src/data/objective2Summary.json (git status: `?? rag-thesis-frontend/src/data/`, AdminOverview.jsx: ` M`); rag-thesis-backend/scripts/export_objective2_summary.py:126-152`

- **Three health/readiness surfaces are unauthenticated and invocable by anyone, and two of the three are consumed by nothing in the repo: GET /health/worker (one uncached read of `ingestion_workers`, returns 503 when no worker has heartbeat within `operations_worker_stale_seconds` or the scanner is unavailable), GET /ready (deliberately bypasses the 15 s contract cache, so each call costs four DB reads), and GET /healthz on the frontend nginx container.**
  - The maps list all three as surface but nothing identifies them as an externally reachable, uncached, unauthenticated operational oracle — /ready in particular is a 4-read-per-request endpoint behind only the global 120/minute limit, and /health/worker discloses ingestion-fleet liveness to anonymous callers.
  - `rag-thesis-backend/main.py:289 (/health/worker), :311 (/ready); rag-thesis-frontend/nginx/default.conf.template:20 (location = /healthz); rag-thesis-frontend/src/api.js:161 (only /health is bound); rag-thesis-backend/Dockerfile HEALTHCHECK (only /health)`

- **Two ingestion gates produce user-visible upload rejections that no flow explains: `max_pdf_pages` (default 500) rejects a PDF with HTTP 422 "PDF exceeds the 500-page safety limit" at three separate entry points, and `require_ocr_for_scanned_pages` (default True) fails an already-queued ingestion job when any page needed OCR and OCR could not run — so on a host without the tesserocr wheel a valid manuscript fails asynchronously, after the user has already seen a 202 and is polling.**
  - The upload and ingestion flows list the eight pipeline stages but not these two refusal conditions. The OCR one is the only case where a job that passed every synchronous validation still fails for an environment reason, and the resulting failure message is what the polling UI shows the uploader.
  - `rag-thesis-backend/routers/upload.py:510-511; rag-thesis-backend/routers/duplication.py:191-193; rag-thesis-backend/services/ingestion.py:81, :127; rag-thesis-backend/config.py:115 (max_pdf_pages), :124 (require_ocr_for_scanned_pages, with the 2026-09-07 measurement comment)`

The other three completeness lenses - uncovered files, the contract and coupling inventory, and the deep risk sweep - are in [`analysis/COMPLETENESS_AUDIT.md`](analysis/COMPLETENESS_AUDIT.md).

## 11. Provenance and staleness

Generated from the structured output of a 71-agent analysis workflow rather than hand-transcribed. Each subsystem map and flow trace was produced by one agent reading the files, then checked by a second agent whose only instruction was to refute it. Corrections are folded into the prose and also retained verbatim in the reference files, because each one records a wrong belief a competent reader reached from the same source.

**What this means for trust.** Every factual claim was checked against source by at least two agents; the three highest-stakes claims (sections 5.1, 5.2 and 5.3) were additionally verified by hand. All 21 subsystems and all 12 flows returned verdict `mostly-accurate` - none was `materially-wrong`.

**What this means for staleness.** Anchors are `file:line` as of 2026-09-22. They will drift. Treat a stale anchor as a prompt to re-grep, not as a contradiction. Counts in section 3 were taken from the working tree on that date.

**Where this disagrees with other docs.** `README.md` is authoritative for setup, operations and evaluation, and is enforced by `tests/test_readme_accuracy.py`. `CLAUDE.md` is authoritative for guardrails. This file records what the code does, which is not always the same thing - see section 5, item 1 for a case where `CLAUDE.md` describes the opposite of the implemented behaviour.

**Regenerating.** The workflow script is preserved under the session directory:

```text
.claude/projects/C--Users-Kazuha-Desktop-Thesis-V1/<session>/workflows/scripts/
  comprehend-thesis-rag-codebase-wf_8a2f47e5-eab.js
```

Per-agent return values, about 2.5 MB of raw JSON, are in that run's `journal.jsonl`. Re-running the workflow after significant change and diffing sections 5 to 7 is the cheapest way to keep this honest.

**Known incompleteness.** The completeness audit found 71 tracked files carrying real logic that no subsystem map listed among its key files - mostly 17 of the 27 migrations, 18 frontend unit-test files, 20 UI components, and the `email-templates/` directory. Each is described in `analysis/COMPLETENESS_AUDIT.md`, but none received a dedicated deep read. That is the next reading list, not covered ground.
