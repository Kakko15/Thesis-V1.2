# ISU Centralized AI-Powered Thesis Library

Operational deployment, cancellation, malware scanning, retention, encrypted backup, and disposable restore procedures are in [the operations runbook](docs/OPERATIONS_SECURITY_RUNBOOK.md). Secret rotation is covered by [the secret-rotation runbook](docs/SECRET_ROTATION.md). Institutional approvals, privacy review, and the immutable 50-thesis defense corpus are controlled by [the PI-08 governance protocol](docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md). [The defense walkthrough](docs/DEFENSE_WALKTHROUGH.md) is the demo script.

A production web application implementing the thesis *"A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation"* (Barlis & Gallardo, BSCS Data Mining Track) for the College of Computing Studies, Information and Communication Technology (CCSICT), Isabela State University, Echague.

The system is an **indirect** thesis library: users never view or download full manuscripts. Instead, a closed-domain RAG pipeline retrieves semantically relevant chunks from the CCSICT vector archive and synthesizes citation-backed answers with Gemini.

## Repository layout

| Path | Description |
|------|-------------|
| `rag-thesis-backend/` | FastAPI + LangChain + Supabase pgvector RAG backend |
| `rag-thesis-frontend/` | React 19 + Vite frontend (Tailwind v4, Framer Motion, ISU Material 3 design system) |
| `rag-thesis-backend/evaluation/` | Objective 2 harness: baseline LLM vs RAG comparison scored with Ragas |
| `rag-thesis-backend/tests/` | Objective 4 PyTest suite (Functional Suitability) |
| `rag-thesis-backend/jmeter/` | Objective 4 Apache JMeter load-test plan (Performance Efficiency) |
| `paper/` | The thesis proposal: the untouched 2026-08-09 original, the corrected document, and `build_corrections.py`, which regenerates the corrections from the original so they can never double-apply |

## Paper-objective mapping

| Objective | Where it lives |
|-----------|----------------|
| 1 — RAG + LLM knowledge retrieval model | `services/` (document_processor, chunker, embedder, retriever) + `routers/chat.py` |
| 2 — Baseline LLM vs RAG comparison | `evaluation/run_comparison.py` + `evaluation/golden_dataset.json` (Ragas: **Answer Correctness** paired baseline-vs-RAG; Faithfulness and Context Precision as RAG-only diagnostics) |
| 3 — Web-based Thesis Library System | Full stack (this repository) |
| 4 — ISO/IEC 25010 internal quality | PyTest (`tests/`), JMeter (`jmeter/`), SonarQube (`sonar-project.properties` + CI), Pylint (`.pylintrc`), ESLint (frontend `eslint.config.js`) |

Key paper parameters enforced in code:

- **85% cosine similarity duplication threshold** (`DUPLICATION_THRESHOLD=0.85`) — enforced three ways: automatically on every new submission during upload ingestion (Section 3.2.3 Phase 3, result stored in `papers.duplication_scan`), on demand at scan time (`/duplication/scan`), and at query time (chat duplication guard).
- **800-token chunks / 100-token overlap** via `RecursiveCharacterTextSplitter`.
- **Metadata tagging** — every chunk carries `{title, author, track, year}` JSON.
- **LongContextReorder** — most relevant sources placed at the start and end of the prompt window ("Lost in the Middle" mitigation).
- **Data cleaning pipeline** — page numbers, headers/footers, TOC and bibliography stripped; chunks with >15% non-alphanumeric characters discarded; `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholders injected.
- **Indirect access model** — private storage bucket; API responses expose citation metadata only.
- **Knowledge isolation** — the LLM answers exclusively from retrieved CCSICT context.
- **Current stable model defaults** — `gemini-3.6-flash` for grounded chat, `gemini-3.5-flash-lite` for bounded verdict/extraction work, and `gemini-embedding-001` at 768 dimensions. Deployment overrides must be captured in the release fingerprint.

## Setup

### 1. Supabase

1. Create a Supabase project.
2. For a fresh project, run `rag-thesis-backend/supabase_setup.sql`, then apply **every** file in `rag-thesis-backend/migrations/` in filename order (skip the `.rollback.sql` files).

   The base schema is not sufficient on its own. Seven tables exist only in migrations, and omitting them leaves a working-looking deployment with a broken operations console:

   | Table | Introduced by |
   |---|---|
   | `upload_job_events`, `ingestion_workers`, `operational_alerts`, `security_audit_events` | `20260724_operations_security.sql` |
   | `programs`, `specializations` | `20260725_normalized_academic_catalog.sql` |
   | `backup_runs` | `20260804_backup_runs.sql` |

3. For an existing project, apply the numbered migrations in filename order. **Order matters and partial replays are unsafe:** `20260718` carries a copy of `commit_paper_ingestion` that predates index provenance, so re-running it after `20260720` reverts the function and every `papers` insert then fails its foreign key. Likewise `20260717` seeds a department row without the `code` column that `20260725` later makes `NOT NULL`. Apply only the files a project is actually missing, in order. `tests/test_schema_consistency.py` guards the related drift between `supabase_setup.sql` and the migrations. Apply `20260829_reindex_updates_chunk_count.sql` before a model reindex so each rebuilt active index updates its displayed vector-chunk total transactionally. Validate the durable-ingestion and normalized-catalog migrations in a disposable project before production; retain the catalog rollback only until UUID classifications become authoritative.
4. Deploy the API and ingestion worker before accepting uploads; applying the durable-queue migration without the worker leaves accepted jobs safely queued.
5. To change embedding models, take the API and ingestion worker offline, set the same `GEMINI_EMBED_MODEL` for both, verify the target returns 768 values with `python scripts/gemini_release_smoke.py`, then reindex every ready paper before restoring traffic:
   ```powershell
   python -m scripts.reindex_citations --apply --all --allow-model-change
   ```
   Existing vectors remain as rollback versions. If the command is interrupted, resume only the same model migration with `--resume`; it rejects state produced by another index configuration.
6. After signing up your first user through the app, promote them:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@isu.edu.ph';
   ```

### 2. Backend

Use Python 3.14.7, matching CI and the production container. Dependencies are exact-pinned and validated with `pip check`, `pip-audit`, PyTest, and Pylint.

```bash
cd rag-thesis-backend
py -3.14 -m venv .venv
.venv\Scripts\activate                         # Windows
pip install -r requirements.txt
copy .env.example .env                          # then fill in the values
python -m uvicorn main:app --reload --port 8000
```

**Two dependency files, on purpose.** `requirements.txt` is the human-readable
statement of intent — direct dependencies only, and the file the paper's version
tables are generated from. Local development installs from it, as above.

`requirements.lock` is what CI and the container install, with
`pip install --require-hashes`: the same direct pins plus every transitive
dependency, each carrying the SHA-256 hashes of its distributions, so a
substituted package fails the build instead of shipping. It is resolved for
`linux/cpython-3.14` and will not install on Windows, because `tesserocr` ships
manylinux-only wheels.

After changing `requirements.txt`, regenerate the lock in the same commit:

```bash
uv pip compile requirements.txt --generate-hashes \
  --python-platform x86_64-unknown-linux-gnu --python-version 3.14 \
  --output-file requirements.lock
```

`tests/test_dependency_lock.py` fails if the two ever disagree.

In a second terminal, start the durable ingestion worker. Uploads remain queued
until this process is running, and API restarts do not lose accepted jobs.

```bash
cd rag-thesis-backend
.venv\Scripts\activate                         # Windows
python -m workers.ingestion_worker
```

- `SUPABASE_KEY` must be the **service_role** key.
- Never place the service-role key in the frontend or commit it. Rotate any key that is exposed outside the local test environment.
- Optional: install the [Tesseract OCR binary](https://github.com/UB-Mannheim/tesseract/wiki) to digitize scanned manuscripts.
- API docs: http://localhost:8000/docs

### 3. Frontend

```bash
cd rag-thesis-frontend
npm ci
copy .env.example .env    # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

Open http://localhost:5173.

Keep `VITE_API_URL` empty for local development. Vite proxies API requests to
`http://localhost:8000` and waits briefly for FastAPI during startup or reloads.
Set `VITE_API_URL` only when the frontend must call a separately deployed backend.

## Roles

| Role | Capabilities |
|------|--------------|
| Guest Researcher | Landing page, CCSICT-only chat (no saved history or manuscript access) |
| Student | Chat with sessions, dashboard, archive metadata browsing |
| Faculty | Student capabilities + topic novelty scanning and scan history |
| Admin | Everything above + paper upload/deletion, analytics, user role management — scoped to their own department |
| Superadmin | Admin capabilities across **all** departments + the operations console (workers, alerts, retention, storage cleanup), the academic catalog (departments → programs → specializations), and the role-feature permission matrix |

Upload defaults to admin and superadmin, but can be granted to students or
faculty through the server-owned role-feature matrix (`PUT /settings/features`,
superadmin only). Novelty scanning is granted to faculty by default. Privileged
roles additionally require MFA (AAL2) when `REQUIRE_PRIVILEGED_MFA` is enabled,
which production configuration enforces.

## Institutional catalog

`20260819_isu_academic_catalog.sql` seeds the ISU Echague colleges and their
degree programs as a **department → program → specialization** hierarchy.

**CCSICT is the only active department.** It is the system's operating scope
through the thesis defense, and its five programs (BSCS, BSIT, BSDSA, BSIS,
BLIS — BLIS belongs to CCSICT, not the College of Education) were already
seeded by the PI-04 catalog migration. The other nine colleges — SVM, CA, IOF,
CAS, COE, CBAPA, CON, CCJE, CED — are **standby data**: seeded with their full
program lists but `departments.active = false`.

`departments.active` is the single authoritative switch, enforced in two
independent places:

- `routers/catalog.py::_nested_catalog` omits an inactive department entirely,
  so it never reaches an archive filter, upload form, chat scope, or admin
  picker.
- `services/catalog.py::resolve_academic_selection` rejects an upload addressed
  to one with `422 Unknown or archived department`.

Programs and specializations under the standby colleges are seeded *active* on
purpose, so scaling a college up after the defense is one statement rather than
a three-table cascade:

```sql
update public.departments set active = true where code = 'CA';
```

Before activating a college whose programs carry specializations (CBAPA/BSBA,
CED/BSED, CED/BTLED — majors are modelled as specializations, matching
CCSICT's BSIT → WMAD/NETSEC), also widen the two places that currently hardcode
which programs take a specialization:

1. `SPECIALIZATION_REQUIRED_PROGRAMS` in `rag-thesis-backend/services/catalog.py`
2. the `validate_academic_classification` trigger from
   `20260725_normalized_academic_catalog.sql`

Both list only `BSCS` and `BSIT` today, so a BSED thesis submitted with a major
would otherwise be refused.

> **Known mismatch — the five legacy track names.** `models.CCSICT_TRACKS` still
> lists *Data Mining, Web Development, Network Security, Intelligent Systems,
> Information Management*, but the seeded catalog defines only three CCSICT
> specializations and renames two of them: `WMAD` **Web and Mobile Application
> Development** and `NETSEC` **Network and Security**. *Intelligent Systems* and
> *Information Management* map to `needs_review`
> (`20260725_normalized_academic_catalog.sql:80`) and are not tracks at all.
> `active_track_names('CCSICT')` therefore returns the three specialization names
> plus the program codes for `BSDSA`, `BSIS` and `BLIS`, and that is what
> `papers.track` is stamped with. The constant is retained only as an outage
> fallback. This also affects the thesis paper. The mismatch no longer reaches
> the Objective 2 Golden Dataset: `13f10c6` realigned its categories, and all 40
> queries now carry catalog values — Data Mining 9, Web and Mobile Application
> Development 8, Network and Security 6, BSDSA 6, BSIS 4, Cross-track 3,
> Negative control 3, BLIS 1 — with none under either dropped name.
> `departments.title` carries the full college name
(`name` is the short code and the foreign-key target for papers, profiles,
chat sessions, scans, uploads, and the activity log, so it cannot hold prose).

## Thesis categories

Every paper carries a `thesis_category` of `student` (undergraduate thesis) or
`faculty` (faculty research), introduced by
`migrations/20260819_thesis_category.sql`. The category classifies the
**manuscript**, not the uploader — it is deliberately unrelated to the
`faculty` value in `profiles.role`, since an administrator may archive a
faculty-authored manuscript and vice versa. Everything indexed before the
migration backfills to `student`, which keeps the locked PI-08 evaluation
corpus undergraduate-only by definition.

- **Upload** — the wizard's metadata step selects the category (default
  `student`). A student-category thesis requires a validated academic program
  for **every** uploader role; a faculty-category thesis may omit the
  program/specialization entirely, since faculty research can sit outside the
  undergraduate catalog.
- **Browse** — `GET /papers` accepts an optional `thesis_category` query
  parameter; the Archive, upload history, and system management surfaces
  filter and badge by category.
- **Retrieval** — `match_chunks` and `check_topic_duplication` accept an
  optional trailing `p_thesis_category` parameter that defaults to `null`, and
  the application omits the key entirely unless a chat visitor picks a
  category scope, so every pre-existing call — including ingest-time
  duplication screening and `/duplication/scan`, which stay deliberately
  cross-category — resolves to the frozen evaluated pipeline unchanged.
- **Idempotency note** — replaying an upload with the same `Idempotency-Key`
  and file but a different category returns the original job; the first
  submission's category wins.

## Evaluation and testing

```bash
cd rag-thesis-backend

# Objective 4 — Functional Suitability (with coverage for SonarQube)
pytest --cov=routers --cov=services --cov=dependencies --cov=workers --cov=main --cov=config --cov=models --cov-report=xml --cov-fail-under=85

# Objective 4 — Maintainability
pylint --rcfile=.pylintrc routers services dependencies workers main.py config.py models.py
cd ../rag-thesis-frontend && npm run lint && npm run test:coverage && npm run build && npm run bundle:budget

# Objective 2 — Baseline vs RAG (requires: pip install -r evaluation/requirements-eval.txt)
cd ../rag-thesis-backend
python -m evaluation.run_comparison

# Objective 4 — Performance Efficiency (JMeter 5.6+, headless)
java -jar <jmeter>/bin/ApacheJMeter.jar -n -t jmeter/provider_independent_load.jmx \
  -l evaluation/results/jmeter/provider_run_1.jtl
```

### Running the Objective 2 comparison

Configure the process before the run, because three settings silently change
what the result means:

| Setting | Value for a formal run | Why |
|---|---|---|
| `LLM_BASE_URL` | **unset** | A gateway is a third party, and the paper's no-training guarantee (§2.1.6) comes from Google's terms. The release fingerprint records which route served the run. |
| `APP_ENVIRONMENT` | `development` | `production` *forces* a non-zero guest token budget, and the harness runs as a guest. |
| `GUEST_DAILY_TOKEN_BUDGET` | `0` | Same reason: a budget throttles the evaluation into a notice. |

Never pass `--allow-unvalidated` for a run you intend to report.

**Runs resume.** Each completed query is checkpointed to
`evaluation/results/checkpoints/<run-id>.pathways.jsonl`, and Ragas scores to
`<run-id>.scores.jsonl`. A run interrupted at query 38 of 40 continues from 38
rather than discarding both arms for the 37 that already succeeded — a full run
is roughly 80 model calls before scoring adds ~160 more. The run id defaults to
the dataset's SHA-256 prefix, so re-running the same dataset resumes and a
changed dataset starts clean. Use `--fresh` to discard a checkpoint deliberately.

**Provider outages are never scored.** On an exhausted quota `/chat` returns
HTTP 200 carrying a capacity notice, and trips a 60-second process-wide cooldown
during which every following question returns that notice without being
attempted. Scored naively, one rate-limit event would record 3–6 consecutive
queries as near-zero for the RAG arm and *understate the study's own finding*.
The harness retries such queries with backoff (clearing the cooldown first, or
the retry just replays the notice), and marks any that never recover
`rag_unattempted`. Those are excluded from the paired test, listed in
`unattempted_query_ids`, and force `formal_result: false`.

This applies **only** to capacity and guest-allowance notices. *No relevant
thesis was found* is the retrieval threshold working correctly, and is the
expected answer for the three negative-control queries — it is scored, never
retried.

`jmeter/` holds four current plans. `thesis_load_test.jmx` is retained only as the
superseded original and should not be used for new evidence.

| Plan | Measures |
|---|---|
| `provider_independent_load.jmx` | Application throughput with no provider in the path — the figure to quote for Performance Efficiency |
| `chat_load.jmx` | End-to-end `/chat` RAG latency and the provider rate-limit envelope |
| `rate_limit_test.jmx` | That the configured per-caller limits actually throttle |
| `live_gemini_smoke.jmx` | A few real single-user calls against the live provider |

Summarize a run with `python -m evaluation.summarize_jmeter`. For `/chat`
specifically use `python -m evaluation.summarize_chat_load`, which separates real
answers from capacity notices — a `/chat` run can return 100% HTTP 200 while
answering almost nothing, because provider exhaustion is reported as a 200
carrying an explicit notice.

### Objective 4 — Reliability (SonarQube)

Static analysis is configured in `sonar-project.properties` (repo root).

**Version note — resolved.** Table 4 previously recorded SonarQube **10.4** while
the retained evidence in `evaluation/iso25010_evidence.md` was produced on
**Community Build 26.7.0.124771** with **SonarScanner CLI 8.0.1.6346**. The paper
was corrected to the version actually used (`paper/CORRECTIONS_APPLIED.md`, Pass 1),
so the table and the evidence now agree and no re-run on 10.4 is needed.

```bash
docker run -d --name sonarqube -p 9000:9000 sonarqube:community
# create a project + token at http://localhost:9000, generate both coverage
# reports (pytest --cov and npm run test:coverage, above), then run:
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=<your-token>
```

Both coverage reports matter: `sonar.python.coverage.reportPaths` and
`sonar.javascript.lcov.reportPaths` are both configured, and omitting the
frontend lcov is what previously reported the whole repository at 36.3%.

Alternatively, add a `SONAR_TOKEN` repository secret (SonarCloud, or set the `SONAR_HOST_URL` repository variable for a reachable server). Without it the scan step skips gracefully and the rest of the gate still runs.

The GitHub Actions workflow `.github/workflows/quality.yml` runs on every push to `main`:

| Job | Steps |
|---|---|
| **Backend** | hash-verified install from `requirements.lock`, `pip check`, `pip-audit --no-deps` against the lock, PyTest with `--cov-fail-under=85`, Pylint |
| **Frontend** | `npm audit --omit=dev`, ESLint, unit tests with coverage thresholds, production build, bundle-size budget, 21 Playwright specs including the axe accessibility matrix |
| **Secret scan** | Gitleaks over full history |
| **Containers** | build and Trivy-scan both images (CRITICAL/HIGH, fixed only), emit an SPDX SBOM per image |
| **SonarQube** | consumes both coverage artifacts; skipped when `SONAR_TOKEN` is absent |

LangSmith latency tracing activates with `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY`; the legacy `LANGCHAIN_*` names remain temporary fallbacks. Inputs and outputs remain hidden when the documented privacy settings are enabled.

## Production deployment

- **Backend API:** `docker build -t isu-thesis-api rag-thesis-backend && docker run -p 8000:8000 --env-file rag-thesis-backend/.env isu-thesis-api` (or deploy to Railway/Render/Fly.io).
- **Ingestion worker:** deploy the same image as a separate process with command `python -m workers.ingestion_worker`. Never run production uploads with only the API process.
- Set `APP_ENVIRONMENT=production`, `REQUIRE_PRIVILEGED_MFA=true`, a shared Redis `RATE_LIMIT_STORAGE_URI`, `CORS_ORIGINS`, and `FORWARDED_ALLOW_IPS` restricted to the hosting platform's known proxy IP/CIDR. On public hosts also set `TURNSTILE_SECRET_KEY` (paired with the frontend `VITE_TURNSTILE_SITE_KEY`) so guest chat requires one Turnstile check per session before spending Gemini quota; leave it unset for development and formal evaluation runs. Use `/health` for API liveness, `/ready` for API readiness, and `/health/worker` for a non-sensitive worker-health signal; worker correctness remains protected by expiring job leases.
- Leave `LLM_BASE_URL` and `LLM_API_KEY` **unset** unless generation must be routed through an OpenAI-compatible gateway. Setting them sends chat, extract, and verdict calls to that operator first (falling back to Google on any failure) with the model names unchanged; embeddings are never routed, so every question still reaches Google. The model name is unchanged but the two routes are **not** interchangeable: `thinking_level` cannot cross an OpenAI-compatible boundary, so the gateway is sent `reasoning_effort` and `LLM_GATEWAY_MAX_OUTPUT_TOKENS` (default 6000) instead of the direct route's `GEMINI_MAX_OUTPUT_TOKENS`. Both are recorded in the release fingerprint, because a run served with them unset produced replies severed at the ceiling. The no-training guarantee the paper relies on comes from Google's terms and does not extend to another operator, so keep the direct route for the formal evaluation and for any governed-corpus processing, and disclose the gateway to the privacy review before enabling it. `python -m scripts.release_fingerprint` records `generation_route` (enabled flag and host, never the credential).
- **Frontend:** `npm run build` then host `dist/` on any static host (Vercel/Netlify/Cloudflare Pages). Set `VITE_API_URL` to the deployed backend URL.
- **Database:** Supabase handles PostgreSQL + pgvector + Auth + Storage.
