# Thesis Proposal vs. Implemented System — Verified Comparison

| Control | Value |
|---|---|
| Paper compared | `Final Thesis Proposal Paper_Update Carlo.pdf` (52 pages, full text re-extracted and read) |
| System compared | Working tree based on commit `3f62a35`, including the independent 2026-07-28 verification fixes documented below |
| Comparison date | 2026-07-28 |
| Method | Original PDF text plus rendered pages were checked against source files, tests, evidence artifacts, official Gemini/Ragas documentation, and an independent xhigh teammate audit. Version numbers come from lock/config files; measured results remain tied to their dated evidence files. |

**Legend**

- ✅ **Aligned** — implemented as the paper specifies
- 🔷 **Exceeds** — implemented, plus goes beyond what the paper describes
- ⚠️ **Deviation** — implemented differently from the paper's text (the paper or the code needs updating before defense)
- ⏳ **Pending** — specified in the paper, tooling exists, but the result/artifact does not exist yet
- ◻ **Not verifiable from the repository**

---

## 1. Executive summary

The system faithfully implements the paper's core architecture — a closed-domain RAG pipeline over Supabase pgvector with Gemini generation, an indirect (no full-text access) library model, the 800/100 token chunking contract, the 85% duplication threshold, LongContextReorder, the data-cleaning rules (including the 15% non-alphanumeric discard and the `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholder), and the complete Objective 2/Objective 4 evaluation harness with the exact statistics the paper promises (Shapiro-Wilk → paired t-test / Wilcoxon, α = 0.05).

**The main differences fall into four groups:**

1. **Version/model drift (⚠️):** most pinned versions in the paper's Tables 1–4 are newer in code, while python-dotenv and JMeter remain exact matches and the managed pgvector version is not repository-verifiable. The Gemini models were replaced (`gemini-1.5-flash` → `gemini-3.6-flash`; `text-embedding-004` → `gemini-embedding-2`, still 768-dimensional).
2. **Orchestration wording (⚠️):** the paper describes LangChain `RetrievalQA` chains and LangChain document loaders. The system uses LangChain *components* (splitter, prompt template, Gemini chat/embedding clients) but the retrieval pipeline itself is custom Python calling Supabase RPCs, with a hand-implemented LongContextReorder.
3. **Production extensions (🔷):** the system adds a large amount the paper never mentions — durable ingestion workers, MFA, malware scanning, rate limiting, RLS deny-by-default, operations dashboards, CI quality gates, guest mode, a superadmin role, and a normalized academic catalog.
4. **Evaluation results (⏳):** the Ragas baseline-vs-RAG comparison and the 50-thesis corpus lock have **not been executed**. The harness is now fail-closed on incomplete faculty validation, calls the deployed guest RAG path, preserves ranked contexts, uses paired Answer Correctness for baseline-vs-RAG inference, and reports Faithfulness/Context Precision as RAG-only diagnostics. JMeter, SonarQube, Pylint, ESLint, PyTest, and LangSmith evidence exists, with the caveats in §7.5.

The core software architecture exists, but “100% complete” would be inaccurate today. Physical hardbound-to-searchable-PDF conversion remains an external scanning prerequisite; institutional/faculty gates remain open; and the proposal's evaluation wording must be revised because Context Precision is not a valid baseline-LLM metric.

---

## 2. Objectives (paper §1.2)

| # | Paper objective | System evidence | Status |
|---|---|---|---|
| 1 | Develop a knowledge retrieval model integrating RAG + LLM **using the LangChain framework** | Full RAG model exists: `services/document_processor.py` → `services/chunker.py` → `services/embedder.py` → `services/retriever.py` → `routers/chat.py`. LangChain is genuinely used (`RecursiveCharacterTextSplitter`, `ChatPromptTemplate`, `ChatGoogleGenerativeAI`, `GoogleGenerativeAIEmbeddings`, LCEL `prompt | llm`), but orchestration is custom, not `RetrievalQA` (see §7.3) | ✅ with ⚠️ wording |
| 2 | Compare baseline LLM vs RAG + LLM on factual accuracy / hallucination mitigation with real institutional queries | `evaluation/run_comparison.py` now runs the same queries concurrently through an unaugmented baseline and the deployed guest RAG path. It pairs **Answer Correctness** against faculty ground truth for statistical comparison and reports RAG **Faithfulness** and **Context Precision** separately. It hard-blocks formal runs on placeholders/incomplete or duplicate panel sign-off and fingerprints the code, dataset, dependencies, runtime, models, and index. The 40 ground truths remain `REPLACE:` placeholders, so **no formal result exists** | ⏳ (harness hardened; execution blocked on PI-09 faculty validation) |
| 3 | Apply the model to build the Centralized AI-Powered Thesis Library System | Full-stack web system operational: React 19 + Vite frontend, FastAPI backend, Supabase pgvector + Storage, durable ingestion worker, chat with citations, novelty scanning, archive catalog, admin console | ✅ 🔷 |
| 4 | Evaluate internal quality via ISO/IEC 25010 (Functional Suitability, Performance Efficiency, Reliability, Maintainability) with automated tools | All four instrument families have dated evidence in `rag-thesis-backend/evaluation/iso25010_evidence.md`. PyTest/Pylint/ESLint/build/Sonar and security checks are CI-wired; JMeter is documented and manually executed, not a CI job. Formal locked-release/real-corpus evaluation remains pending | ✅ tooling / ⏳ formal run |

---

## 3. Scope and delimitations (paper §1.3)

| Paper commitment | System evidence | Status |
|---|---|---|
| Data digitization: convert hardbound/soft copies to searchable PDFs | The application accepts an already-created PDF and extracts/OCRs it in memory for indexing. It does **not** scan hardbound manuscripts or produce a new searchable PDF; that conversion is an external workflow prerequisite | ⚠️ partial |
| Architecture: LangChain orchestration + Gemini embeddings + Supabase vector DB + Gemini LLM | All four present; embeddings/LLM are newer Gemini releases (§4.3); LangChain used as component library (§7.3) | ✅ with ⚠️ versions |
| Quantitative comparative test (baseline vs RAG) | Harness ready, not yet executed | ⏳ |
| Integration into web system + ISO/IEC 25010 internal-quality evaluation | Done; formal final evaluation scheduled (PI-10) | ✅ / ⏳ |
| **Corpus restriction:** CCSICT undergraduate theses only | Server-enforced department scoping: guests hard-locked to CCSICT, users locked to profile department (`dependencies/auth.py` — `resolve_effective_department()`); `thesis_evaluation_department = 'CCSICT'` (`config.py:35`). The *application* additionally supports validated multi-department administration for the future — the formal evaluation boundary stays CCSICT | ✅ 🔷 |
| **External knowledge isolation:** no open-internet search; closed-domain only | No web-search integration exists anywhere. Prompts force answers exclusively from `<retrieved_context>`; empty context returns an explicit no-result message; model self-reported no-evidence answers are intercepted (`routers/chat.py`) | ✅ |
| **Content generation limits:** no original research content / thesis chapters | Deterministic refusal guards (`services/guards.py`): generation verbs × prohibited artifacts (thesis, chapter, RRL, methodology…) blocked, plus prompt-injection patterns; applied to questions, history, and rewritten follow-ups; also rule #4 of the RAG prompt | ✅ 🔷 |
| **Network dependency:** requires internet for cloud DB + LLM API | Matches: Supabase cloud + Gemini API; no offline mode | ✅ |
| **Dataset volume limit:** 50 theses, purposive sampling, scalable later | Archive is deliberately *not* hard-capped (matches the paper's "designed to scale incrementally"). The fixed 50-thesis **evaluation corpus** is governed by an immutable-manifest protocol with SHA-256 receipts (`scripts/corpus_manifest.py`, `docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md`) — manifest not yet locked, approvals pending | ⏳ (tooling ✅) |
| **Complex data extraction limits:** skip un-parseable visuals, keep surrounding text | `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholder injected (`services/document_processor.py:34`); noise chunks with >15% non-alphanumeric discarded (`is_noise_chunk`, line 125) | ✅ |
| **Indirect access model:** users can never view/download/browse full text | Enforced end-to-end: private `pdfs` bucket + *restrictive* storage policy denying anon/authenticated (`supabase_setup.sql:1159`); API returns citation metadata only (`services/retriever.py` — `public_source()`); frontend has **no** PDF viewer, download link, or `/thesis/:id` route (verified absent) | ✅ |
| **Duplication parameter:** flag at ≥ 85% cosine similarity, alert user, show exact %, summarize the matched study | `duplication_threshold = 0.85` (`config.py:34`), comparison is `>= 0.85` (85.00% flags). Alert includes similarity %, matched paper metadata, and an AI-generated summary of the match (`routers/chat.py` — `_summarize_duplication`) | ✅ 🔷 (three enforcement points, §7.4) |

---

## 4. Technology stack — paper Tables 1–4 vs code

### 4.1 Frontend (paper Table 1)

| Technology | Paper | Actual (`rag-thesis-frontend/package.json`) | Status |
|---|---|---|---|
| React | v19.2.5 | **19.2.8** | ⚠️ newer patch |
| JavaScript (JSX) ES6+ | ✔ | All sources are `.js`/`.jsx`; no TypeScript anywhere | ✅ |
| Vite | v8.0.8 | **8.1.5** | ⚠️ newer |

Not in the paper but load-bearing in the build (🔷): Tailwind CSS 4.3.3, `react-router` 8.3.0, TanStack React Query 5.101.4, axios 1.18.1, `@supabase/supabase-js` 2.110.8, Framer Motion 12.42.2, three.js 0.185.1 (+ react-three-fiber/drei), Radix UI primitives, Recharts 3.10.0, react-markdown 10.1.0, `@material/material-color-utilities` 0.4.0 (Material 3 theming), sonner, lucide-react, Playwright 1.61.1 (E2E). Node pinned `>=24.18.0 <25`, npm 11.16.0.

### 4.2 Backend (paper Table 2)

| Technology | Paper | Actual (`rag-thesis-backend/requirements.txt`) | Status |
|---|---|---|---|
| FastAPI | v0.135.3 | **0.139.2** | ⚠️ newer |
| Pydantic | v2.12.5 | **2.13.4** | ⚠️ newer |
| python-multipart | v0.0.24 | **0.0.32** | ⚠️ newer |
| python-dotenv | v1.2.2 | **1.2.2** | ✅ exact match |

Not in the paper (🔷): uvicorn[standard] 0.51.0, pydantic-settings 2.14.2, tiktoken 0.13.0, langsmith 0.10.10, pymupdf 1.28.0, tesserocr 2.10.0 + tessdata.eng 1.0.0, Pillow 12.3.0, slowapi 0.1.10, redis 8.0.1, cryptography 49.0.0, PyJWT 2.13.0, httpx 0.28.1, pytest-cov 7.1.0. Python is pinned **3.14.6** by the container assertion and CI (the paper never states a Python version). The unused top-level `langchain` package was removed; the project pins only the LangChain component packages it imports.

### 4.3 AI / RAG orchestration (paper Table 3)

| Technology | Paper | Actual | Status |
|---|---|---|---|
| Supabase (Python client) | v2.28.3 | **supabase 2.31.0** | ⚠️ newer |
| pgvector | v0.7.0 (managed via Supabase) | Extension enabled via `create extension vector` (`supabase_setup.sql:23`); version is Supabase-managed, not pinned in the repo. **HNSW** cosine index in use (`chunks_embedding_idx`, requires pgvector ≥ 0.5) | ◻ version / ✅ usage |
| langchain-google-genai | v4.2.1 | **4.3.1** (+ langchain-core 1.5.1 and langchain-text-splitters 1.1.2; no unused top-level `langchain` requirement) | ⚠️ newer |
| LLM: **Gemini 1.5 Flash** | `gemini-1.5-flash` | **`gemini-3.6-flash`** for grounded chat + **`gemini-3.5-flash-lite`** for bounded verdict/extraction work (`config.py:16-17`). Upgraded under roadmap PI-03 ("current stable Gemini models"); the paper's 1.5 line is no longer the current stable release line. Deployment overrides are captured in the release fingerprint (`scripts/release_fingerprint.py`) | ⚠️ **deviation — paper must be updated** |
| Embeddings: **text-embedding-004** | 768-dim | **`models/gemini-embedding-2`** with `output_dimensionality=768` (`config.py:18-21`, `services/embedder.py`). The paper's 768-dimension claim is preserved and hard-enforced: `Literal[768]` in config, `vector(768)` column, and a DB check constraint; per-index embedding provenance blocks cross-model retrieval (`services/index_provenance.py`, `paper_index_versions`) | ⚠️ model name / ✅ dimensions |

### 4.4 Testing & QA (paper Table 4)

| Technology | Paper | Actual | Status |
|---|---|---|---|
| PyTest | v8.1.1 | **9.1.1** | ⚠️ newer |
| Apache JMeter | v5.6.3 | **5.6.3** — all four `.jmx` plans declare `jmeter="5.6.3"` | ✅ exact match |
| SonarQube | v10.4 | Evidence was produced on **SonarQube Community Build 26.7.0.124771** (SonarScanner CLI 8.0.1.6346) — `evaluation/iso25010_evidence.md:35`. The README still documents a 10.4 docker command as the paper-matching option | ⚠️ newer used for evidence |
| Pylint | v3.1.0 | **4.0.6** | ⚠️ newer |
| ESLint | v9.0.0 | **9.39.5** | ⚠️ newer |

🔷 QA tooling beyond the paper: pytest-cov coverage gate, Playwright E2E suite, `pip check` + pip-audit, npm audit, Gitleaks secret scan, Trivy container scans, GitHub Actions quality workflow, OpenAPI contract snapshot + SHA-256, release fingerprinting.

### 4.5 Hardware (paper Table 5)

The paper specifies the researchers' development laptop (i5 13th gen, RTX 4050, 16 GB, 1 TB, Wi-Fi 6). ◻ Not verifiable from the repository; nothing in the system contradicts it. The deployment target actually documented is Docker on the defense PC + Cloudflare tunnel + Supabase/Gemini free tiers (`ISU_ECHAGUE_PRODUCTION_ROADMAP.md` §4) — a deployment detail the paper does not cover.

---

## 5. Data (paper §3.1.3)

| Paper statement | System evidence | Status |
|---|---|---|
| Source: CCSICT undergraduate theses, physical + digital | Ingestion supports both digital-native PDFs and scanned manuscripts (OCR fallback) | ✅ |
| All files converted to searchable PDF | Upload accepts an existing PDF only (extension + MIME + `%PDF-` magic bytes); OCR creates index text, not a replacement searchable PDF. `/duplication/scan` additionally accepts TXT drafts | ⚠️ external conversion prerequisite |
| Originals kept in a Supabase storage bucket | Private `pdfs` bucket (`public = false`) with a restrictive deny policy for all client roles | ✅ 🔷 |
| ~15,000–20,000 words per thesis; 300–500 KB PDFs; ~100–200 KB vectors per thesis | Size *estimates*, not limits. The system's operational limits are 25 MB / 500 pages per upload (`config.py:47-48`) | ◻ estimates / ✅ compatible |
| Vector dataset = the only knowledge base for the AI (no external sources) | `match_chunks` RPC over `chunks.embedding vector(768)` is the sole evidence source; closed-domain prompts | ✅ |

---

## 6. Methodology — research design & statistics (paper §3.2.1, §3.2.5)

| Paper commitment | System evidence | Status |
|---|---|---|
| Purposive sampling of 50 theses across tracks | Governance + per-thesis eligibility checklist + immutable manifest tooling exist (PI-08); corpus not yet selected/locked; approvals `BLOCKED-EXTERNAL` | ⏳ |
| Control env: unaugmented baseline Gemini (parametric memory only) | `evaluation/run_comparison.py` — `BASELINE_PROMPT` invoked with no retrieved context | ✅ |
| Experimental env: RAG-constrained model retrieving from Supabase before answering | Same file calls the deployed guest `_chat_impl()` path and captures its ranked retrieval context through a private, non-serialized evaluation trace | ✅ |
| Identical queries through both models | Both pathways iterate the same Golden Dataset | ✅ |
| Golden Dataset: 30–50 curated queries + ground truths validated by 3 CCSICT faculty | 40 queries exist (within range); **all ground truths are placeholders**; `validated_by_faculty_panel: false`; panel slots empty (PI-09) | ⏳ |
| Ragas evaluation: Faithfulness + Context Precision, called “reference-free” by the paper | The hardened Ragas 0.4.3 harness uses faculty references for paired Answer Correctness; Faithfulness and Context Precision are RAG-only diagnostics with separate ranked contexts. Official Ragas defines Context Precision as retriever ranking quality and its reference form uses a reference answer, so it cannot validly score an unaugmented baseline retriever | ⚠️ paper methodology must be revised |
| Arithmetic mean over test iterations | Mean/aggregation implemented in the harness and in `evaluation/summarize_jmeter.py` (plus p95/p99 beyond the paper) | ✅ 🔷 |
| Shapiro-Wilk normality → paired t-test, else Wilcoxon Signed-Rank; α = 0.05 | `statistical_treatment()` — `stats.shapiro` → `ttest_rel` / `wilcoxon`, `significant_at_0.05` (`run_comparison.py:131-153`) | ✅ exact |
| LangSmith latency tracing | Implemented and privacy-hardened (§7.5) | ✅ |

**Bottom line for Objective 2:** the experiment is fully coded with the corrected metric semantics above but has *never produced formal results*. The admin dashboard deliberately shows "Ragas comparison pending faculty validation" instead of scores. This is documented, honest sequencing (PI-09 → PI-10); the remaining blockers are external validation and execution, while the paper's metric wording still requires revision.

### SDLC (paper §3.2.2 — Iterative Model)

◻/✅ Soft-verified: the repo's history matches an iterative process — ten dated migrations (2026-07-17 → 2026-07-25), a historical change plan (38 tracked items), and a versioned roadmap with per-iteration verification audits. Chunk size/overlap are `Literal`-locked; retrieval/duplication settings remain server-owned environment values. The release/evaluation fingerprint now records their effective values plus the config and production prompt-source hashes.

---

## 7. System procedures (paper §3.2.3) — the four phases

### 7.1 Phase 1 — Data digitization

| Paper | System (`services/document_processor.py`) | Status |
|---|---|---|
| PyMuPDF for digital-native text extraction | `import fitz`; per-page `get_text()` | ✅ |
| Tesseract OCR **or** EasyOCR for scanned pages | Tesseract chosen, via `tesserocr` 2.10.0 (+ pinned English model); triggers when a page has < 40 extractable chars and images | ✅ (choice resolved) |
| Regex cleaning: strip OCR artifacts, page numbers, headers, footers | `_clean_page()` + `_detect_repeated_lines()` — page-number lines, running headers/footers, TOC dot-leaders, control chars | ✅ |
| Exclude Table of Contents and bibliographies | `_EXCLUDED_SECTION_HEADINGS` drops TOC, bibliography, references — plus acknowledgements, dedication, approval sheet, CV, lists of figures/tables | ✅ 🔷 |
| Discard chunks with > 15% non-alphanumeric characters | `is_noise_chunk(max_non_alnum_ratio=0.15)`; enforced with a logged discard | ✅ |
| Inject `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholder | `FIGURE_PLACEHOLDER` constant, injected during extraction; unit-tested | ✅ |
| — (not in paper) | **PII redaction**: emails, PH phone numbers, student numbers, addresses, participant IDs, signatures (`_PII_RULES`, `redact_pii()`), with redaction statistics stored per paper | 🔷 |

### 7.2 Phase 2 — Semantic indexing & metadata injection

| Paper | System | Status |
|---|---|---|
| LangChain `RecursiveCharacterTextSplitter` | `RecursiveCharacterTextSplitter.from_tiktoken_encoder(...)` (`services/chunker.py:83-91`) | ✅ |
| 800-token chunks, 100-token overlap | `chunk_size=800, chunk_overlap=100`, hard-locked as `Literal[800]`/`Literal[100]` in `config.py:30-31`; DB provenance check pins `token-v1`/`cl100k_base`/800/100 | ✅ |
| Token counting | **Nuance:** tokens are measured with the local `cl100k_base` tiktoken proxy, because Gemini's tokenizer is private. The module documents this explicitly. The paper should adopt this wording | ⚠️ wording |
| Metadata tagging: JSON with Title, Author, Track, Year | `build_chunk_metadata()` carries title, author, track, year — **plus** department, page range (`page_start`/`page_end`), section, chunk index, token count, tokenizer, and chunking version | ✅ 🔷 |
| Gemini `text-embedding-004` → vectors in Supabase | `GoogleGenerativeAIEmbeddings` with `gemini-embedding-2` @ 768 dims (see §4.3); stored in `chunks.embedding vector(768)` with HNSW cosine index | ⚠️ model / ✅ pipeline |
| — (not in paper) | Cross-page overlap preservation and page/section mapping for citations; immutable per-index embedding provenance (`paper_index_versions`) that blocks retrieval across incompatible embedding spaces | 🔷 |

### 7.3 Phase 3 — RAG pipeline development

| Paper | System | Status |
|---|---|---|
| LangChain **`RetrievalQA`** chains | **Not used.** Retrieval is custom: query embedded → `match_chunks` Supabase RPC (cosine, department-scoped, provenance-checked) → grouping/citation assignment → reorder → LCEL `prompt | llm` generation (`services/retriever.py`, `routers/chat.py`). No `RetrievalQA`, `as_retriever`, or LangChain `VectorStore` anywhere. The paper's architecture description must be rewritten to match | ⚠️ **deviation — paper must be updated** |
| Retrieve top-k most relevant vectors | top-k default = **5**, server-owned (`retrieval_match_count`, `config.py:33`); client overrides are ignored and the effective deployment value is fingerprinted | ✅ |
| `LongContextReorder` to fix "Lost in the Middle" | Reimplemented by hand with the same algorithm, credited to Liu et al. 2024 (`services/retriever.py:28-41`); unit-tested; most relevant chunks placed at both ends of the context | ✅ (re-implementation, not the LangChain class) |
| Minimum cosine similarity threshold; explicitly say when nothing relevant is found | Threshold default **0.30**, server-owned (`config.py:32`) and fingerprinted; empty results return an explicit no-relevant-thesis response, and self-reported no-evidence answers are intercepted so sources are never fabricated | ✅ |
| Screen new submissions at ≥ 85%; alert with exact match % | Ingest-time `screen_new_submission()` (`services/novelty.py`) runs after embedding but *before* indexing (so a paper is never compared with itself); flags, never blocks; result persisted in `papers.duplication_scan` | ✅ 🔷 |
| — (not in paper) | Citation engine: stable chunk-level citation IDs, marker normalization/validation, one bounded AI repair pass, deterministic coverage enforcement, cited-only source filtering (`services/citations.py`); prompt-injection guards; author-lookup and greeting fast paths; follow-up query rewriting with grounded re-retrieval; Gemini capacity circuit breaker | 🔷 |

### 7.4 Duplication / novelty — the paper's 85% parameter, as built

The single 85% threshold from the paper is enforced at **three** points (all reading `duplication_threshold = 0.85`):

1. **Upload ingestion** — automatic screening of every new submission (paper Phase 3) → verdict tiers `clear` / `review_suggested` (<50% coverage) / `high_overlap` (≥50% coverage), stored and shown in the archive.
2. **Chat query time** — concurrent duplication check on every question; flagged responses carry similarity %, matched paper, and an AI summary (paper §3.3's query-time flagging).
3. **Faculty novelty scanner** (`/novelty` + `POST /duplication/scan`) — upload a proposal draft (PDF/TXT), get metadata-only per-study matches, advisory explanation, scan history, follow-up Q&A, and a downloadable metadata-only JSON report. Matched excerpts remain server-internal for the bounded adviser assistant; the dead excerpt UI was removed to preserve indirect access. 🔷 Beyond the paper.

⚠️ Reporting nuance for the paper: the system reports **two** numbers (highest passage similarity and matched-chunk coverage), while the paper implies one similarity percentage. The verdict is explicitly advisory — "faculty review required," never an automated accept/reject.

### 7.5 Phase 4 — System integration & evaluation instruments (paper §3.2.3-4, §3.2.4)

| Paper instrument | System evidence (measured, dated) | Status |
|---|---|---|
| **PyTest** (Functional Suitability) | Current source: 28 test modules / 315 test functions before parameter expansion. Dated evidence: **342 passed + 3 skipped, 83.29% coverage**; PI-03 release gate: **349 passed + 3 skipped, 86.03%**. The post-audit suite collected 359 cases and passed **356 + 3 skipped at 85.86% coverage**. CI enforces `--cov-fail-under=85`; historical evidence remains unchanged | ✅ |
| **Ragas** (Functional Suitability, RAG accuracy) | Harness ✅; execution ⏳ (§6) | ⏳ |
| **LangSmith** (Performance Efficiency: latency + tokens) | Wired into the live path: spans for embedding, duplication, retrieval, generation, citation-repair, total (`services/observability.py`, `routers/chat.py`). Privacy-hardened: inputs/outputs hidden by default, exporter *raises* if any payload content appears. Evidence: 63-run export with prompt/completion token counts, `evaluation/results/langsmith.json` | ✅ 🔷 |
| **Apache JMeter** (Performance Efficiency) | Provider-independent availability profile: 900/900 HTTP 200, 0% errors, avg 83.78 ms, p95 204.05 ms, p99 286.01 ms, 10.117 req/s. It exercised health/tracks/analytics, observed max concurrency 2 despite 20 configured users, and did not load-test RAG chat. Rate-limit behavior passed; live Gemini was only three one-user calls against an empty corpus | ✅ baseline evidence / ⏳ real-corpus concurrent RAG test |
| **SonarQube** (Reliability) | Reported gate **passed** with 0 bugs, vulnerabilities, or hotspots and 0.6% duplication (Community Build 26.7.0), but the export also records `ignoredConditions: true`, new coverage 25% vs 80% threshold, whole-repo coverage 36.3%, and 280 unresolved code smells | ⚠️ evidence exists; formal clean gate pending |
| **Pylint** (Maintainability) | **10.00/10** (`.pylintrc`, enforced in CI) | ✅ |
| **ESLint** (Maintainability) | **0 errors / 0 warnings** (ESLint 9.39.5 flat config) | ✅ |
| — (not in paper) | Playwright E2E critical flows, frontend unit tests (24/24), production build gate, pip-audit/npm audit, Gitleaks, Trivy container scans, `/health` `/ready` probes | 🔷 |

### 7.6 Ethical considerations (paper §3.2.6)

| Paper commitment | System evidence | Status |
|---|---|---|
| Written approval from CCSICT Chair + University Librarian before digitization | Formal four-gate approval register (Chair, Librarian, Data Protection Officer, thesis adviser) in `docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md` — all four rows currently **Pending / BLOCKED-EXTERNAL** | ⏳ (protocol 🔷 exceeds the paper — it adds a DPO gate and per-thesis privacy screening) |
| RA 10173 (Data Privacy Act): no PII beyond title, author, track, year is extracted, stored, or exposed | Regex redaction reduces indexed-text exposure and public chat alerts are now metadata-only. It is best-effort, not proof of complete removal; original PDFs are deliberately stored privately and required per-manuscript privacy review/approvals remain pending | ⚠️ partial / ⏳ human review |
| Indirect access protects intellectual property | Enforced (§3) | ✅ |
| Retrieval assistant, not content generator; anti-plagiarism constraints | Deterministic refusal guards + grounded-only prompts (§3) | ✅ |
| All responses include traceable citations | Chunk-level citation IDs with title/authors/year/pages/section/similarity; structural validation + repair. Documented limit: validation proves marker coverage, **not semantic entailment** — faculty review remains required | ✅ |

---

## 8. System architecture (paper §3.3, Figure 8) — layer by layer

| Paper component | As built | Status |
|---|---|---|
| **UI Layer** — admins upload; students/faculty/researchers query via Web UI | React SPA: `/upload` wizard (admin/superadmin by default; student/faculty possible via feature toggle), `/chat`, `/archive`, `/novelty`, `/dashboard`, `/admin`. Roles as built: **guest researcher (unauthenticated), student, faculty, admin, superadmin** — the paper's generic "Researcher" is realized as the unauthenticated Guest Researcher, and superadmin is new | ✅ with ⚠️ actor list |
| **Application Layer — Document Processing System** (multipart upload) | `POST /upload/paper` (202 Accepted): multipart parsing, validation (extension/MIME/magic bytes/size/pages/encryption), private staging, then a **durable PostgreSQL-leased job queue** processed by a separate worker process (`workers/ingestion_worker.py`) with heartbeats, retries, cooperative cancellation, and atomic commit — a major reliability upgrade over the paper's synchronous flow | ✅ 🔷 |
| **Application Layer — Query Processor** (FastAPI, NLP intent) | `POST /chat` with guards, follow-up rewriting, fast paths, department resolution | ✅ |
| **Application Layer — RAG Pipeline** (`RetrievalQA`) | Custom pipeline (see §7.3) | ⚠️ wording |
| **Application Layer — Response Generator** (Gemini 1.5 Flash) | `ChatGoogleGenerativeAI` on `gemini-3.6-flash`; defaults are 700 max output tokens, 25 s timeout, and thinking level low. Environment overrides are possible and effective values are now fingerprinted | ⚠️ model |
| **Application Layer — query-time 85% duplication flagging** | Implemented exactly (concurrent check + `duplication_alert`) | ✅ |
| **Embedding Layer** — PyMuPDF loader → LangChain chunker → `text-embedding-004` | PyMuPDF (+OCR) → `RecursiveCharacterTextSplitter` (tiktoken proxy) → `gemini-embedding-2` @768 | ✅ with ⚠️ model |
| **Data Storage Layer** — Supabase pgvector + Supabase Storage | `chunks vector(768)` + HNSW + `match_chunks`/`check_topic_duplication` RPCs (service-role only); private `pdfs` bucket; plus 18 tables incl. sessions, scan history, jobs, workers, alerts, audit events — all RLS deny-by-default | ✅ 🔷 |

---

## 9. What the system adds that the paper never describes (🔷)

The paper should present these as production extensions, distinct from the fixed CCSICT experiment:

- **Security:** Supabase Auth JWT verification, role/status gating (pending/approved/rejected), TOTP MFA with AAL2 enforcement for privileged accounts, Cloudflare Turnstile, per-user + per-IP rate limiting (Redis-backed in production; signature-verified JWT keying), ClamAV malware scanning (fail-closed), upload hardening (magic bytes, encrypted-PDF rejection, filename sanitization), prompt-injection guards, RLS deny-by-default with column-level profile protections, security headers/CSP, HMAC-signed ops webhooks, encrypted backups (Scrypt+AES), secret-rotation runbook, privacy-filtering logger that redacts tokens/secrets/JWTs.
- **Reliability/operations:** durable ingestion job queue (leases, heartbeats, bounded retries with `Retry-After`, idempotency keys, cooperative cancellation, atomic commit, cleanup queue), worker registry with health states, deduplicated operational alerts + acknowledgement, retention dry-run tooling, superadmin Operations dashboard, `/health`, `/ready`, `/health/worker`.
- **Product:** Guest Researcher demo mode, chat sessions (rename/delete/history), suggested starters, stop/retry/edit controls, archive metadata catalog with program/specialization filters, AI metadata autofill on upload, 7-stage upload progress with refresh-safe resume, novelty scanner with metadata-only match comparison + bounded follow-up chat + JSON report, admin analytics (Recharts), user directory with approval workflow, role-feature permission matrix with realtime propagation, normalized academic catalog (departments → programs → specializations, PI-04), avatars, command palette, Material 3 theming, high-contrast/reduced-motion/low-energy accessibility modes, progressive 3D.
- **Engineering:** CI quality gate (PyTest/Pylint/ESLint/build/Playwright/audits/Gitleaks/Trivy/SonarQube), OpenAPI contract snapshot with SHA-256, release fingerprinting, immutable corpus-manifest tooling, dated evidence bundles, Chainguard non-root backend images, an nginx Alpine frontend image, multi-arch evidence, and `docker-compose.operations.yml`. Base-image digests and fully hash-locked Python transitive dependencies remain a reproducibility improvement.

Post-defense features (SSE streaming, hybrid retrieval/reranking, PWA) are explicitly **deferred and disabled** so the evaluated pipeline stays identical to the paper's (roadmap §3) — consistent with the paper's controlled-experiment intent.

---

## 10. Outstanding gaps — paper promises without results yet (⏳)

All tracked in `ISU_ECHAGUE_PRODUCTION_ROADMAP.md` (defense target 2026-08-28):

| Gap | Paper section | Blocker | Roadmap item |
|---|---|---|---|
| Written institutional approvals (Chair, Librarian, privacy officer, adviser) | §3.2.6 | External signatures | PI-08 (BLOCKED-EXTERNAL) |
| Immutable, locked 50-thesis evaluation corpus | §1.3, §3.2.1 | PI-08 approvals + per-thesis privacy screening | PI-08 |
| Faculty-validated Golden Dataset ground truths (3-member panel) | §3.2.1 | Faculty panel | PI-09 (BLOCKED-EXTERNAL) |
| Ragas baseline-vs-RAG comparison + Shapiro-Wilk/t-test/Wilcoxon results | §3.2.1, §3.2.4-5 | PI-09 | PI-10 |
| Formal ISO/IEC 25010 final evaluation on the locked release (incl. JMeter rerun against the real corpus) | §3.2.4 | PI-07/PI-09 | PI-10 |
| Production deployment rehearsal / public HTTPS validation | (implied by deployment) | Hosting | PI-07 |

These external gates cannot be completed in code. The 2026-07-28 audit did, however, find and repair code/documentation gaps in evaluation validity, public duplication-alert privacy, dependency declarations, fingerprints, and stale quality configuration. Physical scanning/searchable-PDF production remains an operational prerequisite rather than an implemented feature.

---

## 11. Recommended paper revisions (to match the as-built system)

1. **Regenerate Tables 1–4** from `requirements.txt`, `package.json`, and `config.py` (most versions drifted; add Python 3.14.6, Node 24.18, and the additional dependencies that matter: tiktoken, tesserocr, slowapi, redis, cryptography, langsmith, Tailwind, react-router, TanStack Query).
2. **Replace the model names:** `gemini-3.6-flash` (chat) + `gemini-3.5-flash-lite` (verdict/extraction) + `gemini-embedding-2` at 768 dimensions, with the release-fingerprint freeze policy for the experiment.
3. **Rewrite the `RetrievalQA` and "LangChain document loaders" descriptions** to the actual pipeline: PyMuPDF/tesserocr extraction → LangChain `RecursiveCharacterTextSplitter` (tiktoken `cl100k_base` proxy for the 800/100 contract) → Gemini embeddings → `match_chunks` pgvector RPC → hand-implemented LongContextReorder → grounded LCEL generation with citation validation/repair.
4. **State the evaluated retrieval constants:** server-owned defaults similarity threshold 0.30, top-k 5, and `>= 0.85` duplication. Freeze their effective values in the signed release/evaluation fingerprint; they are environment-overridable rather than `Literal` constants.
5. **Update the actor model:** add Guest Researcher (unauthenticated, CCSICT-locked, no history) and superadmin; remove the standalone "Researcher" role.
6. **Document the dual duplication metrics** (highest passage similarity + matched-chunk coverage) and the advisory verdict tiers.
7. **Update the SonarQube version** actually used for Reliability evidence (Community Build 26.7.0) or rerun on 10.4.
8. **Add the durable ingestion worker and security controls** to the architecture (Figure 8) and system-procedures sections, clearly separated from the fixed experiment.
9. **Correct the Objective 2 methodology:** paired Answer Correctness against faculty ground truth is the baseline-vs-RAG outcome; Faithfulness and Context Precision are RAG-only diagnostics. Do not call reference-based Context Precision “reference-free.”
10. **State the digitization boundary:** physical scanning/searchable-PDF creation happens before upload; the application OCRs PDF pages into index text but does not emit a searchable PDF.
11. **Report only measured results with their limitations** (especially the non-chat JMeter profile and ignored Sonar conditions) and keep Ragas/statistical claims pending until PI-10 completes.

---

## Appendix — corrections completed during independent verification

- Updated Sonar and Pylint's Python target from 3.12 to 3.14 and the README coverage command to the CI's 85% gate (including workers).
- Declared PyJWT 2.13.0 directly, classified production `httpx` correctly, and removed the unused top-level `langchain` dependency.
- Updated stale historical-plan model text and removed deprecated Gemini sampling parameters from the release smoke.
- Pinned the optional evaluation dependency set and hardened formal dataset validation, pairing, exact production-path execution, ranked-context handling, and reproducibility fingerprints.
- Removed archived abstract/chunk text from the public/persisted duplication-alert schema and removed unreachable excerpt-comparison UI.
- Corrected this document's test counts, CI/JMeter/Sonar claims, digitization boundary, privacy status, container description, and Objective 2 metric semantics.
- **Cross-check of the audit itself (2026-07-28):** the audit's new harness test failed in a production-dependencies-only environment because `statistical_treatment()` imported scipy before its guard clauses; the import now happens only when a real statistical test runs, so the suite passes without the evaluation extras (matching CI, which installs `requirements.txt` only). Re-verified afterwards: 356 passed + 3 skipped at 85.86% coverage, Pylint 10.00/10, ESLint 0/0, 24/24 frontend unit tests, production build clean.
- **Open runtime caveat:** the pinned evaluation extras (`ragas==0.4.3`, `google-genai==2.13.0`, `datasets==5.0.0`, `pandas==3.0.5`, `scipy==1.18.0`, `langchain-community==0.4.1`) resolve on PyPI and are installed in the separate `.venv3146` evaluation environment. The Ragas 0.4.3 metric constructors and empty-row path execute successfully, while the production-only `.venv` correctly excludes those extras. No real, non-empty Ragas scoring call has yet run end to end; before PI-10, run a bounded development scoring smoke with approved or synthetic content, then preserve the formal run for the locked, faculty-validated dataset.
