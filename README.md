# ISU Centralized AI-Powered Thesis Library

Operational deployment, cancellation, malware scanning, retention, encrypted backup, and disposable restore procedures are in [the operations runbook](docs/OPERATIONS_SECURITY_RUNBOOK.md). Secret rotation is covered by [the secret-rotation runbook](docs/SECRET_ROTATION.md). Institutional approvals, privacy review, and the immutable 50-thesis defense corpus are controlled by [the PI-08 governance protocol](docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md).

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

## Paper-objective mapping

| Objective | Where it lives |
|-----------|----------------|
| 1 — RAG + LLM knowledge retrieval model | `services/` (document_processor, chunker, embedder, retriever) + `routers/chat.py` |
| 2 — Baseline LLM vs RAG comparison | `evaluation/run_comparison.py` + `evaluation/golden_dataset.json` (Ragas: Faithfulness, Context Precision) |
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
- **Current stable model defaults** — `gemini-3.6-flash` for grounded chat, `gemini-3.5-flash-lite` for bounded verdict/extraction work, and `gemini-embedding-2` at 768 dimensions. Deployment overrides must be captured in the release fingerprint.

## Setup

### 1. Supabase

1. Create a Supabase project.
2. For a fresh project, run `rag-thesis-backend/supabase_setup.sql`, then apply `20260725_normalized_academic_catalog.sql`.
3. For an existing project, apply the numbered migrations in filename order. Validate the durable-ingestion and normalized-catalog migrations in a disposable project before production; retain the catalog rollback only until UUID classifications become authoritative.
4. Deploy the API and ingestion worker before accepting uploads; applying the durable-queue migration without the worker leaves accepted jobs safely queued.
5. After signing up your first user through the app, promote them:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@isu.edu.ph';
   ```

### 2. Backend

Use Python 3.14.6, matching CI and the production container. Dependencies are exact-pinned and validated with `pip check`, `pip-audit`, PyTest, and Pylint.

```bash
cd rag-thesis-backend
py -3.14 -m venv .venv
.venv\Scripts\activate                         # Windows
pip install -r requirements.txt
copy .env.example .env                          # then fill in the values
python -m uvicorn main:app --reload --port 8000
```

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
| Admin | Everything + paper upload/deletion, analytics, user role management |

## Evaluation and testing

```bash
cd rag-thesis-backend

# Objective 4 — Functional Suitability (with coverage for SonarQube)
pytest --cov=routers --cov=services --cov=dependencies --cov=workers --cov=main --cov=config --cov=models --cov-report=xml --cov-fail-under=85

# Objective 4 — Maintainability
pylint --rcfile=.pylintrc routers services dependencies workers main.py config.py models.py
cd ../rag-thesis-frontend && npm run lint && npm test && npm run build

# Objective 2 — Baseline vs RAG (requires: pip install -r evaluation/requirements-eval.txt)
cd ../rag-thesis-backend
python -m evaluation.run_comparison

# Objective 4 — Performance Efficiency
# Open jmeter/thesis_load_test.jmx in Apache JMeter 5.6+ and run against your host.
```

### Objective 4 — Reliability (SonarQube)

Static analysis is configured in `sonar-project.properties` (repo root). Against a local SonarQube server (paper: v10.4):

```bash
docker run -d --name sonarqube -p 9000:9000 sonarqube:10.4-community
# create a project + token at http://localhost:9000, then generate coverage (pytest --cov, above) and run:
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=<your-token>
```

Alternatively, add a `SONAR_TOKEN` repository secret (SonarCloud, or set the `SONAR_HOST_URL` repository variable for a reachable server) and the GitHub Actions workflow `.github/workflows/quality.yml` runs PyTest + coverage, Pylint, ESLint, the production build, and the SonarQube scan on every push to `main`. Without the secret, the scan step skips gracefully and the rest of the quality gate still runs.

LangSmith latency tracing activates with `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY`; the legacy `LANGCHAIN_*` names remain temporary fallbacks. Inputs and outputs remain hidden when the documented privacy settings are enabled.

## Production deployment

- **Backend API:** `docker build -t isu-thesis-api rag-thesis-backend && docker run -p 8000:8000 --env-file rag-thesis-backend/.env isu-thesis-api` (or deploy to Railway/Render/Fly.io).
- **Ingestion worker:** deploy the same image as a separate process with command `python -m workers.ingestion_worker`. Never run production uploads with only the API process.
- Set `APP_ENVIRONMENT=production`, `REQUIRE_PRIVILEGED_MFA=true`, a shared Redis `RATE_LIMIT_STORAGE_URI`, `CORS_ORIGINS`, and `FORWARDED_ALLOW_IPS` restricted to the hosting platform's known proxy IP/CIDR. On public hosts also set `TURNSTILE_SECRET_KEY` (paired with the frontend `VITE_TURNSTILE_SITE_KEY`) so guest chat requires one Turnstile check per session before spending Gemini quota; leave it unset for development and formal evaluation runs. Use `/health` for API liveness, `/ready` for API readiness, and `/health/worker` for a non-sensitive worker-health signal; worker correctness remains protected by expiring job leases.
- **Frontend:** `npm run build` then host `dist/` on any static host (Vercel/Netlify/Cloudflare Pages). Set `VITE_API_URL` to the deployed backend URL.
- **Database:** Supabase handles PostgreSQL + pgvector + Auth + Storage.
