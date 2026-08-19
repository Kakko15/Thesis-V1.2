# Thesis Proposal vs. Implemented System — Verified Comparison

| Control | Value |
|---|---|
| Paper compared | `Final Thesis Proposal Paper_Update Carlo.pdf` — 52 pages, full text re-extracted with PyMuPDF and read end to end |
| System compared | Working tree at commit `9228da2` plus the uncommitted frontend work (React-key fixes, `src/lib/keys.js`, `e2e/accessibility.spec.js`, `e2e/global-setup.js`, Playwright config) |
| API version | `2.1.0` (`rag-thesis-backend/main.py:53`) |
| Comparison date | **2026-08-03** |
| Method | Every claim is traced to a source file and line, or to a command executed today (Appendix A), or to a dated evidence artifact in the repository. Version numbers come from `requirements.txt`, `package.json`, and `config.py`. Nothing was carried forward unverified from the superseded 2026-07-28 report. |

**Legend**

| Mark | Meaning |
|---|---|
| ✅ | **Aligned** — implemented as the paper specifies |
| 🔷 | **Exceeds** — implemented, and goes beyond what the paper describes |
| ⚠️ | **Deviation** — implemented differently from the paper's text; the paper or the code must be updated before defense |
| ⏳ | **Pending** — specified in the paper, tooling exists, but no result/artifact exists yet |
| ◻ | **Not verifiable** from the repository alone |

---

## 1. Executive summary

The system is a faithful, and in most places substantially stronger, implementation of the proposal. Every architectural commitment in Chapter 3 exists in code and is enforced at runtime: the closed-domain RAG pipeline over Supabase pgvector with Gemini generation, the indirect (no full-text) library model, the 800-token / 100-token chunking contract, the 85% cosine-similarity duplication threshold, LongContextReorder against "Lost in the Middle", the complete data-cleaning pipeline (15% non-alphanumeric discard, `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholder, TOC/bibliography exclusion), and the full Objective 2 / Objective 4 evaluation harness including the exact statistics the paper promises (Shapiro-Wilk → paired *t*-test / Wilcoxon at α = 0.05).

**The differences fall into five groups:**

1. **Version and model drift (⚠️).** Most versions in Tables 1–4 are newer in code. `python-dotenv` and JMeter are exact matches; the managed pgvector version is not repository-verifiable. Most consequentially, **the Gemini models were replaced**: `gemini-1.5-flash` → `gemini-3.6-flash`, and `text-embedding-004` → `gemini-embedding-2` (still 768-dimensional).
2. **Orchestration wording (⚠️).** The paper describes LangChain `RetrievalQA` chains and LangChain document loaders. The system uses LangChain *components* — the text splitter, prompt templates, and the Gemini chat/embedding clients — while the retrieval pipeline itself is custom Python calling Supabase RPCs, with a hand-written LongContextReorder. The paper's §2.1, §3.2.3 and §3.3 wording must be rewritten.
3. **Production extensions (🔷).** The system adds a great deal the paper never mentions: a durable leased ingestion worker, TOTP MFA with AAL2 enforcement, malware scanning, rate limiting, RLS deny-by-default, an operations console, CI quality gates, Guest Researcher mode, a superadmin role, and a normalized academic catalog.
4. **Evaluation results (⏳).** The Objective 2 Ragas comparison has **never produced a formal result**. The harness is complete, hardened, and fail-closed, but all 40 Golden Dataset ground truths are still `"REPLACE: …"` placeholders and `validated_by_faculty_panel` is `false`. The Objective 4 instruments all have measured results, with the caveats in §7.5.
5. **A quality gate that was failing when this report was written (✅ now resolved).** The WCAG 2.2 AA accessibility matrix failed with 55 blocking (serious) axe findings and 25 advisory findings. It now reports **0 blocking findings** across 11 surfaces × 4 theme states × {1280 px, 360 px}; the 25 advisory `heading-order` findings remain open. This never affected the paper's four ISO characteristics — Usability is explicitly out of the paper's scope (§3.2.4). Full history in the companion report `SYSTEM_IMPROVEMENTS_AND_BUGS_2026-08-03.md` §2.1 B2.

> **✅ Remediation update — 2026-08-03.** After this comparison was written, the entire Phase A defect backlog in the companion report was remediated: every P0 closed, 15 of 20 confirmed defects fully fixed, 2 partially fixed with the remainder documented, and 3 deliberately deferred to Phase B. Eleven further defects found during that work are catalogued as §2.6 there. **No fix touched the frozen evaluated pipeline** — chunking, retrieval parameters, prompts, and models are unchanged, verified by a value-for-value comparison of all 62 resolved settings and by diffing the refusal guard over all 43 evaluation questions with 0 classification changes. Nothing in §11 of this report (the required paper revisions) is affected.

**Verified after remediation** (2026-08-03): PyTest **539 passed / 3 skipped, 91.28% coverage** against an 85% gate · Pylint **10.00/10** · ESLint **0 errors, 0 warnings** · frontend unit tests **44/44** · Vite production build **3,859 modules, clean** · `npm audit --omit=dev` **0 vulnerabilities** · `pip check` **no broken requirements** · Playwright **21/21 passed** · accessibility matrix **PASSED (0 blocking, 25 advisory)** · OpenAPI drift gate **passing**.

*Originally measured (pre-remediation): PyTest 430 passed / 90.87% · frontend unit tests 29/29 · build 3,855 modules · accessibility matrix FAILED (10 tests, 55 blocking findings).*

**Honest bottom line for the defense:** the *software* of Objectives 1, 3 and 4 is complete and measurably high quality. Objective 2 is coded but unexecuted, blocked on external academic prerequisites (institutional approvals, the locked 50-thesis corpus, and the three-member faculty panel). Physical hardbound-to-searchable-PDF conversion remains an operational prerequisite performed before upload, not a feature of the application. Several passages of the paper describe an architecture the system deliberately does not use, and those passages must be revised (§11).

---

## 2. Objectives (paper §1.2)

| # | Paper objective | System evidence | Status |
|---|---|---|---|
| 1 | Develop a knowledge-retrieval model integrating RAG + LLM **using the LangChain framework** | The complete model exists: `services/document_processor.py` → `services/chunker.py` → `services/embedder.py` → `services/retriever.py` → `routers/chat.py`. LangChain is genuinely used (`RecursiveCharacterTextSplitter`, `ChatPromptTemplate`, `ChatGoogleGenerativeAI`, `GoogleGenerativeAIEmbeddings`, LCEL `prompt \| llm`), but orchestration is custom rather than `RetrievalQA` — see §7.3 | ✅ implementation / ⚠️ wording |
| 2 | Compare baseline LLM vs RAG + LLM on factual accuracy and hallucination mitigation using real institutional queries | `evaluation/run_comparison.py` (433 lines) runs identical queries through an unaugmented baseline and the deployed guest RAG path, pairs **Answer Correctness** against faculty ground truth for the statistical test, and reports Faithfulness and Context Precision as RAG-only diagnostics. It hard-blocks formal runs on placeholder or unvalidated data and fingerprints code, dataset, dependencies, runtime, models, and index. **All 40 ground truths remain placeholders → no formal result exists** | ⏳ harness ✅ / execution blocked |
| 3 | Apply the model to build the Centralized AI-Powered Thesis Library System | Full-stack system operational: React 19 + Vite SPA, FastAPI backend, Supabase pgvector + Storage, durable ingestion worker, citation-backed chat, novelty scanning, archive catalog, admin console, operations console | ✅ 🔷 |
| 4 | Evaluate internal quality via ISO/IEC 25010 (Functional Suitability, Performance Efficiency, Reliability, Maintainability) using automated tools | All four instrument families exist and are CI-wired (`.github/workflows/quality.yml`). Measured today: PyTest 430/3 at 90.87%, Pylint 10.00/10, ESLint 0/0. JMeter is documented and manually executed. SonarQube runs when `SONAR_TOKEN` is present. Formal locked-release evaluation against the real corpus remains pending | ✅ tooling / ⏳ formal run |

---

## 3. Scope and delimitations (paper §1.3)

| Paper commitment | System evidence | Status |
|---|---|---|
| **Data digitization** — convert hardbound and soft copies into searchable PDFs | The application accepts an already-created PDF, then extracts and OCRs it **in memory** for indexing. It does not scan hardbound manuscripts and does not emit a new searchable PDF. That conversion is an external workflow prerequisite | ⚠️ partial — paper must state the boundary |
| **System architecture** — LangChain orchestration + Gemini embeddings + Supabase vector DB + Gemini LLM | All four present. Embeddings and LLM are newer Gemini releases (§4.3); LangChain is used as a component library (§7.3) | ✅ / ⚠️ versions |
| **Experimental testing** — quantitative baseline-vs-RAG comparison | Harness complete, never executed formally | ⏳ |
| **System integration + ISO/IEC 25010 evaluation** | Integrated and instrumented; formal final evaluation pending | ✅ / ⏳ |
| **Corpus restriction** — CCSICT undergraduate theses only | Server-enforced department scoping. Guests are hard-locked to the evaluation department; authenticated users are locked to their profile department; only superadmins may select another, and only from a validated list (`dependencies/auth.py:74-98`). `thesis_evaluation_department = 'CCSICT'` (`config.py:35`). The *application* additionally supports multi-department administration for the future; the formal evaluation boundary stays CCSICT | ✅ 🔷 |
| **External knowledge isolation** — no open-internet search; closed domain only | No web-search integration exists anywhere in the codebase. Prompts force answers exclusively from `<retrieved_context>` (`routers/chat.py:264-297`); empty context returns an explicit no-result message (`routers/chat.py:818-824`); model answers that self-report no evidence are intercepted and replaced (`_answer_reports_no_evidence`, `routers/chat.py:180-195`) | ✅ |
| **Content generation limits** — no original research content or thesis chapters | Deterministic refusal guards in `services/guards.py`: generation verbs × prohibited artifacts (thesis, chapter, RRL, methodology, hypothesis, proposal, conceptual framework, assignment, essay) are blocked, plus prompt-injection patterns. Applied to the question, to loaded history, and to the rewritten follow-up (`routers/chat.py:651-657, 666-668, 757-764`), and restated as rule 6 of the RAG prompt | ✅ 🔷 |
| **Network dependency** — requires internet for the cloud DB and LLM API | Matches exactly: Supabase cloud + Gemini API, no offline mode | ✅ |
| **Dataset volume limit** — 50 theses, purposive sampling, scalable later | The archive is deliberately **not** hard-capped, matching the paper's "designed to scale incrementally". The fixed 50-thesis *evaluation corpus* is governed by an immutable-manifest protocol with SHA-256 receipts (`scripts/corpus_manifest.py`, `docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md`). The manifest is not yet locked; approvals are pending | ⏳ (tooling ✅) |
| **Complex data extraction limits** — skip un-parseable visuals, rely on surrounding text | `FIGURE_PLACEHOLDER = 'FIGURE REDACTED FOR SEMANTIC INDEXING'` injected during extraction (`services/document_processor.py:34, 252-256`); chunks exceeding 15% non-alphanumeric characters discarded (`is_noise_chunk`, `services/document_processor.py:125-135`) | ✅ |
| **Indirect access model** — users can never view, download, or browse full text | Enforced end to end. Private `pdfs` bucket with a restrictive policy denying `anon` and `authenticated`; the API returns citation metadata only (`services/retriever.py:44-66` — `public_source()` never includes content, storage paths, or URLs); the frontend has no PDF viewer, no download link, and no full-text route. The archive detail modal shows metadata and the abstract only (`src/pages/Archive.jsx:266-293`) | ✅ |
| **Duplication parameter** — flag at ≥ 85% cosine similarity, alert the user, show the exact %, summarize the matched study | `duplication_threshold = 0.85` (`config.py:34`); the comparison is inclusive (`>=`), so exactly 85.00% flags (`services/novelty.py:39-41`). The alert carries the similarity percentage, the matched paper's metadata, and an AI-generated summary of the matched study (`routers/chat.py:501-519`), rendered in `src/pages/Chat.jsx:168-208` | ✅ 🔷 — enforced at three points, §7.4 |

---

## 4. Technology stack — paper Tables 1–4 vs. code

### 4.1 Frontend (paper Table 1)

| Technology | Paper | Actual (`rag-thesis-frontend/package.json`) | Status |
|---|---|---|---|
| React | v19.2.5 | **19.2.8** | ⚠️ newer patch |
| JavaScript (JSX), ES6+ | ✔ | All sources are `.js`/`.jsx`; no TypeScript anywhere | ✅ |
| Vite | v8.0.8 | **8.1.5** | ⚠️ newer |

Load-bearing but absent from the paper (🔷): Tailwind CSS 4.3.3, `react-router` 8.3.0, TanStack React Query 5.101.4, axios 1.18.1, `@supabase/supabase-js` 2.110.8, Framer Motion 12.42.2, three.js 0.185.1 with `@react-three/fiber` 9.6.1 + `drei` 10.7.7, Radix UI primitives, Recharts 3.10.0, react-markdown 10.1.0, `@material/material-color-utilities` 0.4.0, sonner, lucide-react, and Playwright 1.61.1 + `@axe-core/playwright` 4.12.1 for E2E and accessibility. Node is pinned `>=24.18.0 <25`, npm `11.16.0`.

### 4.2 Backend (paper Table 2)

| Technology | Paper | Actual (`rag-thesis-backend/requirements.txt`) | Status |
|---|---|---|---|
| FastAPI | v0.135.3 | **0.139.2** | ⚠️ newer |
| Pydantic | v2.12.5 | **2.13.4** | ⚠️ newer |
| python-multipart | v0.0.24 | **0.0.32** | ⚠️ newer |
| python-dotenv | v1.2.2 | **1.2.2** | ✅ exact match |

Absent from the paper (🔷): `uvicorn[standard]` 0.51.0, pydantic-settings 2.14.2, tiktoken 0.13.0, langchain-core 1.5.1, langchain-text-splitters 1.1.2, langsmith 0.10.10, pymupdf 1.28.0, tesserocr 2.10.0 + tessdata.eng 1.0.0, Pillow 12.3.0, slowapi 0.1.10, redis 8.0.1, cryptography 49.0.0, PyJWT 2.13.0, httpx 0.28.1, msgpack 1.2.1, setuptools 83.0.0, pytest-cov 7.1.0. **Python 3.14.6** is pinned by CI and the container; the paper never states a Python version.

### 4.3 AI and RAG orchestration (paper Table 3)

| Technology | Paper | Actual | Status |
|---|---|---|---|
| Supabase (Python client) | v2.28.3 | **supabase 2.31.0** | ⚠️ newer |
| pgvector | v0.7.0 (managed by Supabase) | Extension enabled via `create extension vector` in `supabase_setup.sql`; the version is Supabase-managed and not pinned in the repository. An **HNSW** cosine index is in use, which requires pgvector ≥ 0.5 | ◻ version / ✅ usage |
| langchain-google-genai | v4.2.1 | **4.3.1** | ⚠️ newer |
| LLM: **Gemini 1.5 Flash** (`gemini-1.5-flash`) | | **`gemini-3.6-flash`** for grounded chat and **`gemini-3.5-flash-lite`** for bounded verdict/extraction work (`config.py:16-17`). The 1.5 line is no longer a current stable release line | ⚠️ **deviation — the paper must be updated** |
| Embeddings: **text-embedding-004**, 768-dim | | **`models/gemini-embedding-2`** with `output_dimensionality = 768` (`config.py:18-21`, `services/embedder.py:20-24`). The paper's 768-dimension claim is preserved and hard-enforced three ways: `Literal[768]` in config, a `vector(768)` column, and per-index embedding provenance that blocks retrieval across incompatible embedding spaces (`services/index_provenance.py`, `paper_index_versions`) | ⚠️ model name / ✅ dimensions |

### 4.4 Testing and QA (paper Table 4)

| Technology | Paper | Actual | Status |
|---|---|---|---|
| PyTest | v8.1.1 | **9.1.1** — measured today: 430 passed, 3 skipped, 90.87% coverage | ⚠️ newer |
| Apache JMeter | v5.6.3 | **5.6.3** — all five `.jmx` plans declare `jmeter="5.6.3"` | ✅ exact match |
| SonarQube | v10.4 | The retained evidence was produced on **Community Build 26.7.0.124771** with SonarScanner CLI 8.0.1.6346 (`evaluation/iso25010_evidence.md:35`). The README still documents a 10.4 Docker command as the paper-matching option | ⚠️ newer used for evidence |
| Pylint | v3.1.0 | **4.0.6** — measured today: 10.00/10 | ⚠️ newer |
| ESLint | v9.0.0 | **9.39.5** — measured today: 0 errors, 0 warnings | ⚠️ newer |

QA tooling beyond the paper (🔷): pytest-cov with an enforced 85% gate, a Playwright E2E critical-flows suite, a Playwright + axe-core WCAG 2.2 AA matrix, a visual-quality matrix, `pip check`, pip-audit, `npm audit`, Gitleaks secret scanning, Trivy container scanning, a GitHub Actions quality workflow, an OpenAPI contract snapshot with drift detection enforced by `tests/test_export_openapi.py`, and release fingerprinting (`scripts/release_fingerprint.py`).

### 4.5 Hardware (paper Table 5)

◻ The paper specifies the researchers' development laptop (Intel Core i5 13th gen, RTX 4050, 16 GB RAM, 1 TB NVMe, Wi-Fi 6). This is not verifiable from the repository and nothing in the system contradicts it. Note that **no GPU is used anywhere** — all embedding and generation is remote Gemini API work, and OCR is CPU-bound Tesseract. The RTX 4050 row is therefore not a technical requirement of the architecture and should be described as the development machine's specification rather than a system requirement.

---

## 5. Data (paper §3.1.3)

| Paper statement | System evidence | Status |
|---|---|---|
| Source: CCSICT undergraduate theses, physical and digital | Ingestion supports digital-native PDFs and scanned manuscripts via a per-page OCR fallback triggered when a page has fewer than 40 extractable characters but contains images (`services/document_processor.py:58, 248-251`) | ✅ |
| All files converted into searchable PDFs | Upload accepts an existing PDF only, validated by extension, MIME type, and `%PDF-` magic bytes, and rejected if encrypted (`routers/upload.py:99-126`). OCR produces index text, not a replacement searchable PDF. `/duplication/scan` additionally accepts TXT drafts | ⚠️ external conversion prerequisite |
| Originals kept in a Supabase storage bucket | Private `pdfs` bucket (`public = false`) with a restrictive deny policy for all client roles; objects are staged under `uploads/{user_id}/{job_id}/{filename}` with a sanitized filename (`routers/upload.py:92-96, 240`) | ✅ 🔷 |
| ~15,000–20,000 words per thesis; 300–500 KB PDFs; ~100–200 KB of vectors per thesis | These are *estimates*, not enforced limits. The system's operational limits are **25 MB and 500 pages** per upload (`config.py:47-48`) | ◻ estimates / ✅ compatible |
| The vector dataset is the AI's only knowledge base | The `match_chunks` RPC over `chunks.embedding vector(768)` is the sole evidence source; prompts are closed-domain | ✅ |

---

## 6. Methodology — research design and statistics (paper §3.2.1, §3.2.5)

| Paper commitment | System evidence | Status |
|---|---|---|
| Purposive sampling of 50 theses across tracks | Governance protocol, per-thesis eligibility checklist, and immutable-manifest tooling exist (`scripts/corpus_manifest.py`, `evaluation/corpus/corpus_manifest.template.json`). The corpus is not yet selected or locked; institutional approvals are pending | ⏳ |
| Control environment: unaugmented baseline Gemini using parametric memory only | `evaluation/run_comparison.py` invokes `BASELINE_PROMPT` with no retrieved context | ✅ |
| Experimental environment: RAG-constrained model retrieving from Supabase before answering | The same file calls the deployed guest `_chat_impl()` path and captures its ranked retrieval context through a private, never-serialized evaluation trace (`routers/chat.py:624, 787-794`) | ✅ |
| Identical queries through both models | Both pathways iterate the same Golden Dataset | ✅ |
| Golden Dataset: 30–50 curated queries with ground truths validated by three CCSICT faculty | **40 queries exist** (within range) spanning five tracks plus cross-track and negative-control items. **Every `ground_truth` is the literal string `"REPLACE: faculty-verified answer derived from the archived corpus."`**, every `source_thesis` is `"REPLACE: …"`, and `validated_by_faculty_panel` is `false` with empty panel slots | ⏳ **blocking Objective 2** |
| Ragas evaluation of Faithfulness and Context Precision, described by the paper as "reference-free" | The harness uses Ragas 0.4.3. It pairs **Answer Correctness** against faculty references for the statistical comparison, and reports Faithfulness and Context Precision as **RAG-only diagnostics** with separate ranked contexts. Ragas defines Context Precision as retriever ranking quality, and its reference form consumes a reference answer — so it cannot validly score an unaugmented baseline that has no retriever | ⚠️ **the paper's methodology wording must be revised** |
| Arithmetic mean across test iterations | Implemented in the harness and in `evaluation/summarize_jmeter.py`, which additionally reports p95/p99 beyond the paper | ✅ 🔷 |
| Shapiro-Wilk normality test → paired-samples *t*-test, else Wilcoxon Signed-Rank; α = 0.05 | `statistical_treatment()` in `evaluation/run_comparison.py` — `stats.shapiro` → `ttest_rel` / `wilcoxon`, with a `significant_at_0.05` flag | ✅ exact |
| LangSmith latency tracing | Implemented and privacy-hardened: spans for embedding, duplication, retrieval, generation, citation repair, and total (`services/observability.py`, `routers/chat.py`), with inputs and outputs hidden by default (`config.py:98-99`) | ✅ 🔷 |

**Bottom line for Objective 2.** The experiment is fully coded with corrected metric semantics, but it has never produced a formal result. The only end-to-end execution on record is a bounded development smoke of three fully synthetic queries, explicitly marked `"formal_result": false` in `evaluation/results/comparison_20260728_140718.json`. The admin dashboard deliberately shows "Ragas comparison pending faculty validation" rather than scores. This is honest sequencing, not a defect — but it must be stated plainly in the defense.

> ⚠️ **Evidence-integrity note.** That 2026-07-28 smoke artifact records `generation_contract.max_output_tokens: 500`, while `config.py:24` now specifies **700**. The recorded fingerprint no longer matches the current build, so the smoke result cannot be presented as characterizing today's system. Re-run and re-fingerprint before the formal evaluation.

### SDLC (paper §3.2.2 — Iterative Model)

◻/✅ Soft-verified. The repository history is consistent with an iterative process: eleven dated SQL migrations (2026-07-17 → 2026-07-25), staged verification-evidence bundles under `docs/evidence/`, and per-iteration audits. The empirically tuned parameters the paper names are handled exactly as an iterative process would leave them — chunk size and overlap are `Literal`-locked constants, while the retrieval threshold and top-*k* remain server-owned environment values whose effective settings are captured in the release fingerprint.

---

## 7. System procedures (paper §3.2.3) — the four phases

### 7.1 Phase 1 — Data digitization

| Paper | System (`services/document_processor.py`) | Status |
|---|---|---|
| PyMuPDF for digital-native text extraction | `import fitz`; per-page `get_text()` (line 246) | ✅ |
| Tesseract OCR **or** EasyOCR for scanned pages | Tesseract chosen, via `tesserocr` 2.10.0 with a pinned English model; the import is guarded so the system degrades gracefully when the native runtime is absent (lines 23-32, 138-157) | ✅ choice resolved — the paper should name Tesseract only |
| Regex cleaning: strip OCR artifacts, page numbers, headers, footers | `_clean_page()` + `_detect_repeated_lines()` remove page-number lines, running headers/footers detected across pages, TOC dot-leaders, control characters, and long symbol runs (lines 160-197) | ✅ |
| Exclude Table of Contents and bibliographies | `_EXCLUDED_SECTION_HEADINGS` drops TOC, bibliography, and references — **plus** acknowledgements, dedication, approval sheet, curriculum vitae, and lists of figures/tables/appendices (lines 61-66) | ✅ 🔷 |
| Discard chunks with > 15% non-alphanumeric characters | `is_noise_chunk(max_non_alnum_ratio=0.15)`, with whitespace correctly excluded from the ratio and each discard logged (lines 125-135, 293-301) | ✅ |
| Inject the `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholder | `FIGURE_PLACEHOLDER` constant injected when a page has both text and images (lines 34, 252-256) | ✅ |
| — (not in the paper) | **PII redaction at ingestion**: emails, Philippine mobile numbers, student numbers, addresses, participant identifiers, and signature lines, with per-category counts persisted as `papers.redaction_stats` (lines 76-122) | 🔷 |

### 7.2 Phase 2 — Semantic indexing and metadata injection

| Paper | System | Status |
|---|---|---|
| LangChain `RecursiveCharacterTextSplitter` | `RecursiveCharacterTextSplitter.from_tiktoken_encoder(...)` (`services/chunker.py:83-91`), lazily constructed so the tokenizer vocabulary does not block application import | ✅ |
| 800-token chunks with 100-token overlap | `chunk_size=800, chunk_overlap=100`, hard-locked as `Literal[800]` and `Literal[100]` (`config.py:30-31`) and re-validated per chunk (`validate_chunk_records`, `services/chunker.py:129-157`) | ✅ |
| Token counting | **Nuance the paper must adopt:** tokens are measured with the local `cl100k_base` tiktoken proxy, because Gemini's tokenizer is private. The module documents this explicitly (`services/chunker.py:1-9, 21`) | ⚠️ wording |
| Metadata tagging with a JSON object containing Title, Author, Track, Year | `build_chunk_metadata()` carries title, author, track and year — **plus** department, page range, section heading, chunk index, token count, tokenizer name, chunk size/overlap, and chunking version (`services/chunker.py:251-273`) | ✅ 🔷 |
| Gemini `text-embedding-004` → vectors in Supabase | `GoogleGenerativeAIEmbeddings` with `gemini-embedding-2` at 768 dimensions, batched 64 at a time with exponential-backoff retry (`services/embedder.py`); stored in `chunks.embedding vector(768)` with an HNSW cosine index | ⚠️ model / ✅ pipeline |
| — (not in the paper) | Chunks are split across a **single continuous page-joined stream** so a physical page break never acts as a semantic boundary, then mapped back to their exact source pages and section headings for traceable citations (`services/chunker.py:196-248`). Immutable per-index embedding provenance blocks retrieval across incompatible embedding spaces | 🔷 |

### 7.3 Phase 3 — RAG pipeline development

| Paper | System | Status |
|---|---|---|
| LangChain **`RetrievalQA`** chains | **Not used.** The pipeline is custom: embed the query → `match_chunks` Supabase RPC (cosine, department-scoped, provenance-checked) → per-chunk ranking and stable citation assignment → reorder → LCEL `prompt \| llm` generation (`services/retriever.py:343-437`, `routers/chat.py:565-573`). There is no `RetrievalQA`, no `as_retriever`, and no LangChain `VectorStore` anywhere in the codebase | ⚠️ **deviation — the paper must be updated** |
| Retrieve the top-*k* most relevant vectors | top-*k* default **5**, server-owned (`retrieval_match_count`, `config.py:33`). Client-supplied `match_count`/`match_threshold` are explicitly ignored (`models.py:16-18`) | ✅ |
| `LongContextReorder` to counter "Lost in the Middle" | Re-implemented by hand with the same algorithm and credited to Liu et al. 2024 (`services/retriever.py:28-41`). Input is most-relevant-first; output places the most relevant items at both ends of the context window | ✅ re-implementation, not the LangChain class |
| Enforce a minimum cosine-similarity threshold; explicitly state when nothing relevant is found | Threshold default **0.30**, server-owned (`config.py:32`). Empty retrieval returns an explicit no-relevant-thesis response with `no_relevant_thesis: true` (`routers/chat.py:816-824`) | ✅ |
| Screen new submissions at ≥ 85% and alert with the exact match percentage | `screen_new_submission()` runs **after embedding but before indexing**, so a manuscript is never compared against itself (`services/novelty.py:86-120`, called at `services/ingestion.py:139`). It flags and never blocks; the result is persisted to `papers.duplication_scan` and shown in the archive | ✅ 🔷 |
| — (not in the paper) | A full citation engine: stable chunk-level citation IDs, grouped-marker normalization (`[1, 2]` → `[1] [2]`), structural validation, one bounded AI repair attempt, deterministic coverage enforcement, and cited-only source filtering (`services/citations.py`, `routers/chat.py:875-915`). Also: prompt-injection guards, author-lookup and greeting fast paths that avoid Gemini calls entirely, follow-up query rewriting with grounded re-retrieval, and a Gemini capacity circuit breaker | 🔷 |

### 7.4 Duplication and novelty — the paper's 85% parameter, as built

The single 85% threshold is enforced at **three** points, all reading `settings.duplication_threshold`:

1. **Upload ingestion** — automatic screening of every new submission (paper Phase 3), producing verdict tiers `clear` / `review_suggested` (< 50% matched-chunk coverage) / `high_overlap` (≥ 50%), stored in `papers.duplication_scan` and surfaced in the archive card and detail modal.
2. **Chat query time** — a duplication check runs concurrently with retrieval on every question (`routers/chat.py:545-561`). A flagged response carries the similarity percentage, the matched paper's metadata, the matched location, and an AI-generated 2–3 sentence summary of the matched study — exactly the behaviour the paper describes in §1.3 and §3.3.
3. **Faculty novelty scanner** (`/novelty` + `POST /duplication/scan`) — upload a proposal draft (PDF or TXT), receive per-study metadata-only matches, an advisory explanation, scan history, bounded follow-up Q&A, and a downloadable metadata-only JSON report. 🔷 Entirely beyond the paper.

⚠️ **Reporting nuance the paper must adopt.** The system reports **two** numbers — highest passage similarity and matched-chunk coverage — while the paper implies a single similarity percentage. The verdict is explicitly advisory; the system never auto-accepts or auto-rejects a topic, and every surface states that final judgment belongs to faculty.

### 7.5 Phase 4 — System integration and evaluation instruments (paper §3.2.3-4, §3.2.4)

| Paper instrument | Measured result | Status |
|---|---|---|
| **PyTest** (Functional Suitability) | **2026-08-03: 430 passed, 3 skipped, 90.87% total coverage** against the enforced 85% gate, Python 3.14.6, 5.72 s. Per-module highlights: `routers/chat.py` 97.04%, `routers/upload.py` 91.29%, `models.py` 100%, `services/novelty.py` 100%, `services/rate_limiting.py` 100%. Weakest: `services/embedder.py` 63.16%, `services/observability.py` 63.64%, `services/cleanup.py` 66.67%, `workers/ingestion_worker.py` 77.07% | ✅ |
| **Ragas** (Functional Suitability — RAG accuracy) | Harness complete ✅; formal execution ⏳ (§6). Only a 3-query synthetic smoke exists, marked `formal_result: false` | ⏳ |
| **LangSmith** (Performance Efficiency — latency and tokens) | Wired into the live path with six span types; privacy-hardened so inputs and outputs are hidden and the exporter *raises* if payload content appears. Retained evidence: a 63-run export with prompt/completion token counts (`evaluation/results/langsmith.json`, dated 2026-07-20) | ✅ 🔷 |
| **Apache JMeter** (Performance Efficiency) | Retained evidence (2026-07-20): provider-independent profile 900/900 HTTP 200, 0% errors, avg 83.78 ms, p95 204.05 ms, p99 286.01 ms, 10.117 req/s; rate-limit behaviour 30×200 + 30×429 exactly at the configured limit; live Gemini smoke 3/3, avg 1,223.67 ms. **Important limitation: that profile exercised `/health`, `/upload/tracks`, and `/analytics/summary` — not `/chat`.** A `chat_load.jmx` rig now exists but has no measured run | ✅ baseline / ⏳ real-corpus concurrent RAG test |
| **SonarQube** (Reliability) | Retained evidence (2026-07-20): gate **passed**, 0 bugs, 0 vulnerabilities, 0 hotspots, ratings A, duplication 0.6% — but the same export records `ignoredConditions: true`, new-code coverage 25% against an 80% threshold, whole-repository coverage 36.3%, and 280 unresolved legacy code smells | ⚠️ evidence exists; an unqualified clean gate is still pending |
| **Pylint** (Maintainability) | **2026-08-03: 10.00/10** across `routers services dependencies workers main.py config.py models.py` | ✅ |
| **ESLint** (Maintainability) | **2026-08-03: 0 errors, 0 warnings** (ESLint 9.39.5 flat config) | ✅ |
| — (not in the paper) | Playwright critical-flows E2E, a Playwright + axe WCAG 2.2 AA matrix (**currently failing** — §1 item 5), a visual-quality matrix, frontend unit tests 29/29, production build gate, `pip check`, pip-audit, `npm audit --omit=dev` (**0 vulnerabilities today** — the July React Router advisory is resolved by `react-router` 8.3.0), Gitleaks, Trivy, OpenAPI drift gate, `/health` `/ready` `/health/worker` probes | 🔷 |

### 7.6 Ethical considerations (paper §3.2.6)

| Paper commitment | System evidence | Status |
|---|---|---|
| Written approval from the CCSICT Chair and University Librarian before digitization | A formal four-gate approval register — Chair, Librarian, Data Protection Officer, thesis adviser — exists in `docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md`. All four gates are currently **pending / blocked-external** | ⏳ (the protocol 🔷 exceeds the paper by adding a DPO gate and per-thesis privacy screening) |
| RA 10173 compliance: no PII beyond title, author, track and year is extracted, stored, or exposed | Regex redaction at ingestion reduces indexed-text exposure and public duplication alerts are metadata-only. This is **best-effort, not proof of complete removal**; original PDFs are deliberately stored privately, and the required per-manuscript privacy review remains pending | ⚠️ partial / ⏳ human review |
| The indirect access model protects intellectual property | Enforced (§3) | ✅ |
| A retrieval assistant, not a content generator; anti-plagiarism constraints | Deterministic refusal guards plus grounded-only prompts (§3) | ✅ |
| All AI responses include traceable citations | Chunk-level citation IDs carrying title, authors, year, page range, section, and similarity; structural validation with bounded repair. **Documented limit: validation proves marker validity and coverage, not semantic entailment** — faculty review remains required (`services/citations.py:90-91`) | ✅ with a stated limitation |

---

## 8. System architecture (paper §3.3, Figure 8) — layer by layer

| Paper component | As built | Status |
|---|---|---|
| **User Interface Layer** — admins upload; students, faculty and researchers query via the web UI | React SPA with `/chat`, `/archive`, `/novelty`, `/dashboard`, `/upload`, `/admin` and a landing page. Roles as built: **guest researcher (unauthenticated), student, faculty, admin, superadmin**. The paper's generic "Researcher" is realized as the unauthenticated Guest Researcher; **superadmin is entirely new**. Upload defaults to admin/superadmin but can be granted to students or faculty through the feature-permission matrix | ✅ with ⚠️ actor list |
| **Application Layer — Document Processing System** (multipart upload) | `POST /upload/paper` returns **202 Accepted** after multipart parsing, validation (extension, MIME, magic bytes, size, page count, encryption), private staging, and reservation in a **durable PostgreSQL-leased job queue**. A separate worker process (`workers/ingestion_worker.py`) executes the job with heartbeats, bounded retries, cooperative cancellation, and an atomic commit RPC. This is a major reliability upgrade over the paper's synchronous Figure 8 flow | ✅ 🔷 |
| **Application Layer — Query Processor** (FastAPI, NLP intent) | `POST /chat` with refusal guards, follow-up rewriting, greeting/author fast paths, and server-owned department resolution | ✅ |
| **Application Layer — RAG Pipeline** (`RetrievalQA`) | Custom pipeline — see §7.3 | ⚠️ wording |
| **Application Layer — Response Generator** (Gemini 1.5 Flash) | `ChatGoogleGenerativeAI` on `gemini-3.6-flash` with a 25 s timeout, 1 retry, 700 max output tokens, and thinking level `low` (`config.py:22-25`) | ⚠️ model |
| **Application Layer — query-time 85% duplication flagging** | Implemented exactly, concurrently with retrieval | ✅ |
| **Embedding Layer** — PyMuPDF loader → LangChain chunker → `text-embedding-004` | PyMuPDF (+ Tesseract OCR) → `RecursiveCharacterTextSplitter` with the tiktoken proxy → `gemini-embedding-2` at 768 dimensions | ✅ with ⚠️ model |
| **Data Storage Layer** — Supabase pgvector + Supabase Storage | `chunks.embedding vector(768)` with an HNSW cosine index and the `match_chunks` / `check_topic_duplication` service-role-only RPCs; a private `pdfs` bucket; plus tables for profiles, departments/programs/specializations, chat sessions and messages, scan history, upload jobs and events, ingestion workers, operational alerts, storage cleanup queue, security audit events, and paper index versions — all RLS deny-by-default | ✅ 🔷 |

---

## 9. What the system adds that the paper never describes (🔷)

These should be presented as production extensions, clearly separated from the fixed CCSICT experiment.

- **Security.** Supabase Auth JWT verification with approved/pending/rejected status gating; TOTP MFA with AAL2 enforcement for privileged accounts; optional Cloudflare Turnstile on guest chat with action and hostname binding; per-user and per-IP rate limiting (Redis-backed in production, keyed on a signature-verified JWT subject when the secret is configured); ClamAV malware scanning that fails closed; upload hardening (magic bytes, encrypted-PDF rejection, filename sanitization, page and size caps); prompt-injection guards; RLS deny-by-default; baseline OWASP security headers; HMAC-signed operations webhooks; encrypted backups; a secret-rotation runbook; and a privacy-filtering logger that redacts tokens and secrets.
- **Reliability and operations.** A durable leased ingestion job queue with heartbeats, bounded retries with `Retry-After`, idempotency keys, cooperative cancellation, atomic commit with ambiguous-response recovery, and a storage-cleanup queue; a worker registry with health states; deduplicated operational alerts with acknowledgement; retention dry-run tooling; a superadmin Operations dashboard; and `/health`, `/ready`, `/health/worker` probes.
- **Product.** Guest Researcher demo mode; chat sessions with rename, delete and history; suggested starters; stop/retry/edit controls on a failed answer; an archive metadata catalog with program and specialization filters; AI metadata autofill on upload; a multi-stage upload progress flow with refresh-safe resume; the novelty scanner with bounded follow-up chat and a JSON report; admin analytics; a user directory with an approval workflow; a role-feature permission matrix with realtime propagation; a normalized academic catalog (departments → programs → specializations); avatars; a command palette; Material 3 theming with light/dark, palette, high-contrast, reduced-motion and low-effects modes; and progressive 3D scenes.
- **Engineering.** A CI quality gate covering PyTest with coverage, Pylint, ESLint, unit tests, production build, Playwright, `pip check`, pip-audit, `npm audit`, Gitleaks, Trivy container scanning, and SonarQube; an OpenAPI contract snapshot with an automated drift gate; release fingerprinting; immutable corpus-manifest tooling; dated evidence bundles; and non-root container images.

Post-defense features (SSE streaming, hybrid retrieval and reranking, PWA) are deliberately **deferred and disabled** so the evaluated pipeline stays identical to the paper's — consistent with the paper's controlled-experiment intent.

---

## 10. Outstanding gaps — paper promises without results yet (⏳)

| Gap | Paper section | Blocker |
|---|---|---|
| Written institutional approvals (Chair, Librarian, Data Protection Officer, adviser) | §3.2.6 | External signatures |
| Immutable, locked 50-thesis evaluation corpus | §1.3, §3.2.1 | Approvals + per-thesis privacy screening |
| Faculty-validated Golden Dataset ground truths (three-member panel) | §3.2.1 | Faculty panel availability |
| Ragas baseline-vs-RAG comparison with Shapiro-Wilk / *t*-test / Wilcoxon results | §3.2.1, §3.2.4-5 | The faculty-validated dataset |
| Formal ISO/IEC 25010 evaluation on a locked release, including a JMeter rerun against the real corpus and `/chat` | §3.2.4 | Locked corpus and release |
| Production deployment rehearsal and public HTTPS validation | implied by deployment | Hosting decision |
| Physical hardbound → searchable-PDF conversion | §1.3, §3.1.3, §3.2.3 | An operational scanning workflow outside the application |

None of these can be closed in code. They are academic and institutional prerequisites and should be presented as such.

---

## 11. Required paper revisions

This is the actionable edit list. Each item names the section to change and what it should say.

### Priority 1 — factual corrections that a panelist can check against the running system

1. **Table 3 — replace the model names.** `Gemini 1.5 Flash` → **`gemini-3.6-flash`** (grounded chat) and add **`gemini-3.5-flash-lite`** (bounded verdict and metadata-extraction work). `text-embedding-004` → **`models/gemini-embedding-2`** at **768 output dimensions**. Keep the 768-dimension claim in §2.1.1 — it is true and hard-enforced. Add one sentence stating that the effective model set is frozen in a signed release fingerprint for the duration of the evaluation.

2. **§2.1.1, §3.2.3 Phase 3, and §3.3 — remove the `RetrievalQA` claim.** Replace with the pipeline as built:
   > PyMuPDF and Tesseract OCR extraction → programmatic regex cleaning → LangChain `RecursiveCharacterTextSplitter` (800/100 tokens, measured with the `cl100k_base` tokenizer proxy) → Gemini embeddings at 768 dimensions → cosine nearest-neighbour retrieval through the `match_chunks` pgvector RPC → context reordering (a re-implementation of LangChain's `LongContextReorder`, after Liu et al., 2024) → grounded generation through a LangChain Expression Language prompt-to-model chain, followed by structural citation validation and bounded repair.

   Also correct "LangChain's document loaders" — the system extracts with PyMuPDF directly rather than through a LangChain document loader.

3. **Tables 1–4 — regenerate from the lockfiles.** React 19.2.8, Vite 8.1.5, FastAPI 0.139.2, Pydantic 2.13.4, python-multipart 0.0.32, python-dotenv 1.2.2, supabase 2.31.0, langchain-google-genai 4.3.1, PyTest 9.1.1, Pylint 4.0.6, ESLint 9.39.5, JMeter 5.6.3. Add **Python 3.14.6** and **Node.js 24.18.0**, and add the load-bearing dependencies the tables omit: tiktoken, langchain-core, langchain-text-splitters, tesserocr + tessdata.eng, Pillow, slowapi, redis, cryptography, PyJWT, httpx, langsmith, uvicorn, pydantic-settings, Tailwind CSS, react-router, TanStack Query, axios, Framer Motion.

4. **§3.2.4 / Table 4 — correct the SonarQube version.** The retained Reliability evidence was produced on SonarQube Community Build 26.7.0.124771 with SonarScanner CLI 8.0.1.6346, not 10.4. Either state the version actually used, or re-run on 10.4 before the defense so the table stays true.

5. **§3.2.1 and §3.2.4 — correct the Objective 2 metric semantics.** This is the most important methodological correction. Three changes:
   - **Context Precision cannot be computed for the baseline.** The baseline has no retriever, therefore no retrieved contexts to rank. It is a RAG-only diagnostic.
   - **Do not call reference-based Ragas metrics "reference-free."** Answer Correctness and reference-based Context Precision both consume the faculty ground truth.
   - **State the actual comparison metric.** The baseline-vs-RAG statistical comparison is on paired **Answer Correctness** against faculty-validated ground truth. Faithfulness and Context Precision are reported alongside it as RAG-only diagnostics of grounding and retrieval quality.

6. **§1.3 and §3.2.3 Phase 3 — document the two duplication numbers.** State that the system reports both **highest passage similarity** and **matched-chunk coverage** (the percentage of the new manuscript's chunks whose nearest archive neighbour met the 85% threshold), and that the coverage figure drives the advisory tiers `clear`, `review_suggested` (< 50%), and `high_overlap` (≥ 50%). State explicitly that the verdict is advisory and that the system never auto-accepts or auto-rejects a topic.

### Priority 2 — completeness and precision

7. **§3.2.3 Phase 2 — add the tokenizer caveat.** One sentence: *"Chunk sizes are measured with the local `cl100k_base` tokenizer as a fixed, reproducible proxy, because Gemini's tokenizer is not publicly available. Chunk boundaries are therefore exact for that proxy and approximate for the embedding model."* This turns a potential panel question into a demonstration of methodological rigour.

8. **§3.3 and §3.2.3 Phase 3 — state the evaluated retrieval constants.** Minimum cosine similarity **0.30**, top-*k* **5**, duplication threshold **≥ 0.85**. Note that the first two are server-owned deployment values whose effective settings are frozen in the release fingerprint, while the chunking contract and duplication threshold are compile-time constants.

9. **§3.3 and §1.4 — update the actor model.** Add **Guest Researcher** (unauthenticated, locked to the evaluation department, no saved history, optionally gated by a one-time bot check) and **superadmin** (cross-department administration and operations). Retire the standalone "Researcher" actor — it is realized as the Guest Researcher. Note that upload is admin-default but grantable to student and faculty roles through a server-owned permission matrix.

10. **§1.3, §3.1.3 and §3.2.3 Phase 1 — state the digitization boundary.** *"Physical manuscripts are scanned to PDF as an operational prerequisite before ingestion. The system's digitization phase extracts and OCRs text from an uploaded PDF for semantic indexing; it does not itself perform scanning and does not emit a new searchable PDF."* Also name **Tesseract** as the chosen OCR engine rather than "Tesseract OCR or EasyOCR."

11. **§3.3 / Figure 8 — add the durable ingestion worker.** The figure currently shows a synchronous upload path. Redraw it with the four real stages — API validation and private staging → durable leased job queue → separate worker process (download, malware scan, extract, chunk, embed, screen) → atomic commit — and add the security controls (auth/RLS, MFA, rate limiting, malware scanning) as a cross-cutting band. Mark this clearly as production architecture surrounding the frozen experimental pipeline.

12. **Table 5 — reframe the hardware.** The RTX 4050 is not used by the architecture: all embedding and generation is remote Gemini API work and OCR is CPU-bound. Present Table 5 as the development workstation's specification, not as a system requirement, and add the actual deployment target.

### Priority 3 — presentation of results

13. **Chapter 4 (when written) — report only measured results with their limitations.** Specifically: state that the JMeter performance profile measured non-RAG endpoints unless and until `/chat` is load-tested against the real corpus; state that the SonarQube gate passed with ignored conditions and a 36.3% whole-repository coverage baseline; and keep every Ragas and inferential-statistics claim marked pending until the formal run completes.

14. **§3.2.6 — soften the PII claim to what is provable.** The system performs deterministic regex redaction of high-risk PII at ingestion and stores originals privately. Describe this as a best-effort technical control paired with mandatory human privacy review, rather than as a guarantee that no PII is stored.

15. **Add a limitation on citation validation.** State that citation validation proves marker validity and coverage — that every substantive claim carries a valid in-range citation — but does not prove semantic entailment between a claim and its cited evidence. Faculty verification remains part of the process. Stating this yourself is far stronger than having a panelist find it.

16. **Consider one paragraph acknowledging the production extensions.** A short subsection in §3.3 noting that the delivered system includes production-grade security, reliability, and operations capabilities beyond the experimental scope prevents the panel from reading the extra surface area as scope creep, and demonstrates engineering maturity.

### Addendum (2026-08-19) — thesis category scope change

17. **§1.3 Corpus Restrictions, §3.1.3, and §3.2.1 — widen the corpus statement to cover faculty theses.** At the department's request the system now categorizes every archived manuscript as a **student** (undergraduate) or **faculty** thesis (`papers.thesis_category`, migration `20260819_thesis_category.sql`). The delimitation *"strictly limited to undergraduate theses"* must be revised to state that the archive holds CCSICT student **and faculty** manuscripts, each labeled by category and filterable in browse, chat retrieval, and analytics. The **evaluation corpus for Objective 2 remains exactly the 50 undergraduate theses** selected under the PI-08 protocol — faculty-category papers are excluded from the locked corpus by definition, since every paper indexed before the migration backfills to `student` and the retrieval filter is opt-in with an unchanged default path. §3.2.1 needs one added sentence noting the category label and the student-only evaluation restriction, not a numerical change. Clarify also that the thesis category classifies the **manuscript**, not the user: the `faculty` **role** in the actor model (revision 9) is deliberately unrelated to the `faculty` **category**.

---

## Appendix A — commands executed for this report (2026-08-03)

All commands were run on Windows 11 against the working tree described in the control table.

```
rag-thesis-backend> .venv3146\Scripts\python.exe -m pip check
No broken requirements found.

rag-thesis-backend> .venv3146\Scripts\python.exe -m pytest --cov=routers --cov=services
   --cov=dependencies --cov=workers --cov=main --cov=config --cov=models
   --cov-report=term --cov-fail-under=85
TOTAL  3340 stmts  305 miss  90.87%
Required test coverage of 85% reached. Total coverage: 90.87%
430 passed, 3 skipped in 5.72s          (platform win32, Python 3.14.6-final-0)

rag-thesis-backend> .venv3146\Scripts\python.exe -m pylint --rcfile=.pylintrc
   routers services dependencies workers main.py config.py models.py
Your code has been rated at 10.00/10 (previous run: 10.00/10, +0.00)

rag-thesis-frontend> npx eslint .
(no output — 0 errors, 0 warnings)

rag-thesis-frontend> node --test
tests 29 | pass 29 | fail 0 | skipped 0            duration_ms 166.36

rag-thesis-frontend> npm run build
✓ 3855 modules transformed.
✓ built in 730ms
largest chunk: dist/assets/useSceneRuntime-*.js  890.65 kB  (gzip 237.28 kB)

rag-thesis-frontend> npm audit --omit=dev
found 0 vulnerabilities
```

**Playwright accessibility matrix** — `test-results/.last-run.json` and `test-results/axe-report.json`, generated 2026-08-03T03:40:08Z with axe-core 4.12.1:

```
status: "failed"   failedTests: 10
totals: { blocking: 55, advisory: 25 }
blocking by rule:  color-contrast (serious) 46 · aria-prohibited-attr (serious) 7
                   scrollable-region-focusable (serious) 2
advisory by rule:  heading-order 25
```

**Per-module backend coverage** (same run):

| Module | Coverage | | Module | Coverage |
|---|---|---|---|---|
| `models.py` | 100.00% | | `services/retriever.py` | 84.44% |
| `services/novelty.py` | 100.00% | | `services/upload_queue.py` | 84.38% |
| `services/rate_limiting.py` | 100.00% | | `services/ingestion.py` | 78.18% |
| `routers/sessions.py` | 100.00% | | `workers/ingestion_worker.py` | 77.07% |
| `routers/chat.py` | 97.04% | | `services/catalog.py` | 73.68% |
| `config.py` | 96.08% | | `services/cleanup.py` | 66.67% |
| `dependencies/auth.py` | 95.40% | | `services/observability.py` | 63.64% |
| `routers/upload.py` | 91.29% | | `services/embedder.py` | 63.16% |
| **TOTAL** | **90.87%** | | | |

## Appendix B — documents superseded by this report

`PAPER_VS_SYSTEM_COMPARISON.md` and `PRODUCTION_IMPROVEMENTS_RECOMMENDATIONS.md`, both dated 2026-07-28 against commit `54cb6e9`. Their substance is re-verified and carried into this report and its companion, `SYSTEM_IMPROVEMENTS_AND_BUGS_2026-08-03.md`. Note that both referenced `ISU_ECHAGUE_PRODUCTION_ROADMAP.md`, which no longer exists in the working tree and is listed in `.gitignore`; `rag-thesis-backend/evaluation/iso25010_evidence.md:3` still links to it and should be corrected.
