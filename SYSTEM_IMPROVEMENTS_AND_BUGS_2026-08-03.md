# System Improvements, Enhancements, and Bug Inventory

| Control | Value |
|---|---|
| Purpose | Everything required to take the ISU Centralized AI-Powered Thesis Library (IskAI) from its current defense-ready state to a real-world university production web application with best-in-class UI/UX |
| System audited | Working tree at commit `9228da2` plus the uncommitted frontend accessibility work. **Updated 2026-08-03 and again 2026-08-04 after remediation** — see §0 for current status |
| Audit date | **2026-08-03** (original) · **2026-08-04** (second remediation pass) |
| Companion | `PAPER_VS_SYSTEM_COMPARISON_2026-08-03.md` — the paper-vs-system comparison and the required paper revisions |
| Grounding | Every item cites the file and line, the command output, or the dated artifact that justifies it. Defects that could not be reproduced today are listed separately in §2.5 rather than asserted as facts |

## Hard constraint — the evaluated pipeline is frozen

The RAG pipeline that produces the thesis's Objective 2 and Objective 4 evidence must not change before the defense. **No Phase A item in this document alters chunking, retrieval parameters, prompts, or models.** Anything that would is deliberately placed in Phase B or C.

Frozen surfaces: `config.py` RAG parameters (chunk size/overlap, retrieval threshold, top-*k*, duplication threshold, model names) · `services/chunker.py` · the ranking and reordering logic in `services/retriever.py` · the prompt templates in `routers/chat.py`.

## How to read this document

Every item carries three labels:

- **Priority** — **P0** (before any public production exposure) · **P1** (first production quarter) · **P2** (maturity) · **P3** (nice to have)
- **Effort** — **S** (hours to one day) · **M** (days) · **L** (a week or more)
- **Phase** — **A** (safe now, before the defense; hardening only) · **B** (post-defense pilot) · **C** (university scale)

…and a status mark:

| Mark | Meaning |
|---|---|
| ✅ | **Fixed and verified** — implemented, covered by a regression test, and all quality gates re-run green |
| 🟡 | **Partially fixed** — the harmful half is closed and verified; the remainder is named explicitly in the entry |
| ❌ | **Open** — not started. For a Phase B/C item this is deliberate, not neglect |
| 🧊 | **Deferred by design** — would change the frozen evaluated pipeline, so it must wait until after the defense baseline is locked |

---

## 0. Status as of 2026-08-04 (second remediation pass) 🚦

**Every P0 defect in §2.1 is closed, and every Phase A *code* defect is now closed outright.** 🎉 The three P0 items that gated public exposure — event-loop blocking, the accessibility gate, and unenforced signup domains — are fixed and verified. B14, the last Phase A item still carrying an open half on 2026-08-03, was closed on 2026-08-04 via the `kind` column rather than by skipping persistence.

**Closed in the 2026-08-04 pass:** B14 (structural half), R4, R7, S2, §3.5 async-state parity, and three newly found defects (**N12–N14**) — one of which, N12, was a hole in the lint gate itself that let a missing component import reach runtime.

**Still open in Phase A, by scope rather than by neglect:** #15 (the 890 kB three.js chunk), #19 (supply-chain hardening / S3), #20 (scheduled backups), R5 and R9, and item 7 — load-testing the real `/chat` path, which needs a disposable Supabase project rather than more code.

| Group | ✅ Fixed | 🟡 Partial | ❌/🧊 Open | Notes |
|---|---|---|---|---|
| **§2.1 Confirmed defects (B1–B20)** | **16** | 1 | 3 | All 3 open are post-defense by design: B10 and B20 are Phase B, B8 is 🧊 frozen-pipeline. The remaining partial is B9 (Phase A half done, Phase B pagination open) |
| **§2.2 Correctness risks (R1–R10)** | **6** | 1 | 3 | R1–R4, R6 and R7 closed; R8 improved; R5/R9/R10 open |
| **§2.3 Security gaps (S1–S6)** | 2 | 0 | 4 | S1 and S2 closed; the rest are policy or external, including the remaining P0 **S6** |
| **§2.4 Documentation defects (D1–D6)** | **6** | 0 | 0 | All closed 📄 |
| **§2.6 Newly discovered (N1–N14)** | **14** | 0 | 0 | Found by audits run *during* remediation, not present in the original report |

Counts above are generated from the status marks in this document, not maintained by hand.

### Measured after remediation ✅

| Gate | Before | After |
|---|---|---|
| PyTest | 430 passed / 90.87% | **586 passed, 3 skipped / 91.45%** 📈 |
| Pylint | 10.00/10 | **10.00/10** (exit 0) |
| ESLint | 0 errors, 0 warnings | **0 errors, 0 warnings** |
| Frontend unit tests | 29 | **44** 📈 |
| Frontend coverage | ❌ not reported (counted as 0%) | **✅ 91.12% lines / 83.25% branches**, gated at 85/80 📈 |
| Playwright (all specs) | ❌ 10 failing | **✅ 21 passed** |
| axe WCAG 2.2 AA | ❌ 55 blocking | **✅ 0 blocking** (25 advisory open) |
| `npm audit --omit=dev` | 0 vulnerabilities | **0 vulnerabilities** |
| `pip check` | passing | **passing** |
| OpenAPI drift gate | passing | **passing** (contract regenerated deliberately) |

Every figure above was read from the command's **exit code**, not from its printed
summary. Pylint is the reason that distinction is written down: it does not lower
its 10.00/10 score for refactor-category messages, so a green score sat above a
red exit status for two commits on `main`.

### The frozen pipeline was not touched 🧊

No fix altered chunking, retrieval parameters, prompts, or models. Verified concretely: all 62 resolved settings values are byte-identical after the `config.py` change, and the refusal-guard rewrite was diffed against the old rule over **all 43 evaluation questions** with **0 classification changes** — so no Objective 2 re-baselining is required.

### What still blocks production 🚧

Nothing in code. The remaining P0 is **S6 — Data Privacy Act operationalization** (legal/institutional), and the Phase B scaling work (§4.1 multi-process, §4.6 paid tier) before real load. Item 7 of §1 — load-testing the real `/chat` path — was gated on B1 and is now **unblocked**.

One correction to the 2026-08-03 wording: "nothing in code" was true of *availability*, but the cost ceiling was not in place. **S2** is now closed, so a determined script with valid Turnstile challenges can no longer drain the shared Gemini quota. Production configuration must declare the budget — the config validator will not start without it.

---

## 1. The twenty highest-impact items

| # | Item | Why it matters | Priority | Effort | Phase | Ref | Status |
|---|---|---|---|---|---|---|---|
| 1 | Move blocking I/O out of `async def` routes | A single novelty scan or upload freezes the **entire API** for every user, because synchronous embedding, RPC loops, and LLM calls run directly on the asyncio event loop | P0 | M | A | §2.1 B1 | ✅ Fixed | 
| 2 | Fix the WCAG 2.2 AA gate — 55 blocking findings | The accessibility suite fails today on every surface; a public university service must meet AA | P0 | M | A | §2.1 B2, §3 | ✅ Fixed | 
| 3 | Crash on `top_papers_json[0]` in the novelty scanner | Reproducible 500 for faculty at the exact moment a matched thesis was just deleted | P0 | S | A | §2.1 B3 | ✅ Fixed | 
| 4 | `delete_user` can never delete an uploader | `upload_jobs.owner_id` is `ON DELETE RESTRICT`; admins get an opaque 500 with no guidance | P0 | S | A | §2.1 B4 | ✅ Fixed | 
| 5 | Bound every Gemini client | Two `ChatGoogleGenerativeAI` clients have no timeout, retry cap, or output cap — a hung call holds a worker indefinitely | P0 | S | A | §2.1 B5 | ✅ Fixed | 
| 6 | Enforce the `@isu.edu.ph` signup domain server-side | Anyone with any email address can create an auto-approved student account today | P0 | S | A | §6.1 | ✅ Fixed | 
| 7 | Load-test the real `/chat` path | Every performance number on record measured non-RAG endpoints; the core feature's capacity is unknown | P0 | M | A/B | §4.7 | 🔓 Unblocked | 
| 8 | Server-side pagination, search, and filtering for the archive | `GET /papers` ships the whole catalog **and every profile row** to build one page | P1 | M | B | §2.1 B9, §4.3 | 🟡 Partial | 
| 9 | Multi-process API with externalized state | One uvicorn process is the entire API, and four caches live in its memory | P0 | M | B | §2.1 B10, §4.1 | ❌ Phase B | 
| 10 | Migrate `@app.on_event` to `lifespan` | Deprecated in FastAPI 0.139.2 and scheduled for removal | P1 | S | A | §2.1 B6 | ✅ Fixed | 
| 11 | Metrics, dashboards, and paging | Rich operational data exists but nobody is woken when it breaks | P1 | M | B | §5.1 | ❌ Phase B | 
| 12 | Gemini paid tier with a token budget breaker | Free-tier quota is the single biggest availability and data-governance constraint | P0 | S–M | B | §4.6 | ❌ Phase B | 
| 13 | Batch the per-chunk duplication RPC loop | Hundreds of serial round trips per manuscript, on both the ingestion and scan paths | P1 | M | B | §2.1 B8, §4.5 | 🧊 Frozen | 
| 14 | Make the accessibility gate deterministic | Some contrast findings are sampled mid-animation, so the count is not currently trustworthy | P1 | S | A | §2.1 B7, §3.2 | ✅ Fixed | 
| 15 | Fix the 890 kB three.js chunk | One route's decorative 3D is 237 kB gzipped — punishing on campus mobile data | P1 | M | A | §3.6 | ❌ Open | 
| 16 | Repair the broken evidence links and stale docs | `iso25010_evidence.md` points a panelist at a file that does not exist | P1 | S | A | §2.4 | ✅ Fixed | 
| 17 | Re-fingerprint the Objective 2 evaluation artifact | The retained smoke result records settings the current build no longer uses | P1 | S | A | §2.4 D3 | ✅ Fixed | 
| 18 | Hybrid retrieval and reranking | The largest available answer-quality gain; the paper's own literature review argues for it | P1 | L | B | §7.1 | 🧊 Frozen | 
| 19 | Supply-chain hardening (hash-locked deps, digest-pinned images, SBOM) | Direct dependencies are pinned; transitive ones are not | P1 | M | A | §6.3 | ❌ Open | 
| 20 | Scheduled backups with a measured RTO/RPO | Excellent backup tooling exists but runs only when someone remembers | P1 | S | A | §8.1 | ❌ Open | 

---

## 2. Bug and error inventory

### 2.1 Confirmed defects

Each entry states the defect, the concrete failure scenario, and the evidence. All were verified against the working tree on 2026-08-03.

---

#### [✅ **FIXED & VERIFIED**] B1 — Synchronous blocking I/O inside `async def` route handlers · **P0 · M · Phase A**

> **✅ Resolved 2026-08-03.** Every blocking call in the three handlers is now offloaded with `asyncio.to_thread`, matching `routers/chat.py`. The per-chunk RPC loop moved into `_match_chunks_against_archive()` so the whole serial loop crosses into a worker thread **once** instead of per chunk — the loop body is a verbatim move, so the duplication mathematics and stored evidence are identical. The two Gemini calls became `await llm.ainvoke(...)`, which yields instead of occupying a worker thread for up to 25 s.
>
> **The audit under-counted this defect.** An AST sweep of every async function found `resolve_effective_department` called synchronously at `routers/chat.py:594` and `:628` — two Supabase round trips on *every* chat request, in the very file this entry cites as the correct example, one line above a properly offloaded call. Both are fixed.
>
> Verified by `tests/test_event_loop_responsiveness.py` (13 tests): thread identity proves each call is offloaded (exact, not timing-dependent); a heartbeat proves the loop keeps control; a self-check proves the probe can detect a stall at all; and an AST guard over all 17 async functions fails if any known-blocking helper is called outside an `await`. Reverting one offload was confirmed to fail the suite.

**Where:** `routers/duplication.py:76` (`scan_duplication`), `routers/upload.py:206` (`upload_paper`), `routers/upload.py:474` (`extract_metadata`).

FastAPI runs a plain `def` handler in a thread-pool worker, but runs an `async def` handler **on the event loop itself**. Three handlers are declared `async def` and then perform long, fully synchronous work on that loop:

| Handler | Blocking calls on the loop |
|---|---|
| `scan_duplication` | `embed_texts()` (`duplication.py:113` — remote Gemini, batched, retried) · a `sb.rpc('match_chunks')` loop, one call **per chunk** (`:123-130`) · `llm.invoke()` for the verdict (`:231`) · `sb.table('scan_history').insert()` (`:256`) |
| `upload_paper` | `fitz.open()` (`upload.py:112`) · `sb.rpc('reserve_upload_job')` (`:252`) · `sb.storage.from_('pdfs').upload()` (`:282`) · `sb.rpc('queue_upload_job')` (`:300`) |
| `extract_metadata` | `fitz.open()` (`:484`) · `sb.table('departments').select()` (`:498`) · `llm.invoke()` (`:520`) |

**Failure scenario.** A faculty member scans a 60-page proposal draft. That produces roughly 40–80 chunks, so `scan_duplication` performs one embedding batch, 40–80 sequential Supabase RPCs, and one Gemini verdict call — plausibly 20–60 seconds — **all on the single event loop**. For that entire window the API cannot service *any* other request: not `/chat`, not `/health`, not the readiness probe. To a load balancer the service looks down; to students the chat appears frozen. Two concurrent scans double it.

**Why it is clearly a defect rather than a design choice:** `routers/chat.py` does exactly the right thing in the same codebase — every blocking call there is wrapped in `asyncio.to_thread` (`chat.py:530, 543, 553, 559, 595, 630, 664, 676, 688, 705`). The three handlers above simply never received the same treatment.

**Fix (does not touch the frozen pipeline):** either drop `async` from these handlers so FastAPI runs them in its thread pool, or wrap each blocking call in `asyncio.to_thread`, matching `routers/chat.py`. Prefer the second for `scan_duplication` so the per-chunk RPC loop can also be parallelized later (§4.5).

---

#### [✅ **FIXED & VERIFIED**] B2 — WCAG 2.2 AA accessibility gate is failing: 55 blocking findings across all ten surfaces · **P0 · M · Phase A**

> **RESOLVED 2026-08-03** in commit `930927f`. The gate reports **0 blocking
> findings** across 11 surfaces × 4 theme states × {1280 px, 360 px}; the 25
> moderate `heading-order` findings remain recorded as advisory and are still
> open. CI (`Quality — ISO/IEC 25010`) is green on that commit.
>
> Two causes in roughly equal measure — see the correction below before citing
> the 55 figure. Semantic text tokens (`--text-primary` / `-secondary` /
> `-tertiary`) replaced `opacity-*` de-emphasis, a text-safe gold and verified
> badge pairs replaced the same-family colour guesses, and high contrast now
> strengthens text rather than only thickening the glass — which is why those
> states had been scoring *worse* than standard. Contrast maths, the tone bounds
> and the badge pairings are now asserted in unit tests, so the tokens stay
> verified rather than verified once.
>
> §3.1 Pattern 4 (the 12 px minimum) is **not** included: it does not affect the
> gate, because axe already applies the 4.5:1 threshold below 18.66 px.

**Evidence:** `rag-thesis-frontend/test-results/.last-run.json` → `"status": "failed"`, 10 failed tests. `rag-thesis-frontend/test-results/axe-report.json`, generated 2026-08-03T03:40:08Z with axe-core 4.12.1 → `totals: { blocking: 55, advisory: 25 }`.

| Rule | Impact | Count | Meaning |
|---|---|---|---|
| `color-contrast` | serious | 46 | Text below the 4.5:1 AA threshold |
| `aria-prohibited-attr` | serious | 7 | `aria-label` on an element with no valid role |
| `scrollable-region-focusable` | serious | 2 | A horizontally scrollable region no keyboard user can reach |
| `heading-order` | advisory | 25 | Heading levels skipped |

**By surface** (blocking findings, all four theme states, 360 px and 1280 px):

| Surface | Findings | Worst single scan |
|---|---|---|
| admin-overview | 8 | 24 nodes, light-standard 1280 |
| admin-operations | 5 | 21 nodes, light-standard 1280 |
| admin-upload-history | 5 | 19 nodes, light-standard 1280 |
| landing | 5 | 15 nodes, light-high-contrast 1280 |
| dashboard | 5 | 15 nodes, light-high-contrast 1280 |
| archive | 5 | 12 nodes, light-standard 1280 |
| admin-system-management | 6 | 8 nodes, light-standard 1280 |
| novelty | 5 | 10 nodes, light-high-contrast 1280 |
| guest-chat | 5 | 7 nodes, light-standard/high-contrast 1280 |
| upload | 5 | 7 nodes, light-high-contrast 1280 |

**Root causes** — these are systemic token-level problems, not ten separate page bugs. Full analysis and the fix strategy are in §3.

> **Correction (2026-08-03, after the fix).** The claim below that these are
> "not animation artifacts" was **wrong for the majority of the 55 findings**, and
> the reasoning behind it was unsound: a computed colour matching a static token
> does not establish that the *element* was fully painted when axe sampled it.
>
> Framer Motion's reduced-motion setting deliberately continues to animate
> opacity — it suppresses only transform and layout animations — so staggered
> fade-ins were still running during the scan and axe measured whatever partial
> alpha each element happened to be at. Proof, by composition rather than
> inspection: the landing nav link reported `#9d9f9a` on `#fbfdf7`, which is
> exactly the correct `#535552` composited over that background at α ≈ 0.56, and
> the *same node* implied α ≈ 0.25 in dark-standard. A fixed class cannot yield
> two different alphas. Decisively, `opacity-80` text reported **1.04:1**, a
> ratio that class cannot produce under any surface.
>
> Once animations were settled (`MotionGlobalConfig.skipAnimations`, opted into by
> the accessibility suite alone), **55 blocking findings fell to 4** with no token
> changes applied. The remaining genuine defects are the two colour rows below
> plus the `opacity-*`-on-text class, and those were fixed at the token layer.
>
> Net: roughly two thirds of §B2 measured the harness, not the design system. The
> per-surface counts in the table above are therefore inflated and should not be
> cited as a pre-fix baseline. Gate determinism (§3.2) was the prerequisite for
> the contrast work, not a follow-up to it.

**Contrast failures as originally recorded** (the two colour rows are genuine and
were fixed; the four `opacity-*` rows conflate a real class-level defect with the
mid-fade sampling described above):

| Pattern | Computed | Ratio | Where |
|---|---|---|---|
| `text-flame-600` on `bg-flame-500/12` role badge | `#d22630` on `#f3e0dc` | **4.06** | 10 occurrences; `--color-flame-600` is `index.css:39` |
| `text-gold-500` on a light surface | `#d97706` on `#fbfdf7` | **3.10** | 8 occurrences; `--color-gold-500` is `index.css:30` |
| `opacity-45` body text | `#959893` on `#fbfdf7` | **2.85** | light-standard |
| `opacity-45` on `text-[0.65rem]` | `#646763` on `#191c19` | **2.99** | dark-standard |
| `opacity-55` on `text-[0.62rem]` uppercase label | `#7c7e7a` on `#f4f5f0` | **3.74** | light-standard |
| `opacity-50` on `text-[0.68rem]` label | `#7d807c` on `#191c19` | **4.29** | dark-standard |

`aria-prohibited-attr` traces to a single line: `src/pages/Admin.jsx:27` — `<div className="space-y-4" aria-label="Loading administration data">`. A `div` with no role cannot carry an accessible name. Fix by adding `role="status"` (which also announces the loading state to screen readers, an improvement in its own right).

`scrollable-region-focusable` affects the `.overflow-x-auto` table wrappers on admin operations and upload history at 360 px: the region scrolls with a mouse but cannot be reached or scrolled with a keyboard. Fix with `tabIndex={0}` plus an accessible name on the wrapper.

---

#### [✅ **FIXED & VERIFIED**] B3 — `IndexError` crash in the novelty scanner · **P0 · S · Phase A**

**Where:** `routers/duplication.py:189` — `primary_match = top_papers_json[0]`.

`top_pids` is derived from `paper_matches`, which is non-empty inside this branch. But `top_papers_json` is only appended for a `pid` that is still present in `paper_lookup` (`:176-187`), and `paper_lookup` comes from a *separate, later* query against `papers` (`:171`).

**Failure scenario.** A faculty member starts a scan. Between the `match_chunks` RPC and the metadata lookup, an administrator deletes the only archived thesis that matched — or that paper's row is mid-`deletion_pending`. `paper_lookup` comes back empty, `top_papers_json` stays `[]`, and line 189 raises `IndexError`. The user gets an unhandled 500 with no explanation, after having already paid for the full embedding and RPC cost of the scan.

**Fix:** guard for an empty `top_papers_json` and fall through to the "no matches" branch, or refetch. Also consider populating `paper_lookup` from the RPC result, which already carries the paper metadata.

---

#### [✅ **FIXED & VERIFIED**] B4 — Deleting a user who has ever uploaded always fails with an opaque 500 · **P0 · S · Phase A**

**Where:** `routers/analytics.py:207-234` (`delete_user`) against `supabase_setup.sql:720` and `:1274` — `upload_jobs.owner_id uuid not null references auth.users(id) on delete restrict`.

`profiles.id` cascades from `auth.users` (`supabase_setup.sql:32`), so `sb.auth.admin.delete_user()` is the right call — but `upload_jobs.owner_id` uses `ON DELETE RESTRICT`. Any user who has ever submitted an upload has at least one `upload_jobs` row, and PostgreSQL will refuse the delete.

**Failure scenario.** An administrator tries to remove a graduated student who once uploaded a thesis. The delete raises, is caught at `:232`, and returns `HTTPException(500, 'The user could not be deleted safely')`. The admin has no way to know why, no way to proceed, and the account stays active indefinitely. Because `upload_jobs` rows are the *point* of the system, this affects exactly the accounts an administrator most wants to retire.

**Fix:** decide the intended semantics and make them explicit. Either (a) return `409 Conflict` with a clear message naming upload history as the blocker and offer a "deactivate instead" path (set `status = 'rejected'`), or (b) change the constraint to `ON DELETE SET NULL` with `owner_id` nullable and preserve the job record for audit. Option (a) is safer and does not require a migration. Add a regression test either way — none currently covers this path.

---

#### [✅ **FIXED & VERIFIED**] B5 — Two Gemini clients are constructed with no timeout, retry cap, or output cap · **P0 · S · Phase A**

> **✅ Resolved.** Both clients are bounded. 🟡 One remainder: the `extract_metadata` client is still constructed **per request** (`routers/upload.py`), which defeats connection reuse. Not a correctness issue, and hoisting it would break the four tests that monkeypatch `upload.ChatGoogleGenerativeAI` to intercept construction.

**Where:** `routers/duplication.py:35-38` (module-level, used for the verdict and the follow-up chat) and `routers/upload.py:506-509` (constructed **per request** inside `extract_metadata`).

Both are:

```python
ChatGoogleGenerativeAI(model=..., google_api_key=...)
```

Compare `routers/chat.py:61-68`, which correctly sets `timeout`, `max_retries`, `max_output_tokens`, and `thinking_level` from configuration.

**Failure scenario.** Gemini becomes slow rather than erroring — a common degradation mode under quota pressure. The verdict call in `scan_duplication` has no timeout, so it hangs. Combined with **B1**, that hang is *on the event loop*, so the whole API stops responding until the underlying HTTP client eventually gives up. The per-request client in `extract_metadata` additionally rebuilds the client and its transport on every upload-form interaction, which is wasteful and defeats connection reuse.

**Fix:** give both clients the same bounded contract as `routers/chat.py`, and hoist the `extract_metadata` client to module scope.

---

#### [✅ **FIXED & VERIFIED**] B6 — Deprecated FastAPI startup/shutdown hooks · **P1 · S · Phase A**

> **✅ Resolved 2026-08-03.** Both hooks replaced by an `asynccontextmanager` `lifespan` passed to `FastAPI(lifespan=...)`. `start_operations_monitor` / `stop_operations_monitor` are retained as named helpers so the existing lifecycle test still drives them directly, and the stop half now runs in a `finally` — a guarantee two independent hooks could not give. Verified: `app.router.on_startup == []`, `on_shutdown == []`, a full `TestClient` start/stop cycle, and no `on_event` DeprecationWarning.
>
> **Found while fixing this:** `config.py` declared settings with a class-based `Config`, deprecated in Pydantic V2 and **removed in V3.0**, emitting `PydanticDeprecatedSince20` on every import. Now `SettingsConfigDict`. Proven value-for-value safe: all **62** resolved settings identical, `env_file`/`extra` unchanged, frozen RAG contract exact. See **N9**.

**Where:** `main.py:121` `@app.on_event('startup')` and `main.py:131` `@app.on_event('shutdown')`.

`on_event` has been deprecated since Starlette 0.26 / FastAPI 0.93 and is slated for removal. On FastAPI 0.139.2 it emits a `DeprecationWarning` on every application start. It also cannot express setup/teardown as a single scoped unit, which matters here because the operations monitor thread's start and stop are two halves of one lifecycle.

**Fix:** replace both with an `asynccontextmanager` `lifespan` passed to `FastAPI(lifespan=...)`. Purely mechanical; no behaviour change. The 3 currently-skipped tests and the `main.py` coverage gap (87.50%) sit near this code, so add a lifespan test at the same time.

---

#### [✅ **FIXED & VERIFIED**] B7 — The accessibility matrix samples text mid-animation, so its counts are not deterministic · **P1 · S · Phase A**

**Where:** `e2e/accessibility.spec.js` (no animation-settle wait before `AxeBuilder.analyze()`), interacting with `src/components/ui/Motion.jsx:8-45` (`PageTransition`, `Reveal`, `staggerItem`).

The matrix sets `motion: 'reduced'` and `effects: 'low'` (`accessibility.spec.js:436-437`), and `PreferenceMotion` correctly applies `<MotionConfig reducedMotion="always">` (`PreferencesContext.jsx:99-106`). But Framer Motion's `reducedMotion: 'always'` disables *transform and layout* animations by design and **deliberately keeps opacity and colour animations running**. Every page still fades in from `opacity: 0`.

**Evidence.** Among the 46 contrast findings are computed colours that match no design token — `#de8b2a`, `#e8b372`, `#da7b0d`, `#676a66`, `#636563`. These are intermediate blends of `--color-gold-500` (`#d97706`) and `#fbfdf7` sampled part-way through a fade. Contrast ratios as low as **1.84** appear only in these transient samples.

**Consequence.** The gate is flaky, and the headline "55 blocking findings" mixes genuine token defects with sampling artifacts. Either number could change between runs, which makes the report unusable as defense evidence and unusable as a CI gate.

**Fix:** before each `analyze()` call, wait for animations to settle — `await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))` plus a short settle for Framer's JS-driven values, or expose a test hook that disables entrance opacity animations under `motion: 'reduced'`. Then re-run and treat the resulting count as the authoritative baseline. Expect it to drop materially; the six stable patterns in **B2** will remain.

---

#### [🧊 **DEFERRED — frozen pipeline**] B8 — Duplication screening performs one Supabase RPC per chunk, serially · **P1 · M · Phase B**

**Where:** `services/novelty.py:91-101` (ingestion path) and `routers/duplication.py:123-130` (faculty scan path).

```python
for emb in embeddings:
    res = sb.rpc('match_chunks', {...'match_count': 1...}).execute()
```

**Failure scenario.** A 500-page manuscript (the configured `max_pdf_pages`) yields several hundred chunks, so ingestion performs several hundred sequential network round trips against Supabase. At a realistic 80–150 ms each that is 30–90 seconds of pure latency inside the `screen` stage. The worker survives this — the background heartbeat thread keeps the lease alive (`workers/ingestion_worker.py:89-104`) — so it is a throughput problem rather than a correctness problem on the ingestion path. On the scan path it compounds **B1** directly.

**Fix (Phase B, because it changes a scored pipeline stage):** add a batch RPC that accepts an array of embeddings and returns the best match per input in one round trip, or run the existing calls concurrently with a bounded worker pool. Keep the mathematics identical — same threshold, same `match_count: 1`, same provenance parameters — so the 85% contract and the evaluation evidence are unaffected.

---

#### [🟡 **PARTIALLY FIXED**] B9 — Every archive listing reads the entire `profiles` table · **P1 · S · Phase A (query) / M · Phase B (pagination)**

> **🟡 Phase A half resolved 2026-08-03.** The uploader lookup is now scoped with `.in_('id', uploader_ids)` and skipped entirely when no paper has an uploader, so `GET /papers` no longer transfers the whole `profiles` table per request. **Still open (Phase B):** the endpoint still returns the entire catalogue including every abstract and `Archive.jsx` filters client-side — server-side pagination, search, and filtering remain as described in §4.3.

**Where:** `routers/papers.py:75` — `sb.table('profiles').select('id,full_name,email').execute()`.

This runs on **every** `GET /papers` call, with no filter and no limit, purely to map `uploaded_by` to a display name. The endpoint itself also returns the entire catalog including every abstract, and `src/pages/Archive.jsx` filters it client-side.

**Failure scenario.** At university scale — say 3,000 users and 4,000 theses — each archive page load transfers thousands of profile rows to the API process and megabytes of abstracts to the browser. At the current 50-thesis defense scale this is invisible, which is exactly why it needs to be written down now.

**Fix (Phase A, cheap):** restrict the profile query to the `uploaded_by` values actually present, using `.in_('id', uploader_ids)` — the same pattern `routers/analytics.py:303-312` already uses correctly for system logs. **Fix (Phase B):** add server-side pagination, search, and filtering — see §4.3.

---

#### [❌ **OPEN — Phase B**] B10 — Four caches live in process memory, so the API cannot be replicated · **P0 · M · Phase B**

**Where:** `dependencies/auth.py:23` (`_ROLE_CACHE`), `dependencies/auth.py:281` (`_FEATURES_CACHE`), `routers/chat.py:81` (`_CAPACITY_STATE`), `services/turnstile.py:33` (`_verified_guests`).

**Failure scenario with two replicas.** Replica A receives a Gemini 429 and opens its capacity circuit breaker for 60 seconds. Replica B knows nothing, keeps sending requests, and keeps getting 429s — the breaker protects nothing. A guest solves the Turnstile challenge against replica A, then their next message routes to replica B and is rejected with "Please complete the security check to continue" — an infinite loop the user cannot escape. An admin changes a role and calls `invalidate_role_cache`; only one replica forgets it.

The Turnstile module documents this honestly (`services/turnstile.py:10-13`), which is good practice — but it is still a hard blocker on horizontal scaling.

**Fix:** move the capacity breaker and the verified-guest set into the Redis instance that already backs rate limiting in production. The two 60-second role caches are tolerable per replica (worst case: one extra lookup per replica per minute), but role invalidation should publish on a Redis channel so it is prompt everywhere.

---

#### [✅ **FIXED & VERIFIED**] B11 — `_ROLE_CACHE` grows without bound · **P2 · S · Phase A**

> **✅ Resolved 2026-08-03.** Expired entries are pruned on every write and a hard ceiling of 2,048 evicts oldest-first, so the cache can no longer grow one entry per user who ever authenticated. Access is now guarded by a `threading.Lock` — reads and writes arrive from both the event loop's worker threads and FastAPI's sync-dependency pool, and the prune-then-delete sequence was previously unsynchronized. The lock is held for dict access only, never across the profile lookup.

**Where:** `dependencies/auth.py:23-42`.

Entries are added per distinct user id and expire only by TTL comparison at read time. Nothing ever removes a key that is not read again. `invalidate_role_cache()` clears one key or all keys, but is only called on an explicit role change.

**Failure scenario.** A long-running API process serving a whole university accumulates one small tuple per user who has ever authenticated, forever. It is a slow leak rather than an outage, but it is unbounded, and it interacts badly with the multi-replica plan in **B10**.

**Fix:** replace with a bounded LRU (`functools.lru_cache` with a manual TTL, or `cachetools.TTLCache(maxsize=..., ttl=60)`), or prune expired keys opportunistically the way `services/turnstile.py:41-45` already does.

---

#### [✅ **FIXED & VERIFIED**] B12 — `GET /settings/features` writes to the database · **P2 · S · Phase A**

> **✅ Resolved 2026-08-03.** The GET is read-only and returns `DEFAULT_FEATURES` when the row is absent. The row is already seeded by `supabase_setup.sql`, so the insert path was pure legacy. This also removes the retry hazard: `src/api.js` retries GETs on transient gateway errors, so a retried request could previously attempt the insert twice.

**Where:** `routers/settings.py:45-57`.

If the `role_features` row is missing, a **GET** inserts it. The endpoint is available to any authenticated user (`CurrentUser`, not `SuperadminUser`), while the corresponding PUT is superadmin-only.

**Failure scenario.** Any student's first page load after a fresh deployment writes a system-settings row. Two concurrent first loads race; the second insert violates the primary key and surfaces as a 500 instead of the settings payload. More broadly, a GET with a side effect breaks caching, retry, and prefetch assumptions — and `src/api.js` retries GETs on transient gateway errors (`api.js:96-105`), so a retried GET could attempt the insert twice.

**Fix:** seed `role_features` in `supabase_setup.sql` (the defaults are already declared at `routers/settings.py:18-21`) and make the GET read-only, returning `DEFAULT_FEATURES` if the row is absent.

---

#### [✅ **FIXED & VERIFIED**] B13 — Fragile AI-JSON parsing in metadata extraction · **P2 · S · Phase A**

> **✅ Resolved 2026-08-03.** Both problems fixed in a new shared `services/llm_output.py`: `coerce_text()` joins multi-part content blocks instead of calling `.strip()` on a list, and `strip_code_fence()` removes a real fence or `json` label by anchored regex. The old `lstrip('json')` was never prefix removal — it stripped *any* leading run of j/o/s/n. Every shape the old chain parsed still parses (verified side by side), and the three duplicate implementations in `chat.py`, `duplication.py` and `upload.py` now share one.

**Where:** `routers/upload.py:521-523`.

```python
content = result.content if hasattr(result, 'content') else str(result)
clean_json = content.strip().lstrip('`').lstrip('json').rstrip('`').strip()
data = json.loads(clean_json)
```

Two problems. First, `str.lstrip('json')` strips *any* leading run of the characters `j`, `o`, `s`, `n` — it is not a prefix removal. Second, `result.content` from a Gemini chat model can be a **list** of content blocks, in which case `content` is a list and `.strip()` raises `AttributeError`. The same file's sibling module solves this correctly with `_coerce_answer` (`routers/chat.py:354-361`) and `_coerce` (`routers/duplication.py:50-56`).

**Failure scenario.** The model returns a fenced block or a multi-part response. The parse throws, is swallowed by the broad `except Exception` at `:536`, and the endpoint silently returns only the locally extracted fields. The admin sees the AI autofill "not working" with no error and no log correlation beyond a generic exception type.

**Fix:** reuse the existing `_coerce_answer` helper, and replace the `lstrip` chain with a proper fenced-block regex (`^```(?:json)?\s*|\s*```$`).

---

#### [✅ **FIXED & VERIFIED**] B14 — Capacity and error responses are saved as chat history · **P2 · S · Phase A**

> **🟡 Partially resolved 2026-08-03 — the harmful half.** Stored system notices (capacity apology, refusal, no-relevant-thesis) are now recognized by `_is_stored_non_answer()` and excluded when history is loaded, so they can no longer be replayed to the model as conversational context or leave a follow-up with nothing to anchor to. The capacity message has a single definition (`CAPACITY_MESSAGE`) shared by the responder and the filter.
>
> **✅ Closed 2026-08-04 — the structural half**, via the `kind` column this entry recommended rather than by skipping persistence. Migration `20260804_chat_message_kind.sql` adds `chat_messages.kind` (`'answer' | 'notice'`, check-constrained), backfills every pre-existing notice row from the four known message prefixes, extends `save_chat_exchange` with `p_kind`, and drops the 8-argument signature so no caller can reach the old body and write an unmarked notice. A rollback migration ships alongside it.
>
> `services/chat_notices.response_kind()` classifies at the source — structurally where a structural signal exists (`no_relevant_thesis` is already a field), by exact equality against module constants otherwise, so a genuine answer that merely *mentions* a usage limit is not misfiled. `_load_chat_history` filters `kind = 'answer'` in SQL **before** the five-row limit, so a session whose recent turns were mostly notices now returns five usable exchanges instead of five rows that get discarded in Python. A partial index covers exactly that query.
>
> **The chosen trade-off:** notices are still persisted and still shown in the user's own transcript, because the conversation did happen and dropping the question they asked would be a worse outcome than showing them why it could not be answered. What changed is that a notice is no longer *model context* and no longer *counts as an answer*. Skipping persistence outright was rejected for the reason recorded above — it would leave `history_saved === false` and surface a misleading "history was not saved" warning.
>
> `_is_stored_non_answer()` is retained as defence in depth, not dead code: it still covers rows written by an older build and any row whose stored text is a notice while its `kind` says otherwise. 25 regression tests in `tests/test_chat_notices.py`, including a check that the SQL backfill matches every notice string the application can actually produce.
>
> Analytics needed no change — every notice path returns before the `chat_query` activity event is logged, so notices were never counted as queries. Verified rather than assumed.

**Where:** `routers/chat.py:591-608`.

The `chat()` wrapper persists whatever `_chat_impl` returned. When Gemini quota is exhausted, `_chat_impl` returns `_capacity_response()` — *"IskAI has reached the research AI service usage limit…"* — as a normal `ChatResponse`, so it is written to `chat_messages` through `save_chat_exchange` as if it were an answer.

**Failure scenario.** A student asks a good question during a quota outage. The apology is stored permanently in their conversation with zero sources. Later, `_load_chat_history` (`chat.py:364-375`) feeds that apology back as conversational context for the next question, and `find_papers_by_ids` finds no prior sources to anchor follow-ups. The transcript is also polluted for anyone reviewing usage analytics.

**Fix:** mark non-answers (capacity responses, the deterministic refusal at `:657`, and the no-relevant-thesis response) with an internal flag and skip persistence, or persist them with a `kind` column so the UI and the history loader can exclude them.

---

#### [✅ **FIXED & VERIFIED**] B15 — Unsynchronized shared state between the heartbeat thread and the ingestion thread · **P2 · M · Phase A**

> **✅ Resolved 2026-08-03.** `LeaseHeartbeat` now guards `valid`/`cancel_requested` with a lock (exposed as properties, so existing callers and tests are unchanged) and serializes control RPCs so a keep-alive can never land out of order against a real stage update. The background thread sends a **bare** keep-alive carrying no stage, progress, or message, so it cannot overwrite what the pipeline reported. Verified by a concurrency test asserting zero overlapping RPCs across 8 threads.

**Where:** `workers/ingestion_worker.py:50-104`.

`LeaseHeartbeat.update()` is called both from the pipeline thread (via `_require_lease`) and from the background thread in `_run`. It reads and writes `self.valid` and `self.cancel_requested` with no lock, and can issue two overlapping `heartbeat_job_control` RPCs.

**Failure scenario.** The background thread's periodic `update()` (which passes no stage or progress) overlaps the pipeline thread's `update(stage='embed', progress=58, …)`. Depending on arrival order at PostgreSQL, the job row can end up with a stale stage/progress, so the admin's upload progress bar jumps backwards. In a worse interleaving, the background thread sets `self.valid = False` after a transient RPC failure while the pipeline thread is mid-check, aborting a perfectly healthy job with `LeaseLostError` and forcing a full retry from stage one.

**Fix:** guard the mutable state with a `threading.Lock`, and have the background thread perform only a bare keep-alive that never overwrites stage or progress.

---

#### [✅ **FIXED & VERIFIED**] B16 — Unsanitized client filename persisted from the novelty scanner · **P3 · S · Phase A**

> **✅ Resolved 2026-08-03.** Both endpoints now share `services/filenames.sanitize_filename()`. The scan path persists and logs the sanitized name; the upload path's contract is byte-for-byte unchanged, proven by differential testing over 12 adversarial inputs (0 mismatches). The shared helper preserves a safe extension, which the scan path needs because it accepts both PDF and TXT.

**Where:** `routers/duplication.py:243` and `:259` — `'filename': file.filename` is written straight to `scan_history` and to the activity log.

The upload path correctly sanitizes with `_sanitize_filename()` (`routers/upload.py:92-96`), which strips path components and non-safe characters and caps the length. The scan path does neither.

**Failure scenario.** A 4,000-character filename, or one containing path separators or control characters, is stored and then rendered in the scan-history list and in the admin activity log. React escapes it, so this is not a live XSS; the practical impact is layout breakage, log pollution, and an inconsistent validation posture across two endpoints that accept the same kind of file.

**Fix:** reuse `_sanitize_filename` (promote it to a shared helper) and cap the stored length.

---

#### [✅ **FIXED & VERIFIED**] B17 — A 401 anywhere forces a full page reload to `/login` · **P2 · S · Phase A**

> **✅ Resolved 2026-08-03.** A 401 now attempts one silent `supabase.auth.refreshSession()` and replays the request, so an access token expiring between two messages is invisible to the user — the open conversation, the typed-but-unsent question, and an in-progress upload form all survive. Concurrent 401s collapse onto a single refresh rather than racing. On genuine auth failure the redirect carries `?returnTo=`. 🟡 Remaining nicety: the final redirect is still a hard navigation rather than the router's `navigate()` with a toast, because the Axios interceptor has no router access.

**Where:** `src/api.js:107-111`, interacting with `dependencies/auth.py:200-217`.

Any 401 triggers `supabase.auth.signOut()` and `window.location.href = '/login'` — a hard navigation that discards all React state. Meanwhile `get_optional_user` **raises 401 for a merely stale token** rather than degrading the caller to guest, even on the guest-capable `/chat` route.

**Failure scenario.** A student has the chat open with a long conversation on screen. Their access token expires between messages, or a background refresh briefly races. The next request 401s, the SPA hard-navigates, and the typed-but-unsent question and the entire visible transcript are lost with no warning. This is the single most user-visible reliability annoyance in the product.

**Fix:** attempt one silent `supabase.auth.refreshSession()` and replay the request before giving up; on genuine failure use the router's `navigate()` with a `returnTo` parameter and a toast rather than `window.location.href`. Independently, consider having `get_optional_user` degrade an expired token to guest on the guest-capable route rather than rejecting it.

---

#### [✅ **FIXED & VERIFIED**] B18 — `.execute().data[0]` on catalog inserts can raise `IndexError` · **P3 · S · Phase A**

> **✅ Resolved 2026-08-03.** `catalog.py` inserts go through `_inserted_row()`, which maps a duplicate `code` to **409 Conflict** naming the code, and a missing PostgREST representation to a 502 telling the operator to reload before retrying. The same guard was added to `departments.py` create *and* update, which had the identical unguarded `.data[0]` (see **N5**). The OpenAPI contract was regenerated for the two new documented responses.

**Where:** `routers/catalog.py:89` and `routers/catalog.py:109`.

Both return `sb.table(...).insert(row).execute().data[0]` with no guard. PostgREST does not always return a representation, and a unique-constraint violation on `code` surfaces as a raw exception rather than a `409 Conflict`.

**Failure scenario.** A superadmin creates a program whose code already exists. Instead of "that code is already in use," they get an unhandled 500. Fix by checking `data` before indexing and mapping constraint violations to 409.

---

#### [✅ **FIXED & VERIFIED**] B19 — Unauthenticated, unbounded, un-rate-limited analytics and catalog endpoints · **P2 · S–M · Phase A**

> **✅ Resolved 2026-08-03.** `GET /analytics/summary`, both `/catalog/departments` reads, and `GET /departments/` now carry an explicit `rate_limit_public` limit (30/minute, stricter than the 120/minute global default). `GET /departments/` was **not** in the original entry — it is equally unauthenticated and was also using `select('*')`, now an explicit field list (see **N5**). 🟡 Still open: computing the summary from SQL aggregates rather than a full-table read, and the deliberate decision about whether the catalog should be public at all.

**Where:** `routers/analytics.py:49-72` (`GET /analytics/summary`) and `routers/catalog.py:73-80` (`GET /catalog/departments`, `GET /catalog/departments/legacy`).

None of the three declares an auth dependency or a `@limiter.limit` decorator. `public_summary` performs an **unfiltered, unlimited** read of every ready paper in the evaluation department on every call and aggregates in Python.

**Failure scenario.** The landing page calls `/analytics/summary` for every anonymous visitor. A trivial script hitting that endpoint in a loop forces a full-table read per request against Supabase — a cheap denial-of-wallet and denial-of-service vector that sits outside the chat rate limits entirely. Only the global `120/minute` default limit applies, keyed by IP.

**Fix:** compute the summary from SQL aggregates (or cache it for 60 seconds), add an explicit rate limit to all three endpoints, and decide deliberately whether the catalog structure should be public at all.

---

#### [❌ **OPEN — Phase B**] B20 — Full-table reads aggregated in Python on the admin dashboard · **P2 · M · Phase B**

**Where:** `routers/analytics.py:79-133` (`overview`) — three unlimited `select()` calls against `papers`, `profiles`, and `scan_history`, then `Counter` aggregation in the API process.

Correct at 50 theses; it becomes the slowest endpoint in the system as the corpus and user base grow, and it holds the event loop through a synchronous Supabase client (the handler is `def`, so it at least runs in the thread pool). Replace with SQL aggregate RPCs.

---

### 2.2 Correctness risks and hardening gaps

Not currently failures, but each one will become one.

| Status & # | Item | Where | Note |
|---|---|---|---|
| ✅ Fixed R1 | Naive local time in year validation | `routers/upload.py:145` | `datetime.now().year` uses the server's local timezone; every other timestamp in the codebase is timezone-aware UTC. A New Year's Eve upload can be rejected or accepted inconsistently. Use `datetime.now(timezone.utc)` |
| ✅ Fixed R2 | Silent exception swallow | `routers/upload.py:380-381` | A bare `except Exception: pass` around the `last_event_at` lookup hides genuine database problems with no log line at all |
| ✅ Fixed R3 | Dead code in the log filter | `routers/analytics.py:314-320` | `logs` is already limited by `.limit(limit)`, so the `if len(filtered_logs) >= limit: break` guard can never fire. Harmless, but it implies a filter that does not exist |
| ✅ Fixed R4 | `select('*')` in hot paths | `routers/sessions.py`, `routers/analytics.py`, `routers/maintenance.py`, `routers/catalog.py`, `routers/departments.py`, `routers/duplication.py`, `services/operations.py` | **Closed 2026-08-04.** The audit listed 7 sites; a fresh sweep found **13**, including three the original pass missed (`departments.py` ×2, `duplication.py`, `services/operations.py`). Client-facing listings now pin the *complete current* column set, so today's payloads are byte-identical and only a future column requires a deliberate edit; server-internal reads were narrowed to the columns actually used, which also stops the duplication follow-up from pulling the unused report payloads on every question. `ALERT_FIELDS`/`WORKER_FIELDS` are shared between the internal fallback read and the client-facing listing so the two cannot drift. Guarded by an AST sweep over every production module — with a planted-wildcard test proving the detector fires — plus a check that every pinned column is declared by the schema or a migration |
| ❌ Open R5 | Novelty-scan excerpts stored at rest | `routers/duplication.py:253` | `scan_history.matched_chunks` persists up to five 320-character excerpts of archived manuscripts. Correctly excluded from every API response (`_public_scan`, and the explicit field list in `get_history`), but it is archived text at rest and should be named in the privacy review and covered by retention |
| ✅ Fixed R6 | No regression test for the user-deletion path | `tests/` | **B4** is a P0 defect in a path with no test. Also uncovered: the `IndexError` in **B3** |
| ✅ Fixed R7 | Frontend has no coverage reporting | CI | **Closed 2026-08-04.** `npm run test:coverage` runs `node --test --experimental-test-coverage` with an lcov reporter, and `sonar.javascript.lcov.reportPaths` now feeds it to SonarQube — the missing input behind the 36.3% whole-repository figure. Measured **91.12% lines / 83.25% branches / 94.74% functions** across 10 source modules. Made a real gate, not just a report: thresholds of 85/80/85 mirroring the backend's `--cov-fail-under`, verified by exit code (exit 1 at a 99% threshold, exit 0 at 85%). CI uploads the report and the SonarQube job now depends on the frontend job so the artifact exists |
| 🟡 Improved R8 | Weakest-covered backend modules | coverage run | `services/embedder.py` 63.16%, `services/observability.py` 63.64%, `services/cleanup.py` 66.67%, `services/catalog.py` 73.68%, `workers/ingestion_worker.py` 80.11%, `services/ingestion.py` 78.18%. The worker and ingestion service are the two least-covered *and* the hardest to debug in production |
| ❌ Open R9 | Nested interactive controls in the archive grid | `src/pages/Archive.jsx:53-79` | A `GlassCard` with `role="button"` and `tabIndex={0}` contains a real `<button>` for delete. Screen readers announce a button inside a button; the inner control is hard to reach predictably. Restructure so the card is a link/heading and the delete button is a sibling |
| ❌ Monitor R10 | `chunk_size_tokens` measured with a proxy tokenizer | `services/chunker.py:1-9` | Correct and honestly documented, but if Google ever publishes a Gemini tokenizer this should be revisited under a new `chunking_version` |

### 2.3 Security gaps

These are policy gaps rather than code bugs, but they gate public exposure.

| Status & # | Gap | Where | Priority |
|---|---|---|---|
| ✅ Fixed S1 | **No institutional email domain enforcement.** `handle_new_user` sets department `CCSICT` and status `approved` for any email address whatsoever. `@isu.edu.ph` appears only as UI placeholder text; `src/pages/auth/authUtils.js` accepts any valid address | `supabase_setup.sql:43-65` | **P0** |
| ✅ Fixed S2 | Guest chat has no global spend ceiling. Per-guest (30/min) and per-IP (300/min) limits exist, and Turnstile is available but off by default. Nothing caps *total* daily guest token spend | `config.py:40-41, 73` | P1 |
| ❌ Open S3 | Transitive Python dependencies are not hash-locked and base images are pinned by tag, not digest. No SBOM, no image signing | `requirements.txt`, `Dockerfile` | P1 |
| ❌ Open S4 | Secrets are loaded from `.env` files on the host; rotation is documented but manual | `docs/SECRET_ROTATION.md` | P1 |
| ❌ Open S5 | No independent penetration test has been performed | — | P1 |
| ❌ Open S6 | Data Privacy Act operationalization incomplete: NPC registration not addressed, no user-facing privacy notice page, retention enforcement intentionally disabled pending approval | `config.py:63`, governance protocol | **P0 (legal)** |

### 2.4 Documentation defects

| Status & # | Defect | Where |
|---|---|---|
| ✅ Fixed D1 | **Broken authoritative reference.** The ISO evidence file names `ISU_ECHAGUE_PRODUCTION_ROADMAP.md` as "the authoritative ledger for release gates and current status." That file does not exist in the working tree and is listed in `.gitignore:15`. Anyone reading the evidence — including a panelist — is pointed at nothing | `rag-thesis-backend/evaluation/iso25010_evidence.md:3` |
| ✅ Fixed D2 | **README role table omits `superadmin`**, a role that exists throughout the code, the RLS policies, the `RoleUpdate` pattern, and the frontend | `README.md:96-101` |
| ✅ Fixed D3 | **Evaluation fingerprint drift.** The retained Objective 2 smoke artifact records `generation_contract.max_output_tokens: 500`; `config.py:24` now specifies `700`. The artifact no longer describes the current build and must not be presented as characterizing it | `evaluation/results/comparison_20260728_140718.json` vs `config.py:24` |
| ✅ Fixed D4 | The ISO evidence file's "Current local revalidation" section reports 342 tests at 83.29% coverage against a `--cov-fail-under=83.18` gate. Today's measured state is **539 passed, 3 skipped, 91.28%** against an 85% gate (430/90.87% when this report was written). The snapshot is correctly labelled as dated, but it is now three iterations stale and should be regenerated before the defense | `evaluation/iso25010_evidence.md:15` |
| ✅ Fixed D5 | The ISO evidence still records the React Router npm-audit finding as "Blocked upstream." `npm audit --omit=dev` today reports **0 vulnerabilities** — the gate is closed and should be marked as such | `evaluation/iso25010_evidence.md:24` |
| ✅ Fixed D6 | Commands in the evidence file reference `.venv312`, while CI and the container target Python 3.14.6 and the working venv is `.venv3146` | `evaluation/iso25010_evidence.md:73-85` |

**S2 — closed 2026-08-04.** `services/guest_budget.py` counts tokens against a
UTC-day key in the same `limits` storage that already backs rate limiting, so
replicas share one budget instead of each enforcing its own. Three design points
worth recording:

- **The charge is an upper bound, booked before generation.** Measured prompt
  input (via the documented `cl100k_base` proxy) plus `gemini_max_output_tokens`.
  A ceiling that bills after the fact cannot refuse the request that breaches it.
- **Enforced twice.** A read-only `is_exhausted()` check runs before the first
  paid call, so an out-of-allowance guest never reaches the follow-up rewrite or
  the retrieval embedding; the charge itself lands immediately before generation,
  when the real context size is known.
- **Fails open, and cannot lock out tomorrow.** An unreachable counter logs and
  allows — the per-guest and per-IP limits still apply — and refused attempts,
  which do still increment, expire with the day's key.

Default 0 = unlimited, so development, the test suite, and the frozen evaluation
pipeline are unchanged; `validate_production_services` refuses to start a
production deployment without a real number, matching the existing
Redis/MFA/ClamAV pattern. The notice invites the user to sign in rather than
reusing the capacity apology. 17 regression tests in `tests/test_guest_budget.py`.

### 2.5 Reported but not reproducible here

Listed for completeness and explicitly **not** asserted as defects.

- **SonarQube gate quality.** The retained export records `ignoredConditions: true`, 25% new-code coverage against an 80% threshold, and 280 legacy code smells. No SonarQube server was available today, so this could not be re-measured. Treat the July 2026-07-20 figures as the current best evidence and re-run before the defense.
- **`pip-audit`.** `pip check` passed today ("No broken requirements found"), but `pip-audit -r requirements.txt` did not complete within the audit window — it requires network access to the advisory database. Re-run before release. The last dated result was clean.
- **JMeter performance.** Not re-run today. The retained figures measured non-`/chat` endpoints; see §4.7.
- **Live Supabase and Gemini behaviour.** Three integration tests are skipped by design (two disposable-Supabase, one ClamAV/EICAR). They remain deployment-time evidence gates.

---

### 2.6 Newly discovered during remediation ✅ (not in the original report)

Found by audits run while fixing §2.1 — a reproduction matrix for the refusal guard, a
percentage-rendering trace, an AST sweep of every async function, and a deprecation
sweep at import time. N12–N14 came out of the 2026-08-04 batch: an async-state parity
audit of the admin surfaces, and one defect found by making it. All fourteen are fixed
and covered by regression tests.

| Status & # | Defect | Where | Why it mattered |
|---|---|---|---|
| ✅ N1 | **Legitimate research questions were refused.** `prohibited_reason` required only that a generation verb *and* a prohibited artifact appear somewhere in the same string, with no relationship between them. "What conclusion did the authors make about accuracy?", "What methodology did they use to create the attendance monitoring system?", "Which theses make use of a conceptual framework?" and "Which studies produce a hypothesis about student performance?" were all blocked | `services/guards.py:42` | The single most user-visible functional defect found: these are exactly the queries the archive exists to answer, and the user got the "I cannot write thesis chapters" refusal. Rewritten so the verb must *govern* the artifact and the request must be addressed to the assistant. Verified on a 47-case matrix (25 must-block, 22 must-allow, 0 failures), with no ReDoS (sub-millisecond on six pathological 4,000-character inputs) and **0 classification changes across all 43 evaluation questions** |
| ✅ N2 | **Sub-1% duplication coverage displayed 100× too high.** `normalizePercent` treats any value in (0, 1] as a legacy ratio, but the backend already stores `matched_chunk_percentage` as a percentage. One matching chunk in a 300-chunk manuscript is 0.33% coverage and rendered as **33.00%** | `src/lib/utils.js:41` | Contradicted the "Review suggested" verdict shown beside it and overstated overlap by two orders of magnitude — including in the **downloadable JSON scan report** a faculty member would file as evidence. Coverage is now derived from the chunk counts, which are unambiguous; records too old to carry counts still fall back, so legacy archive rows are unaffected |
| ✅ N3 | **Students and faculty were bounced off permission-gated routes.** `AuthContext` fired the permission fetch without awaiting it and cleared `loading` immediately, so the first render saw `features === null` and every `can*` flag was `false` | `AuthContext.jsx:83` + `ProtectedRoute.jsx:88` | Deterministic on any hard refresh or deep link to `/chat`, `/archive`, `/novelty` or `/upload`. Invisible to E2E because the test fixture supplies `features` synchronously. Permissions now resolve before `loading` clears, and `canUseFeature` was extracted to a tested `src/lib/permissions.js` that falls back to the server's own defaults if the fetch fails |
| ✅ N4 | **A transient database blip demoted an admin for 60 seconds.** `get_user_role` caught any exception, fell back to `student`, and then **cached that fallback** for the full TTL | `dependencies/auth.py:38-41` | One flaky read during an admin's request meant every subsequent admin call 403'd for a minute with no way to clear it. The fallback is no longer cached |
| ✅ N5 | **`GET /departments/` was unauthenticated, unlimited, and used `select('*')`**, and `departments.py` repeated B18's unguarded `.data[0]` in both create and update | `routers/departments.py:18, 38, 77` | B19 catalogued the analytics and catalog endpoints but missed this one; B18 catalogued `catalog.py` but missed the identical pattern here. Both closed alongside their catalogued twins |
| ✅ N6 | **Digit-substring transient detection.** `_TRANSIENT_MARKERS` contained the bare strings `'429'`, `'502'`, `'503'`, `'504'`, so any error whose message merely *contained* those digits was classified retryable | `services/network_retry.py:26-30` | A permanent ingestion failure reading "Chunk 429 exceeds the 800-token limit" burned all three attempts and the retry delays. Now matched as a labelled status or a status attribute; verified on 15 cases (9 must-retry, 6 must-not) |
| ✅ N7 | **The query-time duplication alert was silently dropped** whenever retrieval returned no context: the no-result return passed `duplication_alert`, which is only built after generation, so it was always `None` | `routers/chat.py:821` | A flagged ≥85% match never reached the user on that path. Reachable when the matched paper's metadata row disappears mid-query |
| ✅ N8 | **The upload stepper rendered inert during staging.** The backend reports a `store` stage that is not one of the seven worker stages, so `findIndex` returned `-1` and no step showed as active while the progress bar already moved | `src/pages/Upload.jsx:207` | Cosmetic but confusing at exactly the moment a user is watching. `store` is now aliased to the first worker stage and the pre-worker statuses count as in-flight |
| ✅ N9 | **`config.py` used a class-based Pydantic `Config`**, deprecated in Pydantic V2 and **removed in V3.0**, emitting `PydanticDeprecatedSince20` on every single import | `config.py:7` | The same defect class as B6 (deprecated API scheduled for removal) in a place the audit did not look. Migrated to `SettingsConfigDict` and proven value-for-value identical across all 62 resolved settings, with the frozen RAG contract asserted exact |
| ✅ N10 | **Two blocking Supabase round trips on every chat request**, in the file B1 cites as the correct example | `routers/chat.py:594, 628` | Found by the AST sweep, not by reading. See the B1 note |
| ✅ N11 | **A PDF file handle leaked** whenever `get_text()` raised during metadata extraction — the original `doc.close()` was unreachable on that path | `routers/upload.py:484-492` | Fixed incidentally by extracting `_title_page_texts()` with `try/finally` while making the handler non-blocking |
| ✅ N12 | **The lint gate could not see a missing component import.** Core `no-undef` does not inspect JSX element names, and `react/jsx-no-undef` was not enabled — only `react/jsx-uses-vars` was. A component used as `<Missing />` without an import passes ESLint *and* the production build, then throws a `ReferenceError` at runtime | `eslint.config.js:30-32` | Found by making the mistake: the retry button added to `AdminOverview.jsx` used `Button` without importing it, and ESLint reported nothing. The whole admin error banner would have crashed the page at exactly the moment it was needed — when data had already failed to load. Rule enabled, verified against a planted `<TotallyMissingComponent />` (exit 1), and the existing codebase is clean under it |
| ✅ N13 | **A failed retention fetch was rendered as three measured zeros.** `OperationsTab` deliberately excludes the retention query from its page-level loading and error gates, then read `report.upload_job_events ?? 0` — so an unreachable endpoint displayed "Eligible job events: 0" | `src/pages/admin/OperationsTab.jsx:115` | The same defect class the sibling `AdminOverview` banner explicitly promises against: *"No missing values are being treated as measured zeros."* This one was. A superadmin could conclude retention had nothing to collect when the report had simply failed. Now states that the counts are unavailable, with a retry |
| ✅ N14 | **Latent role collision in the chat message list.** `setMessages` spread the API response *after* setting `kind: 'ai'`, so any response field named `kind` would silently overwrite the list's own `'user' \| 'ai'` role and break every render that branches on it | `src/pages/Chat.jsx:603` | Harmless until B14 introduced a `kind` concept to the API in the same request cycle — exactly the kind of near-miss that becomes a bug one commit later. Spread order inverted so the local role always wins |

## 3. UI/UX excellence programme

The goal is a product that a panelist, a librarian, and a first-year student all find obviously excellent. The system already has an unusually strong foundation — a real Material 3 token system, four theme states, palette variants, high-contrast, reduced-motion and low-effects modes, glass surfaces, a command palette, and progressive 3D. What it lacks is **enforcement**: the tokens permit inaccessible combinations, and nothing stops a new component from reintroducing them.

### 3.1 Fix contrast at the token layer, not per component — P0 · M · Phase A

46 of 55 blocking findings are contrast. Patching individual components would be the wrong fix; three token-level patterns produce nearly all of them.

**Pattern 1 — `opacity-*` used for de-emphasis on text.** `opacity-45`, `opacity-50`, `opacity-55`, `opacity-60`, and `opacity-65` appear on body text, labels, and metadata throughout the app (`Chat.jsx`, `Archive.jsx`, `Dashboard.jsx`, the admin tabs, the landing sections). Opacity blends the foreground toward whatever is behind it, so the effective contrast is unknowable at authoring time and varies by surface. Measured results include 2.85:1, 2.99:1, 3.74:1, and 4.29:1 — all below AA.

> **Fix:** introduce explicit semantic text-colour tokens — `--text-primary`, `--text-secondary`, `--text-tertiary` — with values chosen and *verified* to clear 4.5:1 against `--surface-0` through `--surface-3` in all four theme states. Then replace `opacity-*` on text with `text-secondary` / `text-tertiary` utilities. Reserve `opacity-*` for non-text decoration. This is a large but purely mechanical sweep and it eliminates the whole class permanently.

**Pattern 2 — `text-gold-500` on light surfaces.** `--color-gold-500: #d97706` (`index.css:30`) on `#fbfdf7` is **3.10:1**. Gold is the ISU accent and it is used for emphasis, which makes this the highest-visibility failure.

> **Fix:** add a dedicated `--color-gold-on-light` at roughly `#8a5a06` for text use (≥ 4.5:1 on all light surfaces) and keep `gold-400`/`gold-500` for fills, borders, and icons where the 3:1 non-text threshold applies. The existing `[data-palette="gold"]` block already uses `#735c00` for exactly this reason — extend that thinking to the default palette.

**Pattern 3 — tinted badges.** `text-flame-600` (`#d22630`) on `bg-flame-500/12` (`#f3e0dc`) is **4.06:1**, and the same construction is used for the forest and gold badge tones. The 12% tint lightens the background just enough to break AA.

> **Fix:** define per-tone `{background, foreground}` badge pairs as tokens with verified ratios, rather than composing an arbitrary `/12` tint with a same-family text colour.

**Pattern 4 — sub-11px type.** `text-[0.62rem]` (7.4 pt), `text-[0.65rem]`, and `text-[0.68rem]` are used for labels and metadata. At that size, AA requires 4.5:1 and legibility argues for more.

> **Fix:** set a **12 px (0.75 rem) minimum** for any text conveying information; keep smaller sizes only for decorative or duplicated content that also appears at a legible size.

### 3.2 Make the accessibility gate deterministic, then wire it into CI — P1 · S · Phase A

Fix **B7** first so the numbers mean something. Then add the matrix to `.github/workflows/quality.yml` as a required check with a zero serious/critical budget, and keep moderate/minor findings in the report as a backlog. Also add a **unit-level contrast test** next to `src/design/materialTheme.test.js` that asserts every semantic foreground/background token pair clears 4.5:1 (3:1 for large text) in all four theme states — that catches regressions in milliseconds instead of minutes and prevents the class from returning.

### 3.3 Make high-contrast mode genuinely stronger — P1 · S · Phase A

Today `html[data-contrast="high"]` only raises `--glass-opacity` and thickens focus outlines (`index.css:128-135`). It does not change any text colour — which is why `light-high-contrast` still produced 23 findings on admin-overview, in one case *worse* than standard. A user who explicitly asks for high contrast and receives a still-failing surface is worse served than one who never asked.

> **Fix:** give the high-contrast state its own token overrides — near-black on near-white text, 7:1 targets for body text, solid rather than translucent surfaces, and stronger borders. `applyMaterialTheme(root, { highContrast })` (`PreferencesContext.jsx:67-71`) is already the single seam for this.

### 3.4 Semantics and keyboard paths — P1 · M · Phase A

- `src/pages/Admin.jsx:27` — add `role="status"` to the loading wrapper (fixes 7 findings and improves screen-reader announcement).
- Admin operations and upload-history table wrappers — add `tabIndex={0}` and an accessible name so keyboard users can scroll them.
- Fix the 25 `heading-order` findings on landing, dashboard, archive, guest-chat, and upload-history: one `h1` per view, no skipped levels.
- Restructure the archive card so it is not a `role="button"` containing a `<button>` (**R9**).
- Audit focus management on every modal, sheet, and dialog: focus moves in on open, is trapped, and returns to the trigger on close.
- Verify every interactive element reaches a 24×24 CSS-pixel target (WCAG 2.2 SC 2.5.8) — several `icon-sm` buttons and the `p-1.5` icon buttons in the chat session list are close to the limit.

### 3.5 Experience enhancements

| Item | Detail | Priority | Effort | Phase |
|---|---|---|---|---|
| **Streaming chat responses** | Token streaming via FastAPI `StreamingResponse` and SSE. The single biggest perceived-performance win: today a student stares at a typing indicator for the full 2–10 s generation. Keep the non-streaming path intact for the frozen evaluation harness | P1 | M | **B** |
| **Answer feedback** | Thumbs up/down plus an optional reason on every answer, written to a `chat_feedback` table. This is the cheapest source of real retrieval-quality ground truth and directly feeds the tuning in §7.1. Verified absent today | P1 | S–M | B |
| **Exportable cited answers** | "Export answer" producing a print-ready view or PDF with the citation list. Directly serves the RRL-writing workflow the paper is built around. Metadata and answer only — never manuscript text | P2 | S | B |
| **Thesis detail route** | `/thesis/:id` as a metadata-only page instead of the current modal, giving citable, shareable, bookmarkable URLs while preserving indirect access | P2 | S | B |
| **Email notifications** | Approval/rejection and upload-complete mail through Supabase Auth SMTP. Today a pending faculty member must keep re-opening the app to discover they were approved | P1 | S | B |
| **Bulk upload** | Multi-file queue UI over the existing durable job API — the backend already handles queued jobs safely. Digitizing 50 theses one file at a time is the current reality | P2 | M | B |
| **Onboarding** | A short first-run walkthrough of chat, citations, the duplication alert, and the novelty scanner. Adoption is the difference between a thesis artifact and a used system | P3 | S | B |
| **Empty, error, and loading states** ✅ | **Closed 2026-08-04.** Audited every async surface. Novelty was already at parity with chat and archive; the admin tabs were not. `SystemManagementTab`'s five queries (features, departments, users, logs, papers) and `UploadHistoryTab`'s listing destructured `isLoading` only — **no error state at all** — so a failed fetch rendered as "No users found." / "No papers found.", indistinguishable from a genuinely empty result and with nothing to retry. Fixed with one shared `TableStateRow` component (error outranks empty, since a failed fetch usually also looks empty) rather than seven ad-hoc copies, plus an inline treatment for the logs pane, which is not a table. Also: a retry affordance on the `AdminOverview` banner that refetches only what failed, an empty state for the durable-jobs table, and **N13** | P2 | S | A |
| **Filipino localization** | An i18n scaffold plus Filipino strings. Matters for university-wide adoption beyond CCSICT | P3 | M | C |
| **Command palette discoverability** | The palette exists (`CommandPalette.jsx`) but nothing advertises it. Add a visible hint and keyboard-shortcut help | P3 | S | B |

### 3.6 Frontend performance — P1 · M · Phase A

The production build is clean (3,855 modules, sub-second) but the chunk profile has two outliers:

| Chunk | Raw | Gzipped |
|---|---|---|
| `useSceneRuntime-*.js` (three.js + fiber + drei) | **890.65 kB** | **237.28 kB** |
| `AdminOverview-*.js` (Recharts) | 381.91 kB | 109.29 kB |

The 3D scenes are decorative — `Hero.jsx` and `Login.jsx` already switch them off under reduced-motion or low-effects. On a campus 3G connection 237 kB gzipped of decorative WebGL is a multi-second penalty before first meaningful paint.

> **Fix:** load the 3D bundle only after first paint *and* only when the device passes a capability check (not coarse-pointer, not `prefers-reduced-motion`, not `saveData`, sufficient `deviceMemory`), with a static hero image as the default. Import Recharts components individually or swap to a lighter charting library for the admin dashboard. Add a bundle-size budget to CI so this cannot regress silently.

---

## 4. Reliability and scalability

### 4.1 Multi-process API with externalized state — P0 · M · Phase B
The container runs a single uvicorn process with no `--workers`. Combined with **B1** and **B10**, one slow request degrades everyone. Run at least two workers or replicas, move the capacity breaker and Turnstile cache to Redis first (**B10**), and set `--limit-concurrency` plus a request timeout aligned with the 25-second Gemini budget.

### 4.2 Fix the event-loop blocking first — P0 · M · Phase A
**B1** must be resolved before adding replicas; otherwise each replica simply has its own freeze window.

### 4.3 Server-side pagination, search, and filtering — P1 · M · Phase B
Add `limit`/`offset` (or keyset) plus `q`, `program_id`, `specialization_id`, and `year` parameters to `routers/papers.py`, backed by a `tsvector` GIN index over title, authors, and abstract — metadata search only, since full text stays indirect. Wire `src/pages/archive/useArchiveCatalog.js` to server queries with a React Query infinite query. Apply the cheap **B9** fix immediately in Phase A.

### 4.4 pgvector index tuning — P2 · S · Phase B
An HNSW cosine index exists with default build and search parameters. Past a few hundred papers, benchmark `hnsw.ef_search` for the recall/latency trade-off, record the chosen value in the release fingerprint, and add index health (size, dead tuples) to the operations summary. No change before the defense.

### 4.5 Batch the duplication screening RPCs — P1 · M · Phase B
See **B8**. Keep the mathematics identical so the 85% contract and the evaluation evidence are unaffected.

### 4.6 Gemini paid tier, quotas, and graceful degradation — P0 · S–M · Phase B
The free tier already required a capacity circuit breaker, and the governance protocol spends considerable effort mitigating the free tier's data-use terms. For any real user base, move to the paid tier: it removes the training-data concern and raises limits. Add per-role daily token budgets in configuration and extend the existing cooldown into a tiered degradation path (queue → shorter answers via `gemini_max_output_tokens` → the existing explicit capacity message). Track spend using the token counts LangSmith already captures.

### 4.7 Load-test the real RAG chat path — P0 · M · Phase A (rig) / B (with corpus)
Every performance number on record — 900/900 requests, p95 204 ms — came from `/health`, `/upload/tracks`, and `/analytics/summary`. `/chat` has never been load-tested, and the live Gemini smoke was three single-user calls against an empty corpus. A `chat_load.jmx` rig exists but has no measured run. Run 5/10/20 concurrent guest questions against a disposable project with a seeded synthetic corpus; measure p95/p99 end to end and the 429 envelope; summarize with `evaluation/summarize_jmeter.py`. **Run it after fixing B1** — otherwise it will measure the bug rather than the architecture. Re-run against the production corpus before the formal ISO evaluation so the Performance Efficiency claim actually covers the core feature.

### 4.8 Worker fleet scale-out — P2 · S · Phase B
The leased queue already supports N workers safely (PostgreSQL leases, heartbeats, idempotent commit), but compose runs exactly one and no document states the scaling contract. Test and document two-worker operation, with `operations_queue_depth_threshold` tuned for the fleet size. Fix **B15** first.

### 4.9 Service level objectives — P1 · S · Phase B
Define and publish three SLOs — chat availability, chat p95 latency, ingestion completion time — measured from the metrics in §5.1. SLOs are the internal target; a contractual SLA belongs in Phase C after two quarters of data.

---

## 5. Observability

### 5.1 Metrics, dashboards, and paging — P1 · M · Phase B
`services/operations.py` already computes queue depth, worker staleness, retry counts, and cleanup lag, and LangSmith captures per-stage latency — but all of it is visible only inside a superadmin tab and optional HMAC webhooks. There is no `/metrics`, no dashboard, and no on-call notification. Expose Prometheus metrics from both the API and the worker (request counts and latency histograms, queue gauges, Gemini error and cooldown counters, ingestion stage durations); add Grafana and Alertmanager to `docker-compose.operations.yml`; route the existing webhook alerts to email or Slack. Keep the privacy posture: metrics are numeric only, never content.

### 5.2 Log aggregation — P2 · S–M · Phase B
Logs are privacy-filtered (`services/safe_logging.py`) but land only in container stdout. Ship them to a store with retention and add a log-based alert for error bursts. The existing `PrivacyFilter` makes this safe.

### 5.3 Uptime and certificate monitoring — P1 · S · Phase A
External synthetic checks against `/health`, `/ready`, `/health/worker`, and the public frontend, plus TLS expiry monitoring. Free tiers are sufficient and this can be live before the defense demo.

### 5.4 Decide the tracing end state — P2 · S · Phase B
LangSmith tracing is implemented privacy-safely but is off by default and the free tier has retention limits. Either budget LangSmith for production volumes or migrate the `safe_trace()` wrapper (`services/observability.py`) to OpenTelemetry GenAI semantic conventions. The wrapper is the single seam, so the swap is contained.

---

## 6. Security and compliance

### 6.1 Enforce the institutional email domain — P0 · S · Phase A
See **S1**. Enforce server-side in `handle_new_user()` (`supabase_setup.sql:43-65`): reject non-`@isu.edu.ph` signups, or admit them as `pending` for manual approval. Guest mode already covers legitimate outsiders. Mirror the rule client-side with a friendly message, and keep a superadmin path for panelists and librarians without ISU addresses. *(This was deliberately deferred in July; it is restated because it remains the single largest gap between the current build and a public university service.)*

### 6.2 Guest-chat spend ceiling — ✅ **DONE** · P1 · S · Phase A
Turnstile is implemented and config-gated (`services/turnstile.py`) — enable it in production with `TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY`. ~~Add the missing piece: a global daily guest token budget in Redis, so a determined script cannot exhaust the quota even with valid challenges.~~ **Closed 2026-08-04** — see **S2** in §2.3. It reuses the `limits` storage that already backs rate limiting, so it inherits Redis in production without waiting on **B10**. Moving the verified-guest cache to Redis remains part of B10 (Phase B).

### 6.3 Supply-chain hardening — P1 · M · Phase A
Generate `requirements.lock` with `pip-compile --generate-hashes` and install with `--require-hashes`; pin `FROM` images by digest; add SBOM generation (syft) and image signing (cosign) to the container jobs; enable security-only Dependabot PRs. CI already runs pip-audit, `npm audit`, Trivy, and Gitleaks, so this closes the remaining reproducibility gap.

### 6.4 Secrets management — P1 · S–M · Phase B
Move from `.env` files to the hosting platform's secret store or Docker `secrets:`. Scope a separate service-role key per process where Supabase allows. Record rotation events in the existing `security_audit_events` table.

### 6.5 Edge protection — P1 · S · Phase B
In front of the tunnel, add Cloudflare WAF managed rules and rate rules, bot-fight mode on the API hostname, and country/ASN throttles if abuse appears. Validate headers post-deploy with the existing `npm run security:headers`.

### 6.6 Independent security assessment — P1 · M · Phase B
Before opening to the whole university, commission at least one manual penetration test focused on: IDOR against session, scan, and job resources; prompt injection reaching citation integrity; storage-policy bypass attempts; and MFA/AAL2 downgrade paths. The self-assessment posture is strong; an external pass is the production bar.

### 6.7 Data Privacy Act operationalization — P0 (legal) · M · Phase A→B
Complete the four PI-08 approval gates, then: register the processing system with the National Privacy Commission if ISU's context requires it; publish a user-facing privacy notice in the frontend; wire the breach-notification path (72-hour NPC rule) into the incident playbook; and activate retention (`RETENTION_ENFORCEMENT_ENABLED=true`) once the policy is signed. Include `scan_history.matched_chunks` (**R5**) in the retention scope.

---

## 7. RAG quality — all Phase B

Every item here changes the evaluated pipeline and is therefore explicitly **after** the defense baseline is locked.

### 7.1 Hybrid retrieval and reranking — P1 · L · Phase B
Retrieval is pure cosine, top-5, threshold 0.30, with no lexical channel and no reranker. Acronyms, author names, exact course codes, and Filipino-language terms are precisely where dense retrieval is weakest — the paper's own literature review cites Arivazhagan et al. (2023) on this. Add a `tsvector` lexical channel alongside `match_chunks`, fuse with Reciprocal Rank Fusion, then rerank the top ~20 with a listwise pass using the existing verdict model. Version it through `paper_index_versions` and the release fingerprint so the evaluated and enhanced pipelines stay distinguishable — that provenance machinery already exists.

### 7.2 Semantic response cache — P2 · M · Phase B
No response caching exists; every question pays embedding, retrieval, and generation. Student query distributions are heavily repetitive around title-defense season. Cache in Redis keyed by (normalized question embedding above ~0.97 similarity, department, index fingerprint) with a TTL of hours, invalidated on `activate_paper_index`. Cache only grounded answers with their citation sets; never cache duplication alerts.

### 7.3 Citation entailment sampling — P1 · M · Phase B
Citation validation is structural, not semantic — honestly documented in `services/citations.py:90-91`. Background-sample a percentage of answers and have the verdict model judge "is claim X supported by cited chunk Y?", logging an entailment score. This converts a documented limitation into a monitored quality signal and gives faculty an audit trail, without changing the response path.

### 7.4 Retrieval drift monitoring — P2 · S · Phase B
`_top_similarity` is already computed in `routers/chat.py:786`. Log it and the no-result rate as numeric-only metrics, and alert when either shifts materially after an ingestion — an early warning for corpus or index problems.

### 7.5 Answer quality feedback loop — P1 · S–M · Phase B
See §3.5. Feedback data is the input that makes §7.1 tunable rather than guessed.

### 7.6 Embedding and model upgrade policy — P2 · S · Phase B/C
The provenance system (`paper_index_versions`, fingerprint checks, staged activation and rollback) already makes re-embedding safe. What is missing is cadence and criteria. Write a one-page policy: on a deprecation announcement, run a staged re-index in a disposable project, compare a Ragas mini-suite old versus new, then promote. No new code required.

---

## 8. Data lifecycle and disaster recovery

### 8.1 Scheduled backups with measured RTO/RPO — P1 · S · Phase A
`scripts/backup_system.ps1`, `scripts/scheduled_backup.ps1`, `scripts/register_backup_task.ps1`, and `scripts/check_backup_freshness.ps1` all exist and are documented in the operations runbook. What remains is operational: create the passphrase file, register the nightly task on the backup machine, alert on staleness through §5.1, and run the restore drill quarterly — recording measured RTO and RPO against declared targets (24 h RPO / 4 h RTO is a reasonable pilot commitment).

### 8.2 Supabase PITR and storage growth — P2 · S · Phase B/C
On a paid Supabase tier, enable point-in-time recovery to tighten RPO to minutes, and add storage-growth metrics (papers × chunks × vectors) to the operations summary so capacity is planned rather than discovered.

### 8.3 Retention activation — P1 (after approval) · S · Phase B
Dry-run tooling and the retention matrix are complete; enforcement is correctly blocked on institutional approval. Once approved, enable it, schedule `apply_operations_retention`, and produce a monthly "retention applied" report for the compliance file.

---

## 9. Engineering process and quality

### 9.1 Close the coverage and static-analysis gaps — P1 · M · Phase A
Backend coverage is a strong 91.28%, but the least-covered modules are still the hardest to debug in production (**R8**): `services/embedder.py` 63.16%, `services/observability.py` 63.64%, `services/cleanup.py` 66.67%, `services/catalog.py` 73.68%, `services/ingestion.py` 78.18% and `workers/ingestion_worker.py` 80.11% (up from 77.07% via the B15 concurrency tests). Add tests for the worker's cancellation, lease-loss, and retry paths, and for the **B3** and **B4** failure modes. Add frontend coverage reporting (**R7**) so the 36.3% whole-repository figure stops hiding the frontend. Then burn down the 280 legacy SonarQube smells in small batches and re-run Sonar **without** ignored conditions so the Reliability evidence is unqualified.

### 9.2 Staging environment and safe deploys — P1 · M · Phase B
Validation currently uses disposable Supabase projects, which is good, but there is no persistent staging and deploys are compose restarts. Stand up a permanent staging stack receiving every merge to `main`; promote a tested image digest to production. With two or more replicas (§4.1), rolling restarts give zero-downtime deploys, and rollback is redeploying the previous digest — `scripts/release_fingerprint.py` already identifies builds.

### 9.3 Tighten the CI contract — P2 · S · Phase A
The OpenAPI drift gate is live and enforced by `tests/test_export_openapi.py`. Still open: enable GitHub branch protection requiring the quality workflow; add the accessibility matrix as a required check once **B7** makes it deterministic; add the chat load profile as a weekly scheduled workflow rather than per-push; and add a bundle-size budget (§3.6).

### 9.4 Release evidence automation — P3 · S · Phase B
A small script that assembles the release evidence bundle — fingerprint, coverage, Sonar export, JMeter summaries, axe report, corpus receipt — into one dated folder. Today this is assembled by hand across `docs/evidence/` and `evaluation/results/`.

---

## 10. University scale — Phase C

1. **Single sign-on.** OIDC/SAML against ISU's identity provider through Supabase Auth external providers; map role and department claims into the existing `profiles` model; keep local accounts as a migration fallback. *(P1 within Phase C, L)*
2. **Multi-department activation.** The normalized catalog already models departments → programs → specializations. What is missing is the runbook: seed the department, assign delegated admins, set per-department feature flags and quotas, and run the RLS and scoping tests per department. *(P1, M)*
3. **Delegated administration and quotas.** A per-department admin role scoped by the existing department boundary checks, with per-department Gemini token budgets in Redis. *(P2, M)*
4. **Paid managed platform.** Supabase Pro (PITR, support), managed Redis, and container hosting with autoscaling and multi-replica HA — replacing the school-PC-and-tunnel topology without changing any contract. *(P1, L)*
5. **Formal SLA and status page.** Contract an SLA only after two quarters of SLO data (§4.9). *(P2, S)*
6. **Cost model.** A maintained sheet covering Gemini paid-tier cost per thousand queries (derived from LangSmith token telemetry), Supabase tier, hosting, Redis, and ClamAV. Review quarterly. *(P1, S)*

---

## 11. Already production-grade — preserve, do not rebuild

These subsystems were examined closely during this audit and are genuinely strong. Future work should extend them, not replace them.

- **Durable leased ingestion.** A PostgreSQL job queue with leases, heartbeats, idempotency keys, cooperative cancellation, bounded retries with `Retry-After`, an atomic commit RPC, and — notably — correct recovery when the commit response is lost after PostgreSQL has already committed (`services/ingestion.py:201-226`). This is better than most production systems.
- **Authorization posture.** RLS deny-by-default, column-level profile protection, service-role-only RPCs, server-owned department scoping that ignores client-supplied filters, MFA/AAL2 enforcement for privileged roles, and fail-closed pending/rejected gating.
- **Indirect-access enforcement.** A private bucket with a restrictive storage policy, metadata-only API responses (`public_source()`), and no full-text surface anywhere in the frontend. Verified end to end.
- **Index provenance.** `paper_index_versions` with fingerprint checks that block retrieval across incompatible embedding spaces, plus staged activation and rollback. This is the piece that makes a future embedding upgrade safe.
- **Privacy engineering.** PII redaction at ingestion with per-category statistics, privacy-filtered logging, hidden-payload LangSmith tracing with an exporter that raises if content leaks, and metadata-only duplication alerts.
- **The citation engine.** Stable chunk-level citation IDs, marker normalization, structural validation, one bounded AI repair attempt, deterministic coverage enforcement, cited-only source filtering — and an honest, documented statement of what it does *not* prove.
- **Evidence discipline.** Dated, hashed evidence bundles; a fail-closed evaluation harness that refuses to produce a formal result from placeholder data; release fingerprints; immutable corpus-manifest tooling.
- **Defensive retrieval behaviour.** Greeting and author-lookup fast paths that avoid Gemini entirely, a capacity circuit breaker, follow-up rewriting with grounded re-retrieval, and interception of model answers that self-report having no evidence.

---

## 12. Suggested sequencing

**Now → defense (Phase A — hardening only, no pipeline changes)**

✅ **Done and verified:** `B1` event-loop blocking · `B2`/§3.1–3.4 accessibility · `B3` scanner crash · `B4` user deletion · `B5` Gemini client bounds · `B6` lifespan migration · `B7` deterministic a11y gate · `B9` profile query (Phase A half) · `B11`–`B13` · `B14` (harmful half) · `B15`–`B19` · `S1` email domain · `R1`–`R3`, `R6` · `D1`–`D6` documentation · `N1`–`N11` newly discovered

❌ **Still to do before the defense demo:** §3.6 bundle size (the 890 kB three.js chunk) · §5.3 external uptime and TLS checks · §6.3 supply-chain hardening (hash-locked deps, digest-pinned images, SBOM) · §8.1 backup scheduling with a measured RTO/RPO · §9.1 frontend coverage reporting (`R7`) and the SonarQube re-run without ignored conditions · `R9` nested archive-card controls · the 25 advisory `heading-order` findings

🔓 **Now unblocked by `B1`:** §4.7 — load-test the real `/chat` path. This was explicitly gated on the event-loop fix so it would measure the architecture rather than the bug.

**Defense preparation**
Institutional approvals → lock the 50-thesis corpus → faculty-validated Golden Dataset → run the Ragas comparison with the Section 3.2.5 statistics → regenerate the ISO evidence from a locked release → apply the paper revisions in `PAPER_VS_SYSTEM_COMPARISON_2026-08-03.md` §11

**First post-defense quarter (Phase B)**
§4.1 multi-process API · §4.6 Gemini paid tier · §5.1 metrics and paging · §4.3 archive pagination · §7.1 hybrid retrieval and reranking · §3.5 streaming and feedback · §9.2 staging · §6.4–6.6 secrets, WAF, penetration test · §8.3 retention

**University scale (Phase C)**
§10 — SSO · multi-department activation · managed HA platform · SLA and status page · localization · cost governance
