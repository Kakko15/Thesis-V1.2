# ISO/IEC 25010 Evidence Snapshot

> **Snapshot notice:** This file records the dated evidence below and is not a live delivery-status ledger. The current defect and improvement ledger is [`SYSTEM_IMPROVEMENTS_AND_BUGS_2026-08-03.md`](../../SYSTEM_IMPROVEMENTS_AND_BUGS_2026-08-03.md), and the paper-to-system comparison is [`PAPER_VS_SYSTEM_COMPARISON_2026-08-03.md`](../../PAPER_VS_SYSTEM_COMPARISON_2026-08-03.md). Final evidence must be regenerated from the immutable release manifest (`scripts/corpus_manifest.py` and `scripts/release_fingerprint.py`).
>
> This notice previously pointed at `ISU_ECHAGUE_PRODUCTION_ROADMAP.md` as the authoritative ledger. That file does not exist in the repository and is listed in `.gitignore`, so anyone following the link — including a panel member — reached nothing.

This file reports only observed command results. Pending external measurements are never represented as successful results.

## Current local revalidation - 2026-08-03

Measured on Windows 11 with Python 3.14.6, PyTest 9.1.1, Pylint 4.0.6, Node.js 24.18.0, npm 11.16.0, Vite 8.1.5, Playwright 1.61.1 and axe-core 4.12.1. This workstation now matches the pinned CI/container targets (Python 3.14.6, Node 24.18.0), and the active virtual environment is `.venv3146`.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` in `.venv3146` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov and enforced `--cov-fail-under=85` | 539 passed and 3 opt-in external integration tests skipped; 91.28% coverage | Passed |
| PI-04 catalog controls | PyTest | 8/8 normalized selection, safe legacy/pre-migration translation, no-guess review, nested API, CRUD/archive, additive migration, and rollback contract tests passed | Passed locally |
| PI-08 corpus controls | PyTest + Pylint | 15/15 manifest validation, immutable-locking, no-overwrite, and tamper-evidence tests passed; focused Pylint 10.00/10 | Passed locally |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests | Node test runner | 44/44 passed | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors and 0 warnings | Passed |
| Frontend production build | Vite 8.1.5 | 3,859 modules transformed; production build completed | Passed |
| Critical browser journeys | Playwright 1.61.1 with Chromium | 21/21 passed (11 accessibility surfaces, 9 critical flows, 1 visual-quality matrix) | Passed |
| Accessibility (WCAG 2.2 AA) | Playwright + axe-core 4.12.1 | 0 blocking (serious/critical) findings across 11 surfaces x 4 theme states x {1280px, 360px}; 25 advisory `heading-order` findings remain open | Passed blocking gate; advisory backlog open |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Backend dependency vulnerability audit | pip-audit | Not re-run in this pass; requires network access to the advisory database. Last dated result (2026-07-25) was clean | Pending re-run |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Not re-run in this pass; no SonarQube server was available. See the 2026-07-20 snapshot below and its recorded qualifications | Pending re-run |

The three skipped backend checks are two explicitly authorized disposable-Supabase integrations and one ClamAV Docker/EICAR integration. The PI-04 migration has not been applied to a disposable Supabase project because no local Supabase CLI/Docker daemon was available. They remain deployment/evidence gates and were not represented as passing. Deployed security-header validation also remains pending because it requires the final deployment URL.

> **Superseded evidence — Objective 2 smoke run.** `evaluation/results/comparison_20260728_140718.json` records `generation_contract.max_output_tokens: 500`, while `config.py` now specifies **700**. Its fingerprint therefore no longer describes this build and it must not be presented as characterizing the current system. The artifact is retained unaltered as dated evidence; it has to be re-run and re-fingerprinted before the formal evaluation. It was in any case a three-query synthetic development smoke explicitly marked `"formal_result": false`.

## `/chat` RAG load profile — first measured run, 2026-08-04

Every previously recorded performance figure measured `/health`, `/upload/tracks`,
and `/analytics/summary`. `jmeter/chat_load.jmx` existed but had **never been
executed**. It has now been run end to end. Artifacts:
`evaluation/results/jmeter/chat-{2,5,10,20}.jtl`,
`chat_summary_{2,5,10,20}u.json`, and the classified
`chat_rag_load_report.json`.

**Setup.** A local API bound to an isolated disposable Supabase project — never
the application project, enforced by a URL/key/ref guard — seeded with 10
synthetic theses (80 chunks, `token-v1` chunking, verified 768-dimensional
provenance) by `scripts/seed_synthetic_corpus.py`. Guest `/chat`, one distinct
`X-Guest-ID` per virtual user, three loops each, JMeter 5.6.3 on OpenJDK 25.0.3.

**Why the status code is not the result.** On a provider 429 the API returns
**HTTP 200** carrying an explicit capacity notice, and holds a 60-second cooldown
during which every further request receives that notice immediately. A JTL of
100% HTTP 200 can therefore describe a system that answered almost nothing. A
companion run with response-body capture confirmed this directly: every
sub-second 200 contained *"IskAI has reached the research AI service usage
limit"*, returned in 1–18 ms, while genuine answers took 5.1–26.2 s.
`evaluation/summarize_chat_load.py` separates the bands so a quoted percentile
means one thing.

| Profile | Samples | Answered | Capacity notice | Ambiguous | Failed | Answer median | Answer p95 |
|---|---|---|---|---|---|---|---|
| 2 users | 6 | 2 | 1 | 1 | 2 (502) | 14,460 ms | 18,881 ms |
| 5 users | 15 | 7 | 6 | 2 | 0 | 8,071 ms | 14,134 ms |
| 10 users | 30 | **0** | 29 | 1 | 0 | — | — |
| 20 users | 60 | **0** | 60 | 0 | 0 | — | — |

**What this does and does not establish.**

- **Established:** the RAG path works end to end under concurrency — retrieval,
  generation, citation validation, and cited sources — and a grounded answer on
  the free provider tier costs roughly **8–15 seconds**, not the sub-second range
  the non-RAG endpoints suggested.
- **Established:** the system degrades *gracefully* rather than failing. At 10 and
  20 concurrent users it served 60 requests in 14 seconds at 4.2 req/s with zero
  5xx, every one an explicit, well-formed notice. That is Fault Tolerance
  evidence, not Performance Efficiency evidence.
- **Not established: any concurrency ceiling for the application.** The ceiling
  observed here is the **free provider tier's rate limit**, reached below five
  concurrent users. Application-only throughput remains the separately measured
  `provider_independent_load.jmx` figure (900/900, p95 204 ms).
- **The four profiles are not independent.** They ran sequentially against one
  shared, depleting quota, so the 2-user profile looks *worse* than the 5-user
  profile purely because it ran later. These numbers must not be read as a
  concurrency curve.
- **Corpus is synthetic.** Ten obviously-labelled synthetic records, not the
  governed 50-thesis corpus, which remains gated on institutional approval. Any
  use of these figures must say so.

**Required before the formal evaluation:** re-run on a paid provider tier (§4.6)
against the approved corpus, with each profile given an independent quota window.
Until then the honest claim is that the core feature's *capacity under a
rate-limited free tier* has been characterized, and its *application-level*
capacity has been measured only provider-independently.

## Archived evidence snapshot - 2026-07-20

- Snapshot date: 2026-07-20 (Asia/Taipei)
- Host: Windows 11
- Application target: Python 3.12, Node.js 22
- Backend test runtime: Python 3.14.2, PyTest 9.1.1
- SonarQube runtime: Eclipse Temurin JDK 25.0.3; scanner-provisioned JRE 21.0.9
- SonarQube Community Build: 26.7.0.124771; SonarScanner CLI: 8.0.1.6346
- Formal evaluation department: CCSICT
- Production operator activity: a backup was created, the schema was upgraded, and the thesis manuscript was ingested on July 20, 2026. Automated evaluation tooling did not mutate the production project.

## Verified results

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Frontend unit tests | Node 22 test runner | 8/8 passed, including null/malformed legacy duplication-scan compatibility | Passed |
| Frontend maintainability | ESLint | 0 errors, 0 warnings | Passed |
| Frontend build | Vite 8.0.8 | 3,728 modules transformed; production build completed | Passed |
| Backend maintainability | Pylint 4.0.6 on Python 3.12.13 | 10.00/10 | Passed |
| Backend syntax | Python 3.12 AST parser | 55 project Python files parsed | Passed |
| SQL contracts | Static contract review | Department filters, ready-only retrieval, protected-profile trigger, and service-role activation revocation present | Passed |
| Security follow-up contracts | Static contract review | Approved-account boundary, privileged MFA, CCSICT-forced signup, production-project URL/key guard, atomic ingestion/chat RPCs, backend-only scan/chat tables, cleanup queue, indirect PDF storage, owned avatar paths, Redis production guard, and boolean LangSmith settings present | Passed statically |
| Disposable Supabase security | PyTest integration against the isolated test project | Enhanced live-schema security check: 1/1 passed in 7.28 seconds. Earlier disposable-project safety/security checks: 3/3 passed. | Passed |
| Current backend readiness | FastAPI `/health` and `/ready` against the configured real project | `/health`: `ok`; `/ready`: `ready`; database, AI configuration, and rate-limit store checks report `ok` | Passed |
| Backend functional suitability | PyTest with pytest-cov and enforced `--cov-fail-under=80` | 220/220 passed in 8.83 seconds; coverage 81.85%; zero warnings | Passed |
| JMeter plan structure | XML parser | `provider_independent_load.jmx`, `rate_limit_test.jmx`, `live_gemini_smoke.jmx`, and legacy `thesis_load_test.jmx` are well-formed XML | Passed |
| Provider-independent performance | JMeter 5.6.3, three runs, 20 configured users, five loops, 30-second ramp | 900/900 HTTP 200; 0% errors; average 83.78 ms; median 72 ms; p95 204.05 ms; p99 286.01 ms; 10.117 requests/s; observed maximum concurrency 2 | Passed |
| Rate-limit behavior | JMeter 5.6.3, 20 configured users, three loops, five-second ramp | 60 requests: 30 HTTP 200 and 30 HTTP 429; throttling began at the configured 30-request limit; average 5.17 ms; p95 6 ms | Passed |
| Live Gemini smoke | JMeter 5.6.3, three isolated single-user iterations | 3/3 HTTP 200; 0% errors; average 1,223.67 ms; median 1,196 ms; p95 1,324.70 ms; p99 1,336.14 ms | Passed |
| SonarQube reliability/security | Community Build 26.7.0.124771 and SonarScanner CLI 8.0.1.6346 | Quality gate passed; zero bugs, vulnerabilities, hotspots, and new-code issues; reliability/security/maintainability ratings A; duplication 0.6%. Whole-repository coverage baseline 36.3%; 280 legacy code smells retained for backlog. | Passed |
| LangSmith observability and privacy | Project `isu-thesis-library`; three grounded questions against the disposable thesis fixture | 63-run export includes embedding, duplication, retrieval, generation, total, and one citation-repair span; real generation recorded prompt/completion token counts; all runs completed; inputs and outputs hidden; no prompt, answer, or manuscript payload exported | Passed |
| Citation re-index dry-run | Final-tree local fixture run | PDF: 27 chunks, all 27 page-aware; TXT: 31 chunks with null page fields; section metadata detected; zero Supabase, storage, or Gemini calls | Passed |
| Diff hygiene | `git diff --check` | No whitespace errors after cleanup | Passed |

## Results that are not yet eligible as final evidence

| Criterion | Current evidence | Required next action | Status |
|---|---|---|---|
| Ragas comparison | Golden Dataset still contains placeholders and lacks faculty-panel validation. | Complete and lock the faculty-validated dataset before evaluation. | Pending academic prerequisite |

## Required commands

```powershell
# Backend: current suite and enforced coverage gate
cd rag-thesis-backend
.\.venv3146\Scripts\python.exe -m pip check
.\.venv3146\Scripts\python.exe -m pytest `
  --cov=routers --cov=services --cov=dependencies --cov=workers `
  --cov=main --cov=config --cov=models `
  --cov-report=term-missing --cov-report=xml --cov-fail-under=85

# Opt-in disposable-project integration test
$env:ALLOW_DISPOSABLE_SUPABASE_TESTS='1'
.\.venv3146\Scripts\python.exe -m pytest -m integration -v

# Backend maintainability
.\.venv3146\Scripts\python.exe -m pylint --rcfile=.pylintrc `
  routers services dependencies workers main.py config.py models.py

# Frontend
cd ..\rag-thesis-frontend
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run security:headers -- https://your-deployment.example
```

## Artifact hashes

SHA-256 values generated on 2026-07-18:

| Artifact | SHA-256 |
|---|---|
| `migrations/20260717_rag_items_9_16.sql` | `EF608007FA198C4C6E99FF1EED18485BBA517D229A23869B8C90F79B40A70826` |
| `migrations/20260717_security_scope_evaluation.sql` | `BDD82CBC06B440CDF6DFBA6053914D2E1751A58C38956D4946E49BCFE9988B65` |
| `migrations/20260718_transactional_ingestion_cleanup.sql` | `845EEF73121D42FB8E16599E1EF092289DD2692B0A165C437C0F94B9EFED8FBC` |
| `migrations/20260719_production_hardening.sql` | `D27C5E434E85940D9C5A0207A06DD7DADA965DDB2DB6A0C36978F0150F0467FB` |
| `supabase_setup.sql` | `1696F12AC7EEC1724E1B9F6FB95D18B34874800A047D098CE2489DE1836C8671` |
| `jmeter/provider_independent_load.jmx` | `D32431C75A6BCB2CF3DCBA90610869BB962DA613F2756C9E8CDA5903523AE8BE` |
| `jmeter/rate_limit_test.jmx` | `61A5B1FABC40848E7606507B36E6BCD94ECE2F7DD4390E025A9B6F02F5ED7646` |
| `jmeter/live_gemini_smoke.jmx` | `E9D9CC25A66420293B7A56AA9C0FFDAA896A7DDC9DDCC61D58DE009CFCA3B474` |
| `evaluation/results/jmeter/provider_summary.json` | `3478D1E2CC79CE15F43CB25FAEB7B0F6AE99E5FAC8E341CC0B1C722B47A804EC` |
| `evaluation/results/jmeter/rate_summary.json` | `6CD483A70E980D4B3D74C813D0BE469E1E73533974EA1A3531D33C38871DAECC` |
| `evaluation/results/jmeter/gemini_summary.json` | `F61249B4D5E021CCBDA355FBDD91FF6B26DD6E3BEF285496EB65A223A82B98C7` |
| `coverage.xml` (220-test run, 81.85%) | Not retained in the cleaned repository; regenerate with the documented coverage command before the next Sonar scan |
| `evaluation/results/sonar.json` | `7E2875B485228F27DDCF8086ADCAA3932F5E867D5DE90C57EC41CB8CC735760F` |
| `evaluation/results/langsmith.json` | `DDA60E6E8613046E9012E8226836A8F2111172052814D6AD3E598A34FD74A829` |
| `evaluation/results/reindex_dry_run.json` | `125640F8E6E11F0F6A468D2CDBFFA73BCC6184182E601B728181BD9589400FF5` |

## Interpretation limitation

Citation validation proves marker validity and paragraph/list coverage. It does not prove that every generated claim is semantically entailed by its cited evidence. Faculty review remains required.

The live-Gemini smoke measurement used the disposable Supabase project with an empty thesis corpus. It verifies live pipeline availability and latency, not retrieval relevance or generated-answer quality.
