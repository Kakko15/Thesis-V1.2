# Thesis Proposal vs. Implemented System — Verified Comparison

| Control | Value |
|---|---|
| Paper compared | `paper/paper_CORRECTED.docx` — the 2026-08-09 revision of *Final Thesis Proposal Paper_Update Carlo*, with the 2026-08-25 corrections applied. The untouched source sits beside it as `paper/paper_ORIGINAL_2026-08-09.docx` |
| System compared | Working tree at commit `733e186`, clean |
| API version | `2.1.0` (`rag-thesis-backend/main.py:105`) |
| Comparison date | **2026-08-25** |
| Supersedes | `PAPER_VS_SYSTEM_COMPARISON_2026-08-03.md`, which compared the 52-page PDF against commit `9228da2`. Its substance is carried forward and re-verified; nothing was copied without checking |
| Method | Every claim traces to a source file and line, to a command executed today (Appendix A), or to a dated evidence artifact. Version numbers come from `requirements.lock`, `package-lock.json`, and `config.py` — not from the previous report, which had itself drifted (it listed `cryptography 49.0.0`; the lockfile says **50.0.0**) |

**Legend**

| Mark | Meaning |
|---|---|
| ✅ | **Aligned** — implemented as the paper specifies |
| 🔷 | **Exceeds** — implemented, and goes beyond what the paper describes |
| ⚠️ | **Deviation** — implemented differently from the paper's text |
| ⏳ | **Pending** — specified in the paper, tooling exists, but no result exists yet |
| ◻ | **Not verifiable** from the repository alone |

---

## 1. Executive summary

The system remains a faithful and in most places substantially stronger implementation of the proposal. Every architectural commitment in Chapter 3 exists in code and is enforced at runtime: the closed-domain RAG pipeline over Supabase pgvector with Gemini generation, the indirect (no full-text) library model, the 800/100-token chunking contract, the 85% duplication threshold, LongContextReorder against "Lost in the Middle", the complete data-cleaning pipeline, and the full Objective 2 and Objective 4 evaluation harness with the exact statistics the paper promises.

**What changed since the 2026-08-03 report**

1. **The paper revisions were applied.** All eighteen items from the previous report's edit list are now in `paper/paper_CORRECTED.docx`, except the Figure 8 redraw, which is an embedded image. §11 below is therefore a record of what was applied rather than a list of what to do.
2. **A defect audit ran and eight findings were fixed** (`BUG_AUDIT_2026-08-24.md`). Nine remain open and triaged post-defense. No fix touched the frozen evaluated pipeline.
3. **The institutional catalog was seeded and then scoped.** All nine ISU Echague colleges exist as data, but **CCSICT is the only active department**. CAS was deactivated on 2026-08-25 and left on standby with its eight programs intact, so re-enabling it is a single statement.
4. **Manuscripts are now categorized** as `student` or `faculty` work (`papers.thesis_category`).
5. **A deviation the previous report could not have seen, found and closed the same day.** Seeding the normalized catalog renamed two of the five track names the paper and the Golden Dataset use, and left two others unmapped. The department ruled the catalog authoritative; §3.2.1 and `golden_dataset.json` were both realigned to it (`13f10c6`) before any ground truth was drafted. See §6.
6. **The backend container scan was cleared** (CVE-2026-14456), which carried the interpreter to Python 3.14.7 in CI and the container.

**Verified today** (Appendix A, every gate judged by exit code): PyTest **711 passed / 3 skipped, 91.49% coverage** against an 85% gate · Pylint **10.00/10** · ESLint **0 errors, 0 warnings** · frontend unit tests **85/85** across 7 suites · Vite production build **3,865 modules, clean** · `npm audit --omit=dev` **0 vulnerabilities**. CI on `733e186`: **6/6 green** — PyTest+Pylint, ESLint+build, secret scan, both container scans, SonarQube Reliability.

**Honest bottom line for the defense.** The *software* of Objectives 1, 3 and 4 is complete and measurably high quality. **Objective 2 is coded but has never produced a formal result**: all 40 Golden Dataset ground truths remain `"REPLACE: …"` placeholders and `validated_by_faculty_panel` is `false`. It is blocked on external academic prerequisites, not on code — institutional approvals, the locked 50-thesis corpus, and a three-member faculty panel. Physical hardbound-to-searchable-PDF conversion remains an operational prerequisite performed before upload, not a feature of the application.

---

## 2. Objectives (paper §1.2)

| # | Paper objective | System evidence | Status |
|---|---|---|---|
| 1 | Develop a knowledge-retrieval model integrating RAG + LLM **using the LangChain framework** | `services/document_processor.py` → `chunker.py` → `embedder.py` → `retriever.py` → `routers/chat.py`. LangChain is genuinely used — `RecursiveCharacterTextSplitter`, `ChatPromptTemplate`, `ChatGoogleGenerativeAI`, `GoogleGenerativeAIEmbeddings`, and an LCEL prompt-to-model chain — with custom orchestration rather than `RetrievalQA` (§7.3). **The paper now says exactly this** | ✅ |
| 2 | Compare baseline LLM vs RAG + LLM on factual accuracy and hallucination mitigation | `evaluation/run_comparison.py` pairs **Answer Correctness** against faculty ground truth for the statistical test and reports Faithfulness and Context Precision as RAG-only diagnostics. It hard-blocks formal runs on placeholder data and fingerprints code, dataset, dependencies, runtime, models, and index. **All 40 ground truths remain placeholders, so no formal result exists** | ⏳ harness ✅ / execution blocked |
| 3 | Apply the model to build the Centralized AI-Powered Thesis Library System | Full stack operational: React 19 + Vite SPA, FastAPI backend, Supabase pgvector and Storage, durable ingestion worker, citation-backed chat, novelty scanning, archive catalog, admin and operations consoles | ✅ 🔷 |
| 4 | Evaluate internal quality via ISO/IEC 25010 using automated tools | All four instrument families exist and are CI-wired. Today: PyTest 711/3 at 91.49%, Pylint 10.00/10, ESLint 0/0, frontend 85/85. JMeter is documented and has now been run against `/chat`. SonarQube runs in CI. Formal locked-release evaluation still pending | ✅ tooling / ⏳ formal run |

---

## 3. Scope and delimitations (paper §1.3)

| Paper commitment | System evidence | Status |
|---|---|---|
| **Data digitization** — convert hardbound and soft copies into searchable PDFs | The application accepts an already-created PDF, then extracts and OCRs it in memory for indexing. It does not scan manuscripts and does not emit a new searchable PDF. **The paper now states this boundary** | ✅ |
| **System architecture** — LangChain + Gemini embeddings + Supabase + Gemini LLM | All four present, at the versions in §4 | ✅ |
| **Experimental testing** — quantitative baseline-vs-RAG comparison | Harness complete, never executed formally | ⏳ |
| **Corpus restriction** — CCSICT theses only | Server-enforced department scoping. Guests are hard-locked to the evaluation department, authenticated users to their profile department; only superadmins may select another, and only from a validated list (`dependencies/auth.py:74-98`). `thesis_evaluation_department = 'CCSICT'` (`config.py:35`). **The paper now covers student and faculty categories**, with the Objective 2 corpus still the 50 undergraduate theses | ✅ 🔷 |
| **External knowledge isolation** — no open-internet search | No web-search integration exists anywhere in the codebase. Prompts force answers exclusively from `<retrieved_context>`; empty context returns an explicit no-result message; answers that self-report no evidence are intercepted and replaced | ✅ |
| **Content generation limits** — no original research content or chapters | Deterministic refusal guards in `services/guards.py`: generation verbs against prohibited artifacts, plus prompt-injection patterns, applied to the question, to loaded history, and to the rewritten follow-up. Four transformation verbs were added on 2026-08-24 only after a diff over all 43 evaluation questions showed no false positives | ✅ 🔷 |
| **Network dependency** — requires internet | Supabase cloud plus Gemini API, no offline mode | ✅ |
| **Dataset volume limit** — 50 theses, purposive sampling, scalable later | The archive is deliberately not hard-capped, matching "designed to scale incrementally". The fixed 50-thesis evaluation corpus is governed by an immutable-manifest protocol with SHA-256 receipts. **The manifest is still not locked** — `evaluation/corpus/` holds only `corpus_manifest.template.json` | ⏳ |
| **Complex data extraction limits** | `FIGURE_PLACEHOLDER = 'FIGURE REDACTED FOR SEMANTIC INDEXING'` (`document_processor.py:34`); chunks above 15% non-alphanumeric discarded (`is_noise_chunk`, line 125) | ✅ |
| **Indirect access model** | Enforced end to end: a private `pdfs` bucket denying `anon` and `authenticated`; `public_source()` never returns content, storage paths, or URLs; the frontend has no PDF viewer, download link, or full-text route | ✅ |
| **Duplication parameter** — flag at ≥ 85%, show the exact percentage | `duplication_threshold = 0.85` (`config.py:34`), inclusive comparison. **The paper now documents both reported numbers and the advisory tiers** — §7.4 | ✅ 🔷 |

---

## 4. Technology stack — paper Tables 1–4 vs. code

Every row re-read from the lockfiles on 2026-08-25. The paper's tables were regenerated from these same values, so this section should now read as a set of matches rather than a list of drift.

### 4.1 Frontend (paper Table 1)

| Technology | Paper (corrected) | Actual (`package-lock.json`) | Status |
|---|---|---|---|
| React | v19.2.8 | 19.2.8 | ✅ |
| JavaScript (JSX), ES6+ | ✔ | all sources `.js`/`.jsx`, no TypeScript | ✅ |
| Vite | v8.1.5 | 8.1.5 | ✅ |
| Node.js | v24.18.0 | pinned `>=24.18.0 <25`; CI uses 24.18.0 | ✅ *added* |
| Tailwind CSS | v4.3.3 | 4.3.3 | ✅ *added* |
| React Router | v8.3.0 | 8.3.0 | ✅ *added* |
| TanStack Query | v5.101.4 | 5.101.4 | ✅ *added* |
| Axios | v1.18.1 | 1.18.1 | ✅ *added* |
| Framer Motion | v12.42.2 | 12.42.2 | ✅ *added* |

Still absent from the paper and acceptable as such (🔷): `@supabase/supabase-js` 2.110.8, three.js 0.185.1 with `@react-three/fiber` 9.6.1 and `drei` 10.7.7, Radix UI primitives, Recharts 3.10.0, react-markdown 10.1.0, `@material/material-color-utilities` 0.4.0, sonner 2.0.7, lucide-react 1.26.0.

### 4.2 Backend (paper Table 2)

| Technology | Paper (corrected) | Actual (`requirements.lock`) | Status |
|---|---|---|---|
| FastAPI | v0.139.2 | 0.139.2 | ✅ |
| Pydantic | v2.13.4 | 2.13.4 | ✅ |
| python-multipart | v0.0.32 | 0.0.32 | ✅ |
| python-dotenv | v1.2.2 | 1.2.2 | ✅ |
| Python | v3.14.7 | **3.14.7** in CI and the container, asserted at image build (`Dockerfile:27`) | ✅ *added* |
| pydantic-settings | v2.14.2 | 2.14.2 | ✅ *added* |
| Uvicorn | v0.51.0 | 0.51.0 | ✅ *added* |
| SlowAPI | v0.1.10 | 0.1.10 | ✅ *added* |
| Redis | v8.0.1 | 8.0.1 | ✅ *added* |
| cryptography | v50.0.0 | 50.0.0 | ✅ *added* |
| PyJWT | v2.13.0 | 2.13.0 | ✅ *added* |
| HTTPX | v0.28.1 | 0.28.1 | ✅ *added* |

⚠️ **An interpreter nuance worth stating plainly at defense.** CI and the container run **3.14.7**; the local development venv (`.venv3146`) is still **3.14.6**, so the local measurements in Appendix A were produced on 3.14.6. `requirements.lock` resolves against Python 3.14 at the minor level, so the pinned dependency set and its hashes are identical either way, and no chunking, retrieval, prompt, or model value depends on the patch level.

Still absent from the paper (🔷): msgpack 1.2.1, setuptools 83.0.0, pytest-cov 7.1.0, and tessdata.eng 1.0.0 (folded into the `tesserocr` row).

### 4.3 AI and RAG orchestration (paper Table 3)

| Technology | Paper (corrected) | Actual | Status |
|---|---|---|---|
| Supabase (Python client) | v2.31.0 | 2.31.0 | ✅ |
| pgvector | v0.7.0 (managed) | enabled via `create extension vector`; the version is Supabase-managed and **not repository-verifiable**. An HNSW cosine index is in use, which requires ≥ 0.5 | ◻ still unverified |
| langchain-google-genai | v4.3.1 | 4.3.1 | ✅ |
| LLM | **Gemini 3.6 Flash** (`gemini-3.6-flash`) | `config.py:16` | ✅ corrected |
| Bounded verdict and extraction | `gemini-3.5-flash-lite` | `config.py:17` | ✅ *added* |
| Embeddings | `models/gemini-embedding-2` at 768 dimensions | `config.py:18-21`, enforced three ways: `Literal[768]`, a `vector(768)` column, and per-index embedding provenance that blocks retrieval across incompatible embedding spaces | ✅ corrected |
| langchain-core / langchain-text-splitters / tiktoken | 1.5.1 / 1.1.2 / 0.13.0 | match | ✅ *added* |
| PyMuPDF / tesserocr / Pillow | 1.28.0 / 2.10.0 / 12.3.0 | match | ✅ *added* |
| LangSmith | v0.10.10 | 0.10.10 | ✅ *added* |

The generation contract, unchanged and frozen for the evaluation: timeout 25.0 s, 1 retry, **700** max output tokens, thinking level `low` (`config.py:22-25`). The paper now states that the effective model set is frozen in a signed release fingerprint for the duration of the evaluation.

### 4.4 Testing and QA (paper Table 4)

| Technology | Paper (corrected) | Actual | Status |
|---|---|---|---|
| PyTest | v9.1.1 | 9.1.1 — today **711 passed, 3 skipped, 91.49%** | ✅ |
| Apache JMeter | v5.6.3 | 5.6.3 in all `.jmx` plans | ✅ |
| SonarQube | Community Build 26.7.0.124771 | matches the retained evidence | ✅ corrected |
| SonarScanner CLI | v8.0.1.6346 | matches | ✅ *added* |
| Pylint | v4.0.6 | 4.0.6 — today **10.00/10** | ✅ |
| ESLint | v9.39.5 | 9.39.5 — today **0 errors, 0 warnings** | ✅ |
| Node.js test runner | v24.18.0 (`node --test`) | today **85 passed** across 7 suites | ✅ *added* |
| Playwright | v1.61.1 | 3 spec files, 21 specs, green in CI | ✅ *added* |
| axe-core for Playwright | v4.12.1 | WCAG 2.2 AA matrix | ✅ *added* |

QA tooling still beyond the paper (🔷): pytest-cov with an enforced 85% gate, an enforced frontend coverage gate, a visual-quality matrix, `pip check`, pip-audit, `npm audit`, Gitleaks secret scanning, Trivy container scanning, a GitHub Actions quality workflow, an OpenAPI contract snapshot with drift detection, and release fingerprinting.

### 4.5 Hardware (paper Table 5)

✅ Now framed correctly. The paper states that Table 5 specifies the development workstation rather than a deployment requirement, and that **no GPU is used by the architecture** — all embedding and generation is remote Gemini API work, and OCR is CPU-bound Tesseract.

---

## 5. Data (paper §3.1.3)

| Paper statement | System evidence | Status |
|---|---|---|
| Source: CCSICT theses, physical and digital | Digital-native PDFs plus a per-page OCR fallback triggered when a page has fewer than 40 extractable characters but contains images (`document_processor.py:58, 248-251`) | ✅ |
| All files converted into searchable PDFs | Upload accepts an existing PDF only, validated by extension, MIME type, and `%PDF-` magic bytes, and rejected if encrypted (`routers/upload.py:99-126`). OCR produces index text, not a replacement PDF. **The paper now states the boundary** | ✅ |
| Originals kept in a Supabase storage bucket | Private `pdfs` bucket (`public = false`) with a restrictive deny policy; objects staged under `uploads/{user_id}/{job_id}/{filename}` with a sanitized filename | ✅ 🔷 |
| ~15,000–20,000 words per thesis; 300–500 KB PDFs; ~100–200 KB of vectors | Estimates, not enforced limits. The operational limits are **25 MB and 500 pages** per upload (`config.py:47-48`) | ◻ estimates |
| The vector dataset is the AI's only knowledge base | The `match_chunks` RPC over `chunks.embedding vector(768)` is the sole evidence source; prompts are closed-domain | ✅ |

---

## 6. ✅ Track vocabulary — deviation found and resolved, 2026-08-25

This did not exist on 2026-08-03. It was found during the full paper sweep and
**resolved the same day**: the department ruled that the academic catalog is
authoritative, and both the paper and the Golden Dataset were realigned to it.

`models.py:6` still defines the five original tracks:

```
Data Mining · Web Development · Network Security · Intelligent Systems · Information Management
```

The normalized catalog seeded in `migrations/20260725_normalized_academic_catalog.sql:47-49` defines only three CCSICT specializations, under different names:

| Paper and Golden Dataset | Seeded catalog |
|---|---|
| Data Mining | `DM` Data Mining ✅ |
| Web Development | `WMAD` **Web and Mobile Application Development** ⚠️ |
| Network Security | `NETSEC` **Network and Security** ⚠️ |
| Intelligent Systems | *no specialization* — line 80 maps it to `needs_review` ⚠️ |
| Information Management | *no specialization* — line 80 maps it to `needs_review` ⚠️ |

`active_track_names('CCSICT')` therefore returns the three specialization names plus the program codes for the programs that take no specialization (`BSDSA`, `BSIS`, `BLIS`), which is what `papers.track` is stamped with and what the archive and landing filters offer.

**Two consequences.**

1. Paper §3.2.1 illustrates track coverage with "Data Mining, Web Development, and Network Security". Two of those three names no longer match what the system stores or displays.
2. More seriously for Objective 2, the Golden Dataset categorizes **7 queries as Intelligent Systems and 5 as Information Management — 12 of 40, or 30% of the dataset** — under tracks the catalog does not have. This should be settled before the faculty panel writes ground truths against those items.

**Resolution.** The catalog is authoritative — CCSICT has five programs and only
three specializations. `services/catalog.py:110` falls back to the program **code**
when a program takes no specialization, and `SPECIALIZATION_REQUIRED_PROGRAMS =
{'BSCS', 'BSIT'}` (line 13) means those two programs can never be a track
themselves. The complete set of legal `papers.track` values is therefore three
specialization names plus three bare program codes:

```
Data Mining | Web and Mobile Application Development | Network and Security
BSDSA | BSIS | BLIS
```

The mix of names and codes is by design, not an inconsistency.

**What was changed.** `golden_dataset.json` categories were realigned in commit
`13f10c6`: the two renames applied straight across, *Intelligent Systems* became
`BSDSA` (6) and `WMAD` (1), *Information Management* became `BSIS` (4) and `BLIS`
(1). Two questions (ids 29 and 33) embedded the retired grouping in their own
text and were reworded rather than merely relabelled. Paper §3.2.1 was rewritten
to name the catalog vocabulary, mirroring the dataset's own description string so
the two cannot drift apart.

**Why this was safe.** `run_comparison.py` never reads `category` — it is a
coverage label for the faculty panel, not a filter. All 40 ground truths remain
placeholders, `validated_by_faculty_panel` is still `false`, and the evaluated
pipeline was never in scope. `run_comparison.py:364` records
`golden_dataset_sha256` into every result, so that hash moved; the only result on
file is the 2026-07-28 dev smoke marked `formal_result: false`, so nothing real
was invalidated. Settling this **before** three faculty members draft 40 ground
truths avoided invalidating twelve of them afterwards.

---

## 7. System procedures (paper §3.2.3) — the four phases

### 7.1 Phase 1 — Data digitization

| Paper | System (`services/document_processor.py`) | Status |
|---|---|---|
| PyMuPDF for digital-native extraction | `import fitz`; per-page `get_text()` (line 246) | ✅ |
| OCR for scanned pages | **The paper now names Tesseract only**, via `tesserocr` 2.10.0 with a pinned English model; the import is guarded so the system degrades gracefully when the native runtime is absent | ✅ |
| Regex cleaning: OCR artifacts, page numbers, headers, footers | `_clean_page()` and `_detect_repeated_lines()` remove page-number lines, running headers and footers detected across pages, TOC dot-leaders, control characters, and long symbol runs (lines 160-197) | ✅ |
| Exclude Table of Contents and bibliographies | `_EXCLUDED_SECTION_HEADINGS` drops TOC, bibliography and references, **plus** acknowledgements, dedication, approval sheet, curriculum vitae, and lists of figures, tables and appendices (line 62) | ✅ 🔷 |
| Discard chunks above 15% non-alphanumeric characters | `is_noise_chunk(max_non_alnum_ratio=0.15)` at line 125, whitespace correctly excluded from the ratio, each discard logged | ✅ |
| Inject the `FIGURE REDACTED FOR SEMANTIC INDEXING` placeholder | `FIGURE_PLACEHOLDER` at line 34, injected when a page has both text and images | ✅ |
| — (not in the paper) | **PII redaction at ingestion**: emails, Philippine mobile numbers, student numbers, addresses, participant identifiers and signature lines, with per-category counts persisted as `papers.redaction_stats` | 🔷 |

### 7.2 Phase 2 — Semantic indexing and metadata injection

| Paper | System | Status |
|---|---|---|
| LangChain `RecursiveCharacterTextSplitter` | `RecursiveCharacterTextSplitter.from_tiktoken_encoder(...)` (`chunker.py:83-91`), lazily constructed so the tokenizer vocabulary does not block application import | ✅ |
| 800-token chunks with 100-token overlap | `chunk_size=800, chunk_overlap=100`, hard-locked as `Literal[800]` and `Literal[100]` (`config.py:30-31`) and re-validated per chunk | ✅ |
| Token counting | **The paper now carries the caveat**: tokens are measured with the local `cl100k_base` tiktoken proxy because the Gemini tokenizer is not public, so boundaries are exact for the proxy and approximate for the embedding model | ✅ |
| Metadata tagging with Title, Author, Track, Year | `build_chunk_metadata()` carries those four **plus** department, page range, section heading, chunk index, token count, tokenizer name, chunk size and overlap, and chunking version | ✅ 🔷 |
| Gemini embeddings into Supabase | `GoogleGenerativeAIEmbeddings` on `gemini-embedding-2` at 768 dimensions, batched 64 at a time with exponential-backoff retry; stored in `chunks.embedding vector(768)` with an HNSW cosine index | ✅ |
| — (not in the paper) | Chunks are split across a single continuous page-joined stream so a physical page break never acts as a semantic boundary, then mapped back to exact source pages and section headings for traceable citations. Immutable per-index embedding provenance blocks retrieval across incompatible embedding spaces | 🔷 |

### 7.3 Phase 3 — RAG pipeline development

| Paper | System | Status |
|---|---|---|
| The retrieval chain | **The `RetrievalQA` claim is gone.** The paper now describes the pipeline as built: embed the query → `match_chunks` Supabase RPC (cosine, department-scoped, provenance-checked) → per-chunk ranking and stable citation assignment → reorder → LCEL prompt-to-model generation. There is no `RetrievalQA`, no `as_retriever`, and no LangChain `VectorStore` anywhere in the codebase | ✅ corrected |
| Retrieve the top-*k* most relevant vectors | top-*k* default **5**, server-owned (`config.py:33`). Client-supplied `match_count` and `match_threshold` are explicitly ignored. **The paper now states the value** | ✅ |
| `LongContextReorder` against "Lost in the Middle" | Re-implemented by hand with the same algorithm, credited to Liu et al. 2024 (`retriever.py:28-41`). **The paper now says "re-implementing"** rather than implying the library class | ✅ |
| Minimum cosine-similarity threshold | Default **0.30**, server-owned (`config.py:32`). Empty retrieval returns an explicit no-relevant-thesis response. **The paper now states the value** | ✅ |
| Screen new submissions at ≥ 85% | `screen_new_submission()` runs after embedding but before indexing, so a manuscript is never compared against itself (`novelty.py:86-120`, called from `ingestion.py:139`). It flags and never blocks | ✅ 🔷 |
| — (not in the paper) | A full citation engine: stable chunk-level citation IDs, grouped-marker normalization, structural validation, one bounded AI repair attempt, deterministic coverage enforcement, and cited-only source filtering. Position-aware repair was corrected on 2026-08-24 so a fallback marker is appended to the right unit. Also prompt-injection guards, author-lookup and greeting fast paths that avoid Gemini calls entirely, follow-up rewriting with grounded re-retrieval, and a Gemini capacity circuit breaker | 🔷 |

### 7.4 Duplication and novelty — the 85% parameter as built

The single threshold is enforced at **three** points, all reading `settings.duplication_threshold`:

1. **Upload ingestion** — automatic screening of every submission, producing verdict tiers `clear` / `review_suggested` (< 50% matched-chunk coverage) / `high_overlap` (≥ 50%), stored in `papers.duplication_scan`.
2. **Chat query time** — a duplication check runs concurrently with retrieval on every question. A flagged response carries the similarity percentage, the matched paper's metadata and location, and an AI-generated two-to-three sentence summary of the matched study.
3. **Faculty novelty scanner** (`/novelty`, `POST /duplication/scan`) — upload a proposal draft as PDF or TXT and receive metadata-only matches, an advisory explanation, scan history, bounded follow-up Q&A, and a downloadable JSON report. 🔷 Entirely beyond the paper.

✅ **The reporting nuance is now in the paper.** It states that the system reports **two** numbers — highest passage similarity and matched-chunk coverage — that coverage drives the advisory tiers, and that the verdict is advisory: the system never auto-accepts or auto-rejects a topic.

### 7.5 Phase 4 — System integration and evaluation instruments

| Paper instrument | Measured result | Status |
|---|---|---|
| **PyTest** (Functional Suitability) | **2026-08-25: 711 passed, 3 skipped, 91.49% coverage** (3,690 statements, 314 missed) against the enforced 85% gate, 6.54 s, local Python 3.14.6 | ✅ |
| **Ragas** (Functional Suitability — RAG accuracy) | Harness complete ✅; formal execution ⏳. The only end-to-end run on record is a three-query development smoke, explicitly `"formal_result": false` (`evaluation/results/comparison_20260728_140718.json`) | ⏳ |
| **LangSmith** (Performance Efficiency) | Wired into the live path with six span types, privacy-hardened so inputs and outputs are hidden and the exporter raises if payload content appears. Retained evidence: a 63-run export dated 2026-07-20 | ✅ 🔷 |
| **Apache JMeter** (Performance Efficiency) | Retained evidence (2026-07-20): 900/900 HTTP 200, 0% errors, avg 83.78 ms, p95 204.05 ms, p99 286.01 ms, 10.117 req/s; rate-limit behaviour 30×200 + 30×429 exactly at the configured limit. **That profile exercised `/health`, `/upload/tracks` and `/analytics/summary`, not `/chat`.** A `/chat` load test has since been run against a synthetic corpus (commit `5af6d09`) and must be reported as synthetic-corpus data | ✅ baseline / ⏳ real-corpus run |
| **SonarQube** (Reliability) | Green in CI on `733e186`. The retained detailed export (2026-07-20) records gate passed, 0 bugs, 0 vulnerabilities, 0 hotspots, ratings A, duplication 0.6% — but also `ignoredConditions: true`, new-code coverage 25% against an 80% threshold, whole-repository coverage 36.3%, and 280 unresolved legacy code smells | ⚠️ evidence exists; an unqualified clean gate is still pending |
| **Pylint** (Maintainability) | **2026-08-25: 10.00/10** | ✅ |
| **ESLint** (Maintainability) | **2026-08-25: 0 errors, 0 warnings** | ✅ |
| — (not in the paper) | Frontend unit tests **85/85** across 7 suites with an enforced coverage gate, Playwright critical-flows E2E and a Playwright + axe WCAG 2.2 AA matrix (**0 blocking findings**; 25 advisory `heading-order` findings closed on 2026-08-04), a visual-quality matrix, production build gate (**3,865 modules**), `pip check`, pip-audit, `npm audit --omit=dev` (**0 vulnerabilities**), Gitleaks, Trivy, an OpenAPI drift gate, and `/health` `/ready` `/health/worker` probes | 🔷 |

### 7.6 Ethical considerations (paper §3.2.6)

| Paper commitment | System evidence | Status |
|---|---|---|
| Written approval from the CCSICT Chair and University Librarian before digitization | A four-gate approval register — Chair, Librarian, Data Protection Officer, adviser — in `docs/governance/PI08_APPROVAL_PRIVACY_CORPUS_PROTOCOL.md`. All four gates remain **pending / blocked-external** | ⏳ |
| RA 10173 compliance on PII | Regex redaction at ingestion, metadata-only public duplication alerts, originals stored privately. **The paper now describes this as a best-effort technical control paired with mandatory human privacy review**, rather than a guarantee | ✅ |
| The indirect access model protects intellectual property | Enforced (§3) | ✅ |
| A retrieval assistant, not a content generator | Deterministic refusal guards plus grounded-only prompts | ✅ |
| All AI responses include traceable citations | Chunk-level citation IDs carrying title, authors, year, page range, section and similarity, with structural validation and bounded repair. **The paper now states the limit**: validation proves marker validity and coverage, not semantic entailment | ✅ |

---

## 8. System architecture (paper §3.3, Figure 8)

| Paper component | As built | Status |
|---|---|---|
| **User Interface Layer** | React SPA with `/chat`, `/archive`, `/novelty`, `/dashboard`, `/upload`, `/admin` and a landing page. **The paper's actor list is now correct**: guest researcher (unauthenticated), student, faculty, admin, superadmin, with upload admin-default but grantable through the permission matrix | ✅ |
| **Application Layer — Document Processing System** | `POST /upload/paper` returns **202 Accepted** after multipart parsing, validation, private staging, and reservation in a durable PostgreSQL-leased job queue. A separate worker (`workers/ingestion_worker.py`) executes with heartbeats, bounded retries, cooperative cancellation, and an atomic commit RPC | ✅ 🔷 |
| **Application Layer — Query Processor** | `POST /chat` with refusal guards, follow-up rewriting, greeting and author fast paths, server-owned department resolution | ✅ |
| **Application Layer — RAG Pipeline** | Custom pipeline, §7.3. **Paper corrected** | ✅ |
| **Application Layer — Response Generator** | `ChatGoogleGenerativeAI` on `gemini-3.6-flash`, 25 s timeout, 1 retry, 700 max output tokens, thinking level `low`. **Paper corrected** | ✅ |
| **Embedding Layer** | PyMuPDF and Tesseract → `RecursiveCharacterTextSplitter` with the tiktoken proxy → `gemini-embedding-2` at 768 dimensions. **Paper corrected** | ✅ |
| **Data Storage Layer** | `chunks.embedding vector(768)` with an HNSW cosine index and service-role-only `match_chunks` / `check_topic_duplication` RPCs; a private `pdfs` bucket; plus tables for profiles, departments/programs/specializations, chat sessions and messages, scan history, upload jobs and events, ingestion workers, operational alerts, storage cleanup queue, security audit events, and paper index versions — all RLS deny-by-default | ✅ 🔷 |

### ⚠️ The figures were never audited until 2026-08-25 — two are stale

All eight figures are embedded PNGs, so no text-level correction pass could ever
reach them. They were extracted and read on 2026-08-25. Six are clean; **two
still assert models the system stopped using**, and both are more wrong than the
"Figure 8 needs the ingestion worker" note that had stood in for them.

| Figure | Section | Verdict |
|---|---|---|
| **1** | §2.1.1 | ⚠️ **Stale.** "Embedding Model — `text-embedding-004` converts to vectors" and "LLM Prompt — Query + Context fed to **Gemini 1.5 Flash**" |
| 2 | §2.1.2 | ✅ Clean — conceptual; all five inline citations resolve to the reference list |
| 3–6 | §2.2 | ✅ Clean — generic IPO models, no tool or model names |
| 7 | §3.2.2 | ✅ Clean — SDLC phases only |
| **8** | §3.3 | ⚠️ **Stale on four counts** (below) |

**Figure 8** carries every error the text has already been corrected for:

1. Response Generator labelled **`gemini-1.5-flash`** — the text now says `gemini-3.6-flash`
2. Embedding Model labelled **`text-embedding-004`** — the text now says `gemini-embedding-2`
3. RAG Pipeline labelled **`LangChain & langchain-community`** — `langchain-community` is not in `requirements.lock` at all
4. A **"Researcher"** actor — retired by revision 9, realized as the Guest Researcher; **superadmin** is absent

...plus the synchronous upload path already noted. §3.3 describes the real
four-stage durable ingestion flow in text, but the diagram contradicts it.

**Figures 3, 4 and 5 additionally carry internal titles** reading "Figure 1.1",
"Figure 1.2" and "Figure 1.3" while the paper captions them Figure 3, 4 and 5.
Cosmetic, but a panelist reading the figure and the caption together sees it.

None of this is fixable here — they are raster images and must be redrawn by the
authors. Figures 1 and 8 are the priority: they state the wrong model names on
the page, which is exactly the class of error the whole correction pass was for.

---

## 9. What the system adds that the paper never describes (🔷)

Present these as production extensions, clearly separated from the fixed CCSICT experiment. The paper now carries one paragraph in §3.3 acknowledging their existence and scope.

- **Security.** Supabase Auth JWT verification with approved/pending/rejected gating; TOTP MFA with AAL2 enforcement for privileged accounts; optional Cloudflare Turnstile on guest chat with action and hostname binding, with a documented outage-recovery path after the 2026-08-19 lockout (`9b2ac37`); per-user and per-IP rate limiting, Redis-backed in production; ClamAV malware scanning that fails closed; upload hardening; prompt-injection guards; RLS deny-by-default; OWASP baseline headers; HMAC-signed operations webhooks; encrypted backups with staleness alerting; a secret-rotation runbook; and a privacy-filtering logger.
- **Reliability and operations.** A durable leased ingestion job queue with heartbeats, bounded retries with `Retry-After`, idempotency keys, cooperative cancellation, atomic commit with ambiguous-response recovery, and a storage-cleanup queue; a worker registry with health states; deduplicated operational alerts with acknowledgement; retention dry-run tooling; a superadmin Operations dashboard; and health probes.
- **Product.** Guest Researcher demo mode; chat sessions with rename, delete and history; suggested starters; stop, retry and edit on a failed answer; an archive catalog with program and specialization filters and student/faculty category filtering; AI metadata autofill on upload; a refresh-safe multi-stage upload flow; the novelty scanner with bounded follow-up chat and a JSON report; admin analytics with correct pagination past the PostgREST 1,000-row cap (`bb27625`); a user directory with an approval workflow; a role-feature permission matrix with realtime propagation; the normalized ISU academic catalog; a command palette; Material 3 theming with light/dark, palette, high-contrast, reduced-motion and low-effects modes; and progressive 3D scenes gated behind device capability.
- **Engineering.** A CI quality gate covering PyTest with coverage, Pylint, ESLint, frontend unit tests with an enforced coverage gate, production build, Playwright, `pip check`, pip-audit, `npm audit`, Gitleaks, Trivy container scanning with digest-pinned Chainguard base images, and SonarQube; an OpenAPI contract snapshot with an automated drift gate; release fingerprinting; immutable corpus-manifest tooling; dated evidence bundles; and non-root container images.

Post-defense features (SSE streaming, hybrid retrieval and reranking, PWA) remain deliberately **deferred and disabled** so the evaluated pipeline stays identical to the paper's.

---

## 10. Outstanding gaps — paper promises without results yet (⏳)

| Gap | Paper section | Blocker |
|---|---|---|
| Written institutional approvals (Chair, Librarian, Data Protection Officer, adviser) | §3.2.6 | External signatures |
| Immutable, locked 50-thesis evaluation corpus | §1.3, §3.2.1 | Approvals plus per-thesis privacy screening |
| Faculty-validated Golden Dataset ground truths (three-member panel) | §3.2.1 | Faculty panel availability |
| Ragas baseline-vs-RAG comparison with the §3.2.5 statistics | §3.2.1, §3.2.4-5 | The faculty-validated dataset |
| Formal ISO/IEC 25010 evaluation on a locked release, including a JMeter rerun against the real corpus | §3.2.4 | Locked corpus and release |
| **Figures 1 and 8 redrawn** — both still name `gemini-1.5-flash` and `text-embedding-004`; Figure 8 also shows `langchain-community`, a retired "Researcher" actor, and a synchronous upload path | §2.1.1, §3.3 | Authors — they are raster images |
| Production deployment rehearsal and public HTTPS validation | implied | Hosting decision |
| Physical hardbound → searchable-PDF conversion | §1.3, §3.1.3, §3.2.3 | An operational scanning workflow outside the application |

None of these can be closed in code. They are academic, institutional, or authorial prerequisites and should be presented as such.

---

## 11. Paper revisions — applied 2026-08-25

The previous report's §11 was an actionable edit list. It has been executed. The corrected document is `paper/paper_CORRECTED.docx`, regenerated from the untouched original by `paper/build_corrections.py`, with every edit carrying an expected match count so a wording drift raises rather than silently skipping. `paper/CORRECTIONS_APPLIED.md` itemizes each change.

**Applied in full** — 36 paragraphs modified, 26 table rows added, **0 paragraphs deleted**, all 8 embedded images byte-identical:

| # | Revision | Where |
|---|---|---|
| 1 | Model names, plus the release-fingerprint sentence | Table 3, §3.2.1 |
| 2 | `RetrievalQA` and "document loaders" removed; pipeline described as built | §2.1.1, §3.2.3 Phase 3, §3.3 |
| 3 | Tables 1–4 regenerated from the lockfiles; 26 omitted dependencies added, including Python 3.14.7 and Node.js 24.18.0 | Tables 1–4 |
| 4 | SonarQube version corrected to the Community Build actually used | Table 4 |
| 5 | Objective 2 metric semantics: Answer Correctness is the paired metric; the metrics are reference-based, not reference-free; Context Precision cannot be computed for the baseline | §3.2.4, §3.2.5, Table 6 |
| 6 | Both duplication numbers, the advisory tiers, and the no-auto-decision statement | §1.3 |
| 7 | `cl100k_base` tokenizer caveat | §3.2.3 Phase 2 |
| 8 | Retrieval constants: 0.30 and top-*k* 5 | §3.2.3 Phase 3 |
| 9 | Actor model: Guest Researcher and superadmin, permission matrix | §3.3 |
| 10 | Digitization boundary; Tesseract named as the single OCR engine | §1.3, §3.2.3 Phase 1 |
| 12 | Table 5 reframed as the development workstation | §3.1.2 |
| 14 | PII claim softened to a best-effort control with human review | §3.2.6 |
| 15 | Citation validation proves markers and coverage, not semantic entailment | §3.2.3 Phase 2 |
| 16 | One paragraph acknowledging the production extensions | §3.3 |
| 17 | Student and faculty manuscript categories | §1.3 Corpus Restrictions |
| 18 | Python 3.14.7 recorded | Tables 1–4 |

**Not applied, and why**

| # | Revision | Reason |
|---|---|---|
| 11 | Redraw Figure 8 with the durable ingestion worker | The figure is an embedded image. §3.3 now states the real flow in text; the diagram itself needs the authors |
| 13 | Chapter 4 reporting discipline | Chapter 4 does not exist yet — the paper is Chapters 1–3 plus References |
| — | `pgvector v0.7.0` in Table 3 | Supabase-managed and not recorded anywhere in the repository; left untouched rather than guessed. Confirm in the Supabase dashboard |

**Resolved after the sweep.** The track vocabulary in §3.2.1 (§6) was realigned to
the academic catalog on 2026-08-25, alongside the Golden Dataset in `13f10c6`.

**Two presentational notes.** `Python v3.14.7` was appended to Table 2 and therefore sits after `python-dotenv`; reading order would be better with the runtime first, which is one drag in Word. And the paper remains in future tense throughout, deliberately: it is a proposal, and the corrections changed the facts without changing the voice.

---

## Appendix A — commands executed for this report (2026-08-25)

All commands run on Windows 11 against commit `733e186`. **Every gate was judged by its exit code**, not by reading its output.

```
rag-thesis-backend> .venv3146\Scripts\python.exe -m pytest --cov=routers --cov=services
   --cov=dependencies --cov=workers --cov=main --cov=config --cov=models
   --cov-report=term --cov-fail-under=85
TOTAL                             3690    314  91.49%
Required test coverage of 85% reached. Total coverage: 91.49%
711 passed, 3 skipped in 6.54s      (platform win32, Python 3.14.6-final-0)
exit 0

rag-thesis-backend> .venv3146\Scripts\python.exe -m pylint --rcfile=.pylintrc
   routers services dependencies workers main.py config.py models.py
Your code has been rated at 10.00/10 (previous run: 10.00/10, +0.00)
exit 0

rag-thesis-frontend> npx eslint .
(no output — 0 errors, 0 warnings)                                        exit 0

rag-thesis-frontend> node --test
tests 85 | suites 7 | pass 85 | fail 0 | skipped 0    duration_ms 150.51   exit 0

rag-thesis-frontend> npm run build
✓ 3865 modules transformed.
✓ built in 622ms
largest chunk: dist/assets/useSceneRuntime-*.js  890.65 kB  (gzip 237.28 kB) exit 0

rag-thesis-frontend> npm audit --omit=dev
found 0 vulnerabilities                                                   exit 0
```

**CI on `733e186`** — GitHub Actions *Quality / ISO-IEC 25010*, all six checks `SUCCESS`:
Backend PyTest + Pylint · Frontend ESLint + build · Secret scan · Container vulnerability scan (backend) · Container vulnerability scan (frontend) · SonarQube (Reliability).

**Interpreter note.** The local venv is Python 3.14.6; CI and the container assert 3.14.7 (`.github/workflows/quality.yml:33`, `rag-thesis-backend/Dockerfile:27`). The measurements above were produced on 3.14.6.

## Appendix B — document history

- `PAPER_VS_SYSTEM_COMPARISON.md` and `PRODUCTION_IMPROVEMENTS_RECOMMENDATIONS.md`, dated 2026-07-28 against commit `54cb6e9` — superseded by the 2026-08-03 report and removed from the tree.
- `PAPER_VS_SYSTEM_COMPARISON_2026-08-03.md`, against commit `9228da2` — superseded by this report and renamed to it. Its §11 edit list is preserved above as an applied-work record.
- Companion documents, not superseded: `SYSTEM_IMPROVEMENTS_AND_BUGS_2026-08-03.md` (the defect and improvement ledger through 2026-08-05) and `BUG_AUDIT_2026-08-24.md` (17 findings, 8 fixed).
- Dated evidence artifacts under `docs/evidence/` are point-in-time records and are deliberately **not** rewritten to match today's state.
