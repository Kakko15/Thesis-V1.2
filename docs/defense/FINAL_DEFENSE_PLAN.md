# IskAI — Final-Defense Feature Plan (Panel Recommendations)

## Context

The system defense is done; the final defense is in November 2026. The panel and dean left
eight recommendations, and they will load and test the system against the department's
thesis collection on defense day. This plan implements the **system features only** — the
objectives/framework revision is explicitly deferred by the user. Nothing here touches the
frozen evaluated pipeline, so the formal Objective 2 result (run `5e8fb7f21db6`) survives
regardless of what the paper revision later decides.

Panel items covered: PDF novelty report with dean's signature (transparent PNG,
auto-applied on download) · capsule novelty checking, batched · abstract autofill ·
adviser metadata · approval-sheet autofill (adviser + all panel) · 5-year storage sizing ·
full-archive readiness (~250 theses on free tier now).

## Decisions taken (safe defaults, each reversible later)

| Decision | Default | Why |
|---|---|---|
| Who downloads the SIGNED report | admin/superadmin only; owners get unsigned | smallest forgery/consent surface; widening is a one-guard change |
| Signature governance | PNG in a PRIVATE bucket, composited server-side, only when consent is recorded; otherwise blank wet-sign line | a transparent dean signature in a public bucket is a forgery kit |
| Objective 2 result | stays frozen; full archive presented as deployment, not the experiment | 24/40 golden queries are defined by corpus ABSENCE; a re-run costs ~240 model calls + fresh panel validation |
| Capsule verdict | topic-level via existing `check_topic_duplication`; concentration verdict suppressed below 5 chunks | 2–4 chunks quantize concentration to 0/33/67/100 — meaningless |
| Objectives/framework | out of scope | user instruction |

## Hard rules (violating any of these breaks the thesis, not just the build)

1. **Never modify** (release fingerprint hashes them; editing invalidates Objective 2):
   `routers/chat.py`, `services/retriever.py`, `services/prompts.py`,
   `services/question_types.py`, **`config.py` (the whole file)**, `requirements.txt`,
   `requirements.lock`, both `Dockerfile`s, `rag-thesis-frontend/package-lock.json`,
   `docker-compose.operations.yml`. Calling their functions from new code is fine.
   ⇒ Corollaries: **no new config settings** (reuse existing rate limits; new numeric
   constants live in the new modules), **no new Python or npm dependencies** (PDF uses the
   pinned `pymupdf`), no Dockerfile edits (`services/*.py` / `routers/*.py` are copied
   wholesale already).
2. Every schema change lands in **both** `supabase_setup.sql` and a new
   `migrations/20260916_*.sql` (+ `.rollback.sql`); `tests/test_schema_consistency.py`
   extended only if a NEW SQL function appears in both files (redefining
   `hydrate_paper_academic_classification` in migration-only is the existing pattern and
   needs no test edit).
3. **Every commit that adds/changes an endpoint regenerates
   `docs/evidence/contracts/iskai-openapi.current.json`** (`python -m scripts.export_openapi`)
   — `tests/test_export_openapi.py` diffs it.
4. New endpoints live under existing proxied prefixes (`/duplication`, `/settings`,
   `/upload`, `/papers`) — no Vite proxy or CSP changes.
5. The PDF report keeps the JSON report's guarantees: **no manuscript excerpts, no
   reviewer chat, no Gemini verdict text** (`verdict_summary` quotes excerpts — verified).
6. Before the first commit: `git tag defense-2026-09`.

---

## Phase 0 — non-code triggers (this week; longest leads)

| # | Action | Why now |
|---|---|---|
| 0.1 | `git tag defense-2026-09` | defended state stays addressable |
| 0.2 | Enable **Gemini billing** | measured: 0 of 30 queries answered at 10 concurrent users on free tier; dean + 4 panelists typing at once is that scenario |
| 0.3 | **Written signature consent** from the dean (and any auto-applied signatory) | gates the signed path; without it reports ship with a blank wet-sign line (still complete) |
| 0.4 | Trigger **PI-08 round 2**: which theses the department releases, new corpus ID, four approvals, per-thesis privacy screen | longest institutional lead; ingest in tranches as approvals land |
| 0.5 | Sample **10 pre-2020 theses** (MB + scan ratio) | validates the 250-thesis free-tier target and OCR load |
| 0.6 | Supabase tier check: free holds ~250 theses (storage-bound, 1 GB, ~3.29 MB avg); Pro $25/mo beyond | storage binds first, DB does not |

---

## Phase 1 — Foundations

### Migrations (three files + rollbacks; all mirrored into `supabase_setup.sql`)

**`migrations/20260916_signatories.sql`**
- `signatories` table: `id uuid pk`, `full_name` (1–120), `honorifics`, `roles text[]`
  CHECK subset-of `{adviser, technical_panel, content_panel, panel_chair, program_chair, dean}`
  (one person, many roles — e.g. San Jose is Content Panel AND Dean), `signature_path`,
  `signature_consent bool default false`, `consent_recorded_at`, `active`, timestamps.
  RLS enabled, zero policies (deny-all clients), service_role grants only.
- **New PRIVATE bucket `signatures`** with the same restrictive deny policy as `pdfs`
  (`using (bucket_id <> 'signatures')`). Separate bucket, not a pdfs prefix: keeps
  forgery-grade assets out of the thesis-backup blast radius and gets its own assertion in
  the setup contract check.
- Idempotent seed (names already public in `evaluation/golden_dataset.json`): Maribao
  (content_panel), Lagarteja (technical_panel), Vinluan (panel_chair) — no assets, consent false.
- Base-schema parity: table + bucket + policy into `supabase_setup.sql`; add `signatories`
  to the required-tables check and a `signatures` bucket assertion.

**`migrations/20260916_scan_reports.sql`**
- `scan_history` + `scan_type text not null default 'thesis'` CHECK `thesis|capsule`;
  + `archive_size integer` (nullable — **verified: scan_history does NOT carry it today**;
  older rows print "not recorded").
- `report_verifications`: `id`, `verification_code text unique`, `scan_id → scan_history
  on delete set null`, `scanned_at` (denormalized so verification outlives the scan row),
  `signed bool`, `signatory_name` (printed name at generation time), `generated_by`,
  `generated_at`, `unique (scan_id, signed)` (re-download reuses the code). RLS deny-all.

**`migrations/20260916_committee_metadata.sql`**
- `papers` + `adviser text`, + `committee jsonb` (role-keyed, lists of
  `{name, honorifics, signatory_id|null}` — uniform lists handle multi-role people and
  historical committees that predate the roster).
- Redefine `hydrate_paper_academic_classification` (same body as the `20260819` version
  plus `new.adviser` / `new.committee` from `request_payload`) — migration-only, matching
  the existing pattern; `commit_paper_ingestion`'s insert list is untouched.

### F1 — Signatory roster + signature assets (M)

**New**: `routers/signatories.py` (`prefix='/settings/signatories'` — reuses the existing
/settings proxy), `services/signatures.py`
(`store_signature_png` — PNG magic + ≤1 MB + `fitz.Pixmap` parse, warn if no alpha;
**`fetch_signature_png` returns None unless consent AND asset** — the consent gate lives at
the lowest level; `remove_signature`).

| Endpoint | Guard |
|---|---|
| `GET /settings/signatories?role=&active=` | `get_current_user` — allowlisted fields incl. `has_signature` bool; **never** `signature_path` |
| `POST /settings/signatories` | `require_superadmin` |
| `PUT /settings/signatories/{id}` | `require_superadmin`; `signature_consent=true` stamps `consent_recorded_at` server-side |
| `DELETE /settings/signatories/{id}` | `require_superadmin` (row + asset) |
| `PUT /settings/signatories/{id}/signature` | `require_superadmin` + `rate_limit_upload` (multipart PNG) |
| `DELETE /settings/signatories/{id}/signature` | `require_superadmin` |

All mutations → `log_activity`. **Modified**: `main.py` (router), `models.py`
(`SignatoryOut/Create/Update`, roles as Literal list, deduped), README one-liner, OpenAPI regen.
**Frontend**: `src/api.js` CRUD fns; new `src/pages/settings/SignatoriesPanel.jsx` +
pure `signatoriesState.js` (+ colocated test), wired into `Settings.jsx` (superadmin only).
**Tests**: `tests/test_signatories.py` — guard 403s, role vocabulary, consent stamping, PNG
rejection, no-path-leak, consent-gate returns None even when an asset exists.

### F7 — `/papers` server-side pagination (S)

`routers/papers.py` only: optional `limit (1–100)` / `offset` / `q` (title `ilike`, with
`%_\` escaped). **No params ⇒ byte-identical legacy behavior** so `useArchiveCatalog.js`
keeps working unmodified; with `limit` ⇒ `count='exact'` returned as `X-Total-Count` header
(response stays `list[PaperOut]` — no envelope break). Frontend `listPapers` gains optional
passthrough; full server-side filter migration is a flagged follow-up (client filtering is
fine at 250 papers). **Tests**: `tests/test_papers_pagination.py`.

---

## Phase 2 — F2: Signed PDF novelty report (L; needs F1 + scan_reports migration)

**New `services/report_pdf.py`** — modeled on `docs/defense/build_chapter1_packet.py`
(A4 `fitz.paper_rect`, `insert_textbox` with overflow → `ValueError`, `set_metadata`,
`save(garbage=4, deflate=True)` → bytes).

- `REPORT_LIMITATIONS` tuple — verbatim the four limitations from
  `src/pages/novelty/report.js`, pinned by a cross-file parity test.
- `build_scan_report_pdf(scan, *, verification_code, signatory, signature_png, generated_at)`.
- Layout: institutional header · scan metadata (filename, department, scan date,
  archive size or "not recorded", scan type) · **deterministic figures only** (verdict
  label, highest similarity, coverage, matched/total chunks, 85% threshold) · matched
  studies table (metadata only) · four limitations verbatim · verification code + verify
  URL · signature block: composited transparent PNG (`insert_image` preserves alpha) above
  name/honorifics/"College Dean" + "Digitally applied with recorded consent (date)" when
  `signature_png` present, else a drawn blank rule with name/title.
- Builder projects `scan` through its own internal allowlist so **`verdict_summary`
  (quotes excerpts), `matched_chunks`, `chat_log` can never leak** even if a caller passes
  the raw row.

**Modified `routers/duplication.py`** (not frozen — verified):
- `/scan` insert gains `scan_type='thesis'`, `archive_size=novelty.archive_size(dept)`
  (new one-line public wrapper in `services/novelty.py` over the private `_archive_size` —
  novelty.py is not frozen).
- `_PUBLIC_SCAN_FIELDS` + `/history` select gain `scan_type, archive_size`.
- `GET /duplication/history/{scan_id}/report.pdf?signed=` — `rate_limit_followup`.
  Unsigned: owner only. `signed=true`: admin/superadmin, same-department rule as
  `papers.py::delete_paper` (superadmin: any). Verification row upserted on
  `(scan_id, signed)`, code = `secrets.token_urlsafe(16)`. `Content-Disposition` filename
  via `sanitize_filename`. Logs `novelty_report_pdf`.
- `GET /duplication/report-verification/{code}` — **public**, `rate_limit_public`, code
  length-capped; returns only `{valid, signed, scanned_at, generated_at, scan_deleted}`;
  404 unknown. (Already proxied; pretty verify page = flagged follow-up.)

**Frontend**: `api.js::downloadScanReportPdf` (blob download); `Novelty.jsx` ScanResult +
history rows gain "Download PDF report" (JSON export stays); "signed" variant rendered for
admin/superadmin only. **Models**: `ScanHistoryOut` + `scan_type`, `archive_size`.

**Tests**: `tests/test_report_pdf.py` — `%PDF` magic; fitz-extracted text contains verdict
label + code + all four limitations; **cross-file parity with report.js strings**;
leak sentinels (`verdict_summary='LEAK-A'` etc. never appear); signature only with
consent+asset (assert via `page.get_images()`); overflow raises.
`tests/test_duplication_reports.py` — guard matrix, verification idempotency, public
verify shape.

---

## Phase 3 — F3: Capsule novelty check + batch (M; needs scan_reports migration)

**Modified `routers/duplication.py`** — module constants (NOT config.py):
`CAPSULE_MAX_PAGES=10`, `CAPSULE_BATCH_MAX=10`, `CAPSULE_MIN_VERDICT_CHUNKS=5`,
`CAPSULE_NEIGHBOR_FLOOR=0.30`.

- `POST /duplication/capsule` (single) and `POST /duplication/capsule/batch` (≤10 files,
  one `rate_limit_scan` hit per batch, sequential, per-file error isolation via
  `CapsuleFileResult` — the `BatchFileResult` pattern).
- Shared impl: identical validation to `/scan` (incl. fail-closed malware) + 422 above 10
  pages ("Capsules are 2-3 page condensed proposals; use the full novelty scan for
  manuscripts") → extract → clean → `embed_texts` (2–4 embeddings) →
  **per chunk, call the frozen `retriever.check_topic_duplication(chunk_text,
  threshold=0.30, query_embedding=emb, department_filter=dept)`** (2–4 RPCs, zero extra
  embeds, engine called not copied); best match per paper; overall closest study reported
  **even below 85%**; `flagged = best ≥ 85%`.
- Verdict: `review_suggested` if flagged else `clear` — **never `high_overlap`**
  (concentration suppressed below 5 chunks). `verdict_summary` is deterministic text (no
  Gemini call): topic-level scope, closest study, similarity, "concentration verdicts do
  not apply to capsules". Follow-up `/duplication/chat` still works.
- Persist: `scan_type='capsule'`, `archive_size`, figures, `top_matches` metadata-only,
  `matched_chunks=[]`, `chat_log=[]`. Response: `_public_scan(row)` + a
  `DuplicationAlert`-shaped `topic_alert` with `matched_abstract` (public metadata) and
  **`matched_excerpt` dropped** (archived chunk text never leaves).

**Models**: `CapsuleFileResult`, `CapsuleBatchResponse`.
**Frontend**: `Novelty.jsx` mode toggle (Thesis scan | Capsule check), multi-file dropzone,
per-file result cards with the explicit topic-level advisory line; history rows get a
`Capsule` badge; new pure `src/pages/novelty/capsuleState.js` + test; `api.js` fns.
**Tests**: `tests/test_capsule_scan.py` — page cap, verdict mapping, never-high_overlap,
no `matched_excerpt` in response, batch isolation, scan_type persisted.

---

## Phase 4 — Metadata features (F4 S, F5 M, F6 M)

**New shared `services/manuscript_fields.py`** — all three read **RAW page text**
(`fitz` `page.get_text()`, first 10 pages), upstream of `document_processor`'s cleaning,
because `_EXCLUDED_SECTION_HEADINGS` deletes the approval sheet and `_PII_RULES` redact
signature lines before indexing:
- `raw_page_texts(file_bytes, limit=10)` — single `fitz.open`, shared by all extractors.
- `extract_abstract(pages)` — `^ABSTRACT$` heading → capture to next heading boundary,
  cap 10,000 chars (matches `_validate_metadata`).
- `extract_adviser(pages, roster_names)` — "NAME ↵ Thesis Adviser" and "Adviser: NAME"
  patterns; fill **only** when roster-matched or clearly name-shaped; else `''`.
- `extract_committee(pages, roster)` — locate `^APPROVAL SHEET$` page, roster-name match +
  role-label proximity; photos/absent sheets → `{}` (roster defaults win).

**F4 — Abstract autofill**: `routers/upload.py` extract endpoints call
`extract_abstract`; **abstract stays OUT of `_METADATA_FIELDS`** (the deliberate comment at
~:1313 stands — never routed through the AI pass); restructure the two extract endpoints to
read file bytes once. `BatchExtractedFile.abstract`, `BatchRow.abstract` (and stop
hardcoding `''` at `upload_batch` ~:982). Frontend: `runAutofill` patch,
`AUTOFILLABLE_KEYS + 'abstract'`, **flip `wizardSteps.test.js:141` in the same commit**
(it currently pins abstract as NOT autofillable — verified), `AbstractDisclosure`
auto-open, batch passthrough. Tests: `tests/test_manuscript_fields.py` + extend
`test_metadata_field_shapes.py`.

**F5 — Adviser**: `PaperOut.adviser`, `BatchRow.adviser`; upload form field
(roster-driven Select from F1 with free-text fallback); `request_payload['adviser']` →
hydrate trigger stamps it (thesis_category precedent); `papers.py` field list + legacy
fallback already degrades. Archive card/detail render it. **Explicit note: chat citation
sources will NOT show adviser — `retriever.public_source` is frozen.** Tests: extraction +
a `test_thesis_category.py`-style migration-text assertion that the newest hydrate body
stamps `adviser`/`committee`.

**F6 — Committee autofill**: upload review step gains `CommitteePanel`
(new `src/components/upload/CommitteePanel.jsx` + pure `committeeState.js` + test):
defaults from current roster role-holders, pre-overridden by extracted committee, editable
before submit. Backend: `committee` Form field, `_validated_committee()` (six role keys
allowlist, ≤6/role, ≤20 total, 422 on unknown keys) → `request_payload` → trigger.
**Scope note: committee data is records/display only — never re-rendered as a signed
approval sheet.** Tests: `tests/test_committee_metadata.py`.

---

## Phase 5 — Ops/scale (no code) + 5-year storage answer

1. Gemini billing before any load-bearing demo (0.2).
2. Bulk ingest **worker runs in the container only** — local `.venv` has no tesserocr
   (verified); OCR-less scanned pages fail closed by design.
3. Tranches ≤250 on free tier; after each tranche: `scripts/rescan_duplication.py` then
   `scripts/backfill_screening_archive_size.py` (dry-run first).
4. Supabase Pro trigger: storage crossing ~0.8 GB or the first >250 tranche.
5. PI-08 approvals scheduled ahead of the bulk-load freeze.
6. Backup follow-up: include the `signatures` bucket in `storage_backup.py` (flagged,
   outside this plan's code scope).

**5-year storage table** (deliverable: `docs/CAPACITY_PLAN.md`, quoted at the defense).
From a 250-thesis base at ~3.6 MB/thesis (92% is the PDF):

| Intake/yr | Total in 5 yrs | Storage |
|---|---|---|
| 30 | 400 | 1.4 GB |
| 60 | 550 | 1.9 GB |
| 100 | 750 | 2.6 GB |
| 200 | 1,250 | 4.4 GB |

Every scenario exceeds free (1 GB) in year 1 and fits Pro (100 GB) with >95% headroom.
Backup retention (`KeepLast=14`, full-bucket copies) becomes the largest storage consumer
at scale — reduce retention in the runbook.

## Phase 6 — Hardening & rehearsal

Full gates green (below) · fresh dated block in `evaluation/iso25010_evidence.md` for the
new features · `scripts/verify_key_pool.py` on defense morning · concurrency rehearsal:
five people on chat simultaneously · demo walk-through of: upload with abstract/adviser
autofill → capsule batch check → signed PDF download → public verification URL.

---

## Dependency graph & commit sequence

```
signatories.sql ──► F1 (M) ──► F2 (L)            scan_reports.sql ──► F2, F3 (M)
                         └──► F5 (M) ──► F6 (M)   committee_metadata.sql ──► F5, F6
F4 (S) independent (builds services/manuscript_fields.py, shared with F5/F6)
F7 (S) independent · F8 checklist any time
```

1. `feat: signatory roster with private signature bucket`
2. `feat: server-side pagination for /papers`
3. `feat: scan report verifications and history provenance columns`
4. `feat: signed pdf novelty report with public verification`
5. `feat: capsule topic-level novelty check with batch`
6. `feat: abstract autofill from raw manuscript pages`
7. `feat: adviser and committee metadata with approval-sheet autofill`

Each commit: pytest + pylint clean + OpenAPI contract regenerated when endpoints changed.

## Verification (end-to-end)

- **Backend**: `pytest` full suite (`--cov-fail-under=85` stays green; new test files
  named above), `pylint --rcfile=.pylintrc routers services dependencies workers main.py
  config.py models.py` clean, `pytest tests/test_export_openapi.py` after every endpoint
  commit, `pytest tests/test_schema_consistency.py` after every migration.
- **Frontend**: `npm run lint`, `npm test` (new colocated tests: `signatoriesState`,
  `capsuleState`, `committeeState`, updated `wizardSteps`), `npm run build && npm run
  bundle:budget` (new UI is small; Novelty/Settings stay lazy), `npm run test:e2e`
  (existing flows must stay green; new controls need accessible names for the axe matrix).
- **Manual smoke** (stack up per README order): upload a real PDF → abstract + adviser
  chips appear → submit → archive shows adviser/committee · run a thesis scan → download
  unsigned PDF as owner, signed as admin → `curl` the printed verification URL → JSON
  confirms · capsule batch with 3 small PDFs → closest-study cards, one bad file isolated ·
  `GET /papers?limit=6&offset=0` returns `X-Total-Count`.
- **Migration drill**: apply the three migrations to a disposable project, run the app's
  `/ready`, then apply rollbacks and confirm the pre-migration suite still passes.

## Risks

| Risk | Mitigation |
|---|---|
| Demo dies under panel concurrency (measured 0 answered @10 users) | 0.2 billing; `verify_key_pool.py` defense morning |
| Objective 2 invalidated | Hard rule 1; frozen corpus stays the evaluated corpus |
| PI-08 approvals late | 0.4 starts now; tranche-wise ingest; demo works at any archive size |
| Signature misuse/forgery | private bucket, server-side stamping, consent gate at the lowest level, verification codes, admin-only signed downloads |
| Excerpt leak via PDF | builder-internal allowlist + leak-sentinel tests (verdict_summary quotes excerpts — verified) |
| Scanned theses fail bulk ingest | container-only worker (local venv has no OCR — verified) |
| Rescreening lag on bulk load (quadratic fold-in) | tranches + rescan/backfill scripts after each |
