# Codebase and security audit — 2026-09-12

Reviewed commit: `4847209`. Eleven defects were found and all eleven were fixed in the same pass; this report is the record of both.

This is a source review with local verification, not a certification and not a live penetration test. No live account, manuscript, database, storage object or deployment was touched. Application code *was* changed, unlike the 2026-09-05 review — that report recorded findings only, and eight of its twelve were still open here.

In source references, `backend/` means `rag-thesis-backend/` and `frontend/` means `rag-thesis-frontend/`.

**Scope and method**

Read: the API entrypoint and configuration; `dependencies/auth.py` and every guard it exports; all eleven routers; retrieval, prompting, citation and novelty logic; the durable ingestion worker and its job state machine; `supabase_setup.sql` and all 27 migrations, including every RPC body, grant and RLS policy; the container, compose and CI configuration and the nginx CSP; the frontend transport, auth context, route guarding, chat, both upload wizards and the admin surfaces; and `tests/conftest.py` with the largest test modules, looking for places where a mock makes a passing suite prove less than it appears to.

Two limitations worth stating plainly. First, the multi-agent orchestration normally used for a review this wide was unavailable for the whole session, so this is a single-pass review by one reader rather than independent finders with an adversarial verification stage; findings were re-derived from the code a second time, but they have not had a genuinely independent second opinion. Second, shell access was lost partway through, so the fixes were written and checked by reading, and the suites were executed by the maintainer afterwards. Their results are recorded under Verification below.

Severity reflects demonstrated behaviour and prerequisites, not a CVSS calculation.

## Findings

| ID | Severity | Finding | Prior ID | Status |
|---|---|---|---|---|
| A01 | High | Private query cache survives an account change | F01 | Fixed |
| A02 | High | Unauthenticated request bodies are written to disk before authentication | F02 | Fixed |
| A03 | High | The `chat` and `archive` feature toggles are not enforced by the API | F08 | Fixed |
| A04 | Medium | The novelty scan omits the page, encryption and malware checks ingestion applies | F05 | Fixed |
| A05 | Medium | Citation repair manufactures attribution across theses | F11 | Fixed |
| A06 | Medium | The guest token ceiling under-counts a turn's model calls | F09 | Fixed |
| A07 | Medium | A resumed batch upload leaks the previous account's manuscripts | — | Fixed |
| A08 | Low | CORS omits PATCH, which the catalog API serves | F12 | Fixed |
| A09 | Low | The prompt-edit path reads a transcript with no bound | — | Fixed |
| A10 | Low | Files past the batch cap are dropped silently | — | Fixed |
| A11 | Medium | The evaluation harness resumes a checkpoint under a changed configuration | F10 | Fixed |

---

### A01 — Private query cache survives an account change

Sources: `frontend/src/main.jsx:35,62`, `frontend/src/context/AuthContext.jsx`, `frontend/src/components/AppShell.jsx:155`, `frontend/src/components/IdleSessionGuard.jsx:88`.

One `QueryClient` is created above `AuthProvider`, so its cache is not tied to a session. Private query keys carry no account identifier: `['sessions']`, `['scan-history']`, `['users']`, `['papers']`, `['analytics-overview']`, `['features']`, `['operations-*']`. Defaults are `staleTime: 30_000` and `gcTime: 30 * 60_000`. Nothing in the codebase called `clear()` or `removeQueries()` — sign-out cleared the Supabase session and nothing else.

Sign-out is a client-side navigation, not a reload: `AppShell` calls `navigate('/')` and `IdleSessionGuard` calls `navigate(loginPath)`. So the cache survives it. A second reader signing in on the same tab was served the first reader's saved conversations, novelty reports and department user list directly from cache — with no request at all inside the 30-second staleness window, and as stale-while-revalidate for half an hour after.

This is F01 of the 2026-09-05 review, unfixed. Server-side ownership checks were never bypassed; the disclosure is entirely in the browser.

**Fix.** `AuthContext` now clears the whole cache on every identity change, before the new identity is published to any consumer, and again once `signOut()` has completed. `clear()` rather than per-key removal for two reasons: it cancels requests already in flight that would otherwise resolve into the new identity's cache, and it cannot be defeated by a future query key that nobody remembered to add to an allow-list. The first resolution of a fresh tab is exempt so the landing page's own prefetches are not cancelled.

### A02 — Unauthenticated request bodies are written to disk before authentication

Sources: `backend/main.py`, `backend/routers/upload.py:515`, and the installed `fastapi/routing.py:423,474` and `starlette/formparsers.py:230`.

FastAPI's request handler runs `body = await request.form()` at `routing.py:423` and only calls `solve_dependencies` at `:474`. Dependencies are where `require_upload_access` and `require_novelty_access` live, so authentication cannot be what refuses an oversized body — by the time it runs, the body is parsed. Starlette's `MultiPartParser` spools each file part into a `SpooledTemporaryFile(max_size=1MB)`, so every byte past the first megabyte of every part is written to the container's temporary disk.

Nothing bounded this. `_read_limited_upload` caps what the *handler* pulls into memory, which happens after the spool; there was no `Content-Length` check and no body-size middleware anywhere in the repository; and the only nginx configuration in the repo fronts the built frontend, not the API. An anonymous caller with no token could therefore POST a body of any size to `/upload/paper`, `/upload/batch`, `/upload/extract-metadata`, `/upload/batch/extract-metadata` or `/duplication/scan` and have all of it written to disk before receiving 401, with concurrent requests multiplying it.

This is the surviving half of F02. The earlier fix bounded memory; disk was left unbounded.

**Fix.** `backend/services/request_limits.py` adds `BodySizeLimitMiddleware`, a plain ASGI middleware — the only form that can see a request before its body is consumed and interpose on the receive channel. Two layers: a declared `Content-Length` over the ceiling is refused without reading a byte, and a wrapped receive channel stops a chunked body that declares nothing at the same ceiling. Batch endpoints get `max_batch_files × max_upload_mb` of allowance; everything else gets one manuscript's worth. The slack above each limit is deliberate, so a request merely over the per-file limit still reaches the handler and gets the precise 413 the clients and tests expect, and only a body far past any plausible submission is stopped at the edge. Registered inside CORS, so the 413 is readable by a browser rather than an opaque network failure.

### A03 — The `chat` and `archive` feature toggles are not enforced by the API

Sources: `backend/routers/settings.py:19-23`, `backend/routers/chat.py`, `backend/routers/papers.py`, `frontend/src/context/AuthContext.jsx`.

The role-feature matrix names four features. Only two had a server-side guard: `require_novelty_access` on `/duplication/*` and `require_upload_access` on `/upload/*`. `routers/chat.py` imported no feature guard and `routers/papers.py::list_papers` used plain `get_current_user`. Turning off `chat` or `archive` for a role changed `canChat` / `canArchive` in the React context and the routes they gate, and nothing else: any approved account could still call `POST /chat` and `GET /papers` directly. The superadmin screen presents all four as access controls, so two of them were telling the truth and two were decoration.

This is F08, unfixed.

**Fix.** `require_chat_access` and `require_archive_access` in `dependencies/auth.py`. Two deliberate asymmetries with the existing guards, both documented at the call site:

- Neither requires AAL2 for an administrator. The upload and novelty guards do, because they protect privileged operations; reading the archive and asking a research question are ordinary user features, and gating them on MFA would lock an administrator out of the library itself the moment `REQUIRE_PRIVILEGED_MFA` was enabled.
- When `system_settings` is unreachable, `get_role_features()` returns `{}` and the existing guards treat that as a refusal. That is right for `upload` and `novelty`, which default to False. It is wrong for `chat` and `archive`, which default to True for both non-privileged roles: refusing on a transient read failure would take the library offline for every student and faculty member, which is worse than a toggle going briefly unenforced. Those two read through to the same `DEFAULT_FEATURES` the frontend mirrors, and only an explicitly stored `false` denies.

### A04 — The novelty scan omits the checks ingestion applies

Sources: `backend/routers/duplication.py:157-211` (pre-fix), against `backend/services/ingestion.py:65-117` and `backend/routers/upload.py:485-512`.

`/duplication/scan` bounded the read at `max_upload_mb`, checked the extension and MIME type, and checked a `%PDF-` prefix. It then went straight to `extract_document`. The ingestion pipeline applies three further checks to the very same kind of file: PyMuPDF must be able to open it, it must not be encrypted, and its page count must sit inside `max_pdf_pages`. It also scans every manuscript with ClamAV.

So a 25 MB PDF declaring fifty thousand pages ran PyMuPDF and the OCR fallback over all of them with no ceiling, and no file reaching this endpoint was ever scanned for malware — including in production, where `validate_production_services` refuses to start without ClamAV precisely so that nothing uploaded goes unscanned. Reachable by any faculty account or any role with the novelty feature enabled.

This is F05, unfixed.

**Fix.** `_reject_unsafe_scan_upload` applies the same structural checks and a ClamAV scan before extraction, off the event loop like every other blocking step on that handler. An unavailable scanner fails closed with 503, as ingestion does: unscanned is not a substitute for clean.

### A05 — Citation repair manufactures attribution across theses

Sources: `backend/services/citations.py:93`, called from `backend/routers/chat.py`.

`enforce_citation_coverage` is the last rung of the repair ladder, below the bounded AI repair and above the grounded fallback. It mapped every out-of-range marker and every uncited substantive unit onto `allowed[0]`, the first retrieved source, whatever the context held — after which `validate_citations` passed.

That is sound only while every block on the table is a chunk of one thesis. The ordinary grounded path selects up to five chunks across as many papers. On those answers the repair named a specific thesis as the authority for a claim the model had never attributed to it, and the failure was invisible in the worst direction: the answer looked *better* cited afterwards, not worse. In a library whose product is the citation, this was the most damaging thing that file could do.

This is F11, unfixed.

**Fix.** The repair is gated on the paper rather than the marker count. Where every source is a chunk of one identified thesis it behaves exactly as before — the citation a reader sees is the thesis, the whole draft came from that thesis, and choosing between its chunks cannot misattribute it, which keeps the overview and exact-paper paths repairable. Across several theses the answer is left as the model wrote it, fails validation, and the caller serves the grounded retrieval fallback: a visibly hedged answer instead of a confidently misattributed one.

This is the one fix in this pass that changes evaluated behaviour. Its expected effect on Objective 2, and the fact that no figure in this repository has been measured since, are recorded in `rag-thesis-backend/evaluation/iso25010_evidence.md`. That entry also notes that `scripts/release_fingerprint.py` does not hash `services/citations.py`, so a future change to the repair ladder alone would not move the manifest.

### A06 — The guest token ceiling under-counts a turn's model calls

Sources: `backend/routers/chat.py`, `backend/services/guest_budget.py`.

The shared daily allowance is charged once per turn, before generation, as the measured prompt plus one worst-case completion. A turn can make up to four Gemini chat calls: the follow-up rewrite runs *before* that charge, and the duplication summary, the citation repair and the multi-paper coverage repair run beside or after it. None was measured. `guest_budget.py` documented only that retrieval *embeddings* were excluded, not whole generations, so a guest's real spend could be several times what the ceiling recorded — and that ceiling is mandatory in production specifically to stop a distributed script draining the shared Gemini quota and taking chat down for signed-in users too.

This is F09, narrowed to the specific paths that were unbilled.

**Fix.** All four are booked. The follow-up rewrite precedes the first paid call and can still refuse the turn. The three that run beside or after generation are booked without refusing: abandoning an answer that already exists, to save a call already made, would only show the reader a broken reply — booking keeps the day's counter honest, which is what refuses the next request. That is the same reasoning `guest_budget.charge` already documents for a refused request that still increments.

### A07 — A resumed batch upload leaks the previous account's manuscripts

Sources: `frontend/src/pages/UploadBatch.jsx`, `frontend/src/pages/upload/batchState.js`.

An in-flight batch is serialized to `sessionStorage` so a reload can resume polling. `sessionStorage` is per-tab but is not cleared by signing out, and the restore ran on mount with no idea who was signed in. After one reader signed out and another signed in on the same tab, the first reader's manuscript filenames, titles and job ids were restored into the second reader's table. The job ids are owner-scoped server-side and simply 404, settling the rows on "expired" — but the titles had already rendered.

**Fix.** The stored batch carries the id of the account that queued it, and is restored only to that account. The pre-change shape recorded no owner, so it is discarded rather than shown to whoever happens to be signed in.

### A08 — CORS omits PATCH, which the catalog API serves

Sources: `backend/main.py`, `backend/routers/catalog.py:208,232`.

`allow_methods` listed `GET, POST, PUT, DELETE, OPTIONS`. The catalog router serves `PATCH /catalog/programs/{id}` and `PATCH /catalog/specializations/{id}`, so the browser preflight for both was rejected and a documented superadmin operation was unreachable from any browser while working from curl and the OpenAPI docs page. No test pinned the method list. Latent rather than user-visible today only because `src/api.js` has no PATCH caller.

This is F12, unfixed.

**Fix.** PATCH added, with a note to keep the list in step with the methods the routers declare.

### A09 — The prompt-edit path reads a transcript with no bound

Sources: `backend/routers/chat.py`, `_history_before_turn` and `_truncate_session_from_turn`.

Both read the session's ordered transcript with no `.limit()`, bounded only by PostgREST's `db-max-rows` — a per-project setting, 1000 by default, which truncates silently. Past it the edit position resolved against a partial transcript, and the delete worked from a different boundary than the read, on a path whose whole correctness argument is that the two resolve against the same ordered read.

**Fix.** An explicit `_MAX_TRANSCRIPT_ROWS` ceiling: the loader limits its read to the edit position, and the truncation asks Postgres for exactly the tail to delete with `.range()` rather than reading everything and slicing in Python.

### A10 — Files past the batch cap are dropped silently

Sources: `frontend/src/pages/upload/batchState.js:124`.

`addRows` drops duplicates and then slices to `MAX_BATCH_FILES`. Both are right; both happened in silence. Dragging twenty-five manuscripts onto a page showing "20 / 20 selected" left five unaccounted for, with no clue but a count the reader had no reason to be totalling.

**Fix.** Both the overflow and the duplicate count are reported.

### A11 — The evaluation harness resumes a checkpoint under a changed configuration

Sources: `backend/evaluation/run_comparison.py`, `run_id` derivation, `_load_checkpoint`, `_run_pathways`, `_score_with_ragas` and the report's `reproducibility` block.

The checkpoint namespace was `sha256_file(dataset_path)[:12]` — the dataset digest and nothing else. `_load_checkpoint` keyed rows by query id and recorded no metadata about what produced them, and `_run_pathways` replayed any matching id verbatim, so the current code never ran for that query. The report then built `reproducibility.release` from `build_manifest()`, the environment as it stood at report time. A run could therefore publish a manifest describing code that had not produced the answers it was reporting. `--fresh` was the only defence, applied from memory.

This is F10. It was reachable rather than live, and the first draft of this report said otherwise; the correction is recorded here rather than quietly applied, because an overstated finding is exactly what a panel checks. `e9591c80b9f1` is the digest of `evaluation/dev_smoke_dataset.json`, a three-query development instrument — not of the Golden Dataset. `evaluation/results/checkpoints/e9591c80b9f1.pathways.jsonl` therefore held all three queries of a run that *completed*, not 3 of 40 from one that was interrupted. `comparison_20260903_200643.json` records that digest as its `golden_dataset_sha256` because the field names whatever dataset was passed; its own `queries_total: 3` and its `the Golden Dataset must contain 30-50 queries` validation issue both say which one that was. The Golden Dataset hashes to `9655bf9bcd95` and has since `347aa86`, so a default-run-id run would have opened a clean namespace and never touched that file.

What made it reachable is that the namespace is the only thing bounding a resume. Pooling needed either an explicit `--run-id e9591c80b9f1` or a re-run of the smoke dataset itself — both routine while iterating on the harness, and the smoke dataset is what every retained artifact in `evaluation/results/` was produced from. On either path `routers/chat.py` is one of `build_manifest()`'s hashed inputs and A05 changed it, so the manifest had moved while the answers had not. That checkpoint has been deleted.

One accidental protection existed on that path. Those three rows carry no `corpus_coverage`, so they trip the schema-drift warning and force `formal_result: false`. That guard catches a *field* being added, not a *configuration* changing, so a checkpoint written once the field existed would have replayed without it. It is also not what stands between this repository and a false formal result today: the Golden Dataset is still an unfilled template — forty `REPLACE:` ground truths, forty `REPLACE:` source theses, thirty-two undetermined strata and a blank faculty panel — so `validate_formal_dataset` refuses the run outright and every artifact in `evaluation/results/` carries `formal_result: false`. This guard matters for the first run *after* that dataset is validated, which is the run whose integrity nothing else was protecting.

**Fix.** The answering configuration is written to `<run-id>.provenance.json` when a checkpoint is created and compared before it is reused. A mismatch is refused, naming what moved — down to the individual file for `input_sha256`, because "input_sha256 changed" is true of any edit anywhere. `git_commit` is deliberately excluded from the comparison: it moves when a README changes, and a guard that refuses legitimate resumes is one that gets disabled. A checkpoint with no recorded configuration — every checkpoint written before this existed — is also refused. `--fresh` is how an operator accepts the change, so discarding a long run stays their decision rather than the tool's.

The manifest is now built once and used for both the gate and the published `reproducibility.release`, so the two cannot disagree.

Three residual gaps, stated so they are not mistaken for covered. The index fingerprint is the index *contract* — embedding model, dimensions, chunking and preprocessing versions — not an inventory of the corpus, so re-ingesting different manuscripts under identical settings still fingerprints the same and still needs `--fresh`. `_score_with_ragas` continues to key score reuse on the query id rather than on the answer text scored; in practice both checkpoints are created and deleted together, so they stay in step, but the binding is by convention rather than construction. And the compared set is the manifest's, so it covers every file `build_manifest()` hashes and nothing else: `evaluation/run_comparison.py` itself is not among them, even though it holds `_run_pathways`, the baseline prompt and `sanitize_evaluation_rows`. Its digest *is* computed and published as `reproducibility.evaluation_script_sha256`, so adding that one key to `_ANSWERING_CONFIGURATION_KEYS` would close it — editing the harness and resuming is the same shape as F10, one level up. Left for the same reason as `services/citations.py`: widening the compared set is a decision about the manifest's input set, not a bug fix, and it belongs with that version bump.

---

## Verification

Executed by the maintainer after the fixes landed, inside `.venv` on Python 3.14:

| Instrument | Result |
|---|---|
| PyTest with pytest-cov, `--cov-fail-under=85` | 1,200 passed, 3 skipped; 92.07% coverage (5,122 statements, 406 missed) |
| Pylint, the CI command | 10.00/10 |
| Node test runner, gated at 85/80/85 | 197 passed across 7 suites; 96.36% lines, 87.09% branches, 96.81% functions |
| `tests/test_export_openapi.py` | Contract regenerated for the intentional change; sha256 `d036f65f3c700b91ea8bbd48a028526e5878cb2abe4abfdb8d05884eb6213b9d` |

Twelve tests were added before that run: `tests/test_request_limits.py` covers the body ceiling and takes `services/request_limits.py` to 100%, including the case that matters most — a declared length over the ceiling is refused with the application never running at all; three tests cover the structural checks now applied to a novelty scan; and one pins the citation repair refusing to attribute a claim across theses.

A11 and its six tests in `tests/test_evaluation_harness.py` were written after the first run of this table, which recorded 1,194. The suite was re-run once they landed and the table above is that second run: the six tests are the whole of the 1,194 → 1,200 difference, and coverage is unchanged at 92.07% because `evaluation/` is outside the measured packages — the CI gate names `routers services dependencies workers main.py config.py models.py` and nothing else. For the same reason `evaluation/run_comparison.py` is unlinted by CI; run directly it scores 9.97/10, the single message being `C0302` for crossing 1,000 lines.

One caveat on the toolchain, since this is a versioned artifact: the `.venv` these figures come from is Python **3.14.6**, while the Dockerfile asserts exactly 3.14.7 and CI installs 3.14.7. The numbers are sound, but they were not measured on the interpreter the paper's tables record.

Three duplication-scan tests failed on the first run because their fixture sent `b'%PDF-dummy'`, which the new check correctly rejects as malformed. They now carry a PDF that parses, and the refusal they used to depend on is covered explicitly.

ESLint reports 0 errors and 0 warnings, which is a change from the standing `Archive.jsx` complexity advisory recorded in earlier passes; the rule that produced it is still configured, so it was resolved rather than silenced. The Playwright browser matrix was not re-run in this pass.

## Checked and found sound

Recorded because these were the likely places, and a reader should know they were looked at:

- **Database grants.** Every `SECURITY DEFINER` function carries `set search_path = public`, and each is revoked from `public, anon, authenticated` and granted only to `service_role` — in `supabase_setup.sql` and in each migration that creates or replaces it.
- **Upload idempotency.** Scoped `(owner_id, idempotency_key)` by a unique index, so a replayed key cannot reach another account's job. The batch endpoint additionally requires each row's key to be a valid UUID and rejects a repeat inside one request.
- **Prompt injection.** `services/prompts.py` is genuinely hardened: untrusted text is HTML-escaped and fenced, the no-evidence sentinel is only honoured on its own line at the start so a manuscript containing the token cannot flip the flag, and a shared `SAFETY_CONTRACT` names evidence, history and question as untrusted data.
- **The unverified-decode path in `_token_aal`.** Sound. It is reachable only after Supabase has validated that exact token, it reads one claim, and the `sub` check binds that claim to the already-validated identity.
- **Worker concurrency.** The lease heartbeat guards its mutable state with a lock and the keep-alive thread sends a bare heartbeat that cannot overwrite a pipeline stage; the ambiguous-commit path re-reads authoritative state rather than assuming failure.
- **Pydantic constraints on the admin surfaces.** `UserUpdate.full_name` and `.role` are required and pattern-constrained, so a partial update cannot null a role.
- **The nginx CSP.** No `script-src 'unsafe-inline'`, `object-src 'none'`, `frame-ancestors 'none'`, and the connect/font/frame origins are explicit.

## Prior findings not re-verified

Of the 2026-09-05 review's twelve, seven are addressed above. Of the rest:

- **F03** (unknown queue outcome deleting a committed job's source) and **F07** (saved-chat editing deleting history before the replacement persists) both appear closed: the staging path now re-reads authoritative job state and refuses to compensate a job that advanced, and truncation runs only after generation has returned.
- **F04** (AAL2 not consistently enforced) appears addressed across the privileged guards. Note that A03 deliberately does not extend it to chat and archive.
- **F06** (rotating a supplied guest ID resets per-guest limits) remains true by design, bounded by the per-IP ceiling and Turnstile.
- **F10** was re-verified, found open and live, and fixed; it is recorded above as A11.

That leaves F03, F04 and F07 as the three whose closure was inferred from reading the current code rather than reproduced, and F06 as the one accepted by design.
