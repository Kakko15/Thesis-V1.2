# PI-03, PI-04, PI-05, PI-06, and PI-08 Verification Audit

| Control | Value |
| --- | --- |
| Audit date | 2026-07-25 |
| Audited by | Repository verification run; institutional decisions remain human-owned |
| Release boundary | CCSICT, Isabela State University - Echague |
| Result | Local engineering gates passed; external and human gates remain explicit |

## Status decision

| Item | Audited status | Decision basis or remaining gate |
| --- | --- | --- |
| ✅ PI-03 | `VERIFIED` | Exact Linux dependency audits, live Gemini deployment smoke tests, zero-High/Critical container scans, and independently validated amd64/arm64 OCI digests all pass with hashed evidence. |
| 🚧 PI-04 | `IMPLEMENTED-UNVERIFIED` | The normalized catalog is not yet applied and rolled back in an authorized disposable Supabase project with RLS, count, and reference-integrity evidence; production data review is also pending. |
| 🚧 PI-05 | `IMPLEMENTED-UNVERIFIED` | Responsive visual evidence is captured, but axe, screen-reader, Lighthouse, and sustained real-device GPU evidence remain open. |
| 🚧 PI-06 | `IMPLEMENTED-UNVERIFIED` | Critical journeys and responsive baselines pass, but the formal accessibility, Lighthouse, assistive-technology, and real-device release matrix is incomplete. |
| ⛔ PI-08 | `BLOCKED-EXTERNAL` | The real 50-paper corpus and four institutional approvals do not exist in the controlled manifest; researchers may not self-approve them. |

No item was promoted by inference. The authoritative rule remains: an item is never `VERIFIED` while a migration, deployment, approval, evidence, privacy, or recovery gate is open.

## ✅ Evidence completed in this audit

- ✅ ~~Backend regression: 349 passed, 3 skipped, 0 failed.~~
- ✅ ~~Backend coverage: 86.03%, above the enforced 85% release threshold.~~
- ✅ ~~Backend maintainability: Pylint 10.00/10.~~
- ✅ ~~Frontend unit regression: 24 passed, 0 failed.~~
- ✅ ~~Frontend ESLint: clean.~~
- ✅ ~~Frontend Vite production build: 3,803 modules transformed successfully.~~
- ✅ ~~Frontend Chromium E2E: 10 passed, including all role-critical journeys.~~
- ✅ ~~Four-viewport structural QA at 360, 768, 1280, and 1536 pixels for landing, authentication, and guest chat: no horizontal overflow, duplicate IDs, unnamed visible controls, missing image alternatives, page-heading failures, or browser console errors.~~
- ✅ ~~Light/dark Material semantic-contrast regression passed.~~
- ✅ ~~Reduced-motion rendering was exercised during the responsive matrix.~~
- ✅ ~~Mobile and desktop visual baselines were captured and inspected.~~
- ✅ ~~The authentication root now exposes a semantic `main` landmark and guest chat exposes one page-level `h1`.~~
- ✅ ~~A deterministic OpenAPI snapshot was generated and contract-tested.~~
- ✅ ~~API, worker, and frontend images were rebuilt on Python 3.14.6, Node 24.18.0, and Alpine 3.24; pinned Trivy 0.72.0 found 0 High and 0 Critical vulnerabilities in every image without `--ignore-unfixed`.~~
- ✅ ~~The exact installed Linux backend environment reported zero known Python vulnerabilities; the frontend production graph reported zero High and zero Critical npm vulnerabilities.~~
- ✅ ~~Live Gemini deployment smoke passed for `gemini-3.6-flash`, `gemini-3.5-flash-lite`, and 768-dimensional `gemini-embedding-2`.~~
- ✅ ~~API/worker and frontend OCI layouts contain verified `linux/amd64` and `linux/arm64` manifests with preserved SHA-256 digests.~~

OpenAPI evidence: [IskAI OpenAPI snapshot](contracts/iskai-openapi-2026-07-25.json), SHA-256 `0074471964630c31d3994caa2ca8758fb456a00486dc8886819e0815a6d3beb5`.

Visual evidence:

- [Landing 360](visual-baselines/landing-360.png), [768](visual-baselines/landing-768.png), [1280](visual-baselines/landing-1280.png), and [1536](visual-baselines/landing-1536.png)
- [Authentication 360](visual-baselines/authentication-360.png) and [1536](visual-baselines/authentication-1536.png)
- [Guest chat 360](visual-baselines/guest-chat-360.png) and [1536](visual-baselines/guest-chat-1536.png)

## Verification commands and outcomes

| Gate | Outcome |
| --- | --- |
| `pytest` with workspace-owned `--basetemp` and `--cov-fail-under=85` | ✅ 349 passed, 3 skipped; 86.03% |
| Pylint over application packages | ✅ 10.00/10 |
| `npm test` | ✅ 24 passed |
| `npm run lint` | ✅ Clean |
| `npm run build` | ✅ Production bundle built |
| `npm run test:e2e` | ✅ 10 passed |
| Deterministic OpenAPI export test | ✅ Passed |
| `scripts/verify-pi03-container-security.ps1` | ✅ API 0/0, worker 0/0, frontend 0/0 High/Critical; JSON reports and SHA-256 manifest preserved |
| `scripts/verify-pi03-dependencies.ps1` | ✅ Python 0 known vulnerabilities; npm 0/0 High/Critical; exact Linux release environment audited |
| `scripts/verify-pi03-gemini.ps1` | ✅ Live chat, verdict, and 768-dimensional embedding checks passed using synthetic input |
| `scripts/verify-pi03-multiarch.ps1` | ✅ API/worker and frontend amd64/arm64 manifests and OCI blob hashes verified |
| PI-08 draft validation | ✅ Draft schema is valid |
| PI-08 `--lock-ready` validation | ⛔ Correctly rejected: not 50 papers and all four approval objects are incomplete |

The three backend skips are environment-owned integrations: ClamAV and two authorized disposable-Supabase RLS/queue tests. They are not counted as passed evidence.

## 🚧 Status gates by item

### PI-03

- ✅ ~~Build and scan the release images; preserve zero-High/Critical JSON evidence.~~
- ✅ ~~Resolve and validate multi-architecture deployment digests.~~
- ✅ ~~Audit the exact Linux release dependency environment and meet the zero-high policy.~~
- ✅ ~~Update protected deployment model overrides and pass authorized Gemini free-tier smoke tests.~~

Final PI-03 evidence:

- [Dependency audits](security/pi-03-dependencies-20260725-045627/SUMMARY.md)
- [Live Gemini smoke](security/pi-03-gemini-20260725-043908/SUMMARY.md)
- [Container security](security/pi-03-20260725-044127/SUMMARY.md)
- [Multi-architecture digests](security/pi-03-multiarch-20260725-044816/SUMMARY.md)

### PI-04

- ⏳ Apply and roll back the migration in an authorized disposable Supabase project.
- ⏳ Capture before/after counts, RLS isolation, normalized-reference integrity, and rollback evidence.
- ⏳ Complete the human production-catalog data review.

### PI-05 and PI-06

- ⏳ Run axe and record zero serious/critical findings.
- ⏳ Record keyboard-only and screen-reader transcripts for critical journeys.
- ⏳ Meet the documented mobile Lighthouse performance, accessibility, and best-practices budgets.
- ⏳ Profile sustained 3D behavior on representative low-, mid-, and high-tier real devices/GPUs.

### PI-08

- ⏳ Obtain controlled written approval from the serving CCSICT Department Chair, University Librarian or delegated custodian, Privacy Officer/DPO, and thesis adviser.
- ⏳ Complete individual rights, privacy, eligibility, and metadata review for exactly 50 real CCSICT theses.
- ⏳ Lock the approved manifest, generate its immutable SHA-256 receipt, and verify it against the controlled source set.

Strict PI-08 output on 2026-07-25:

```text
Manifest validation failed:
- lock-ready corpus must contain exactly 50 papers
- approvals.ccsict_department_chair must be a completed approval object
- approvals.university_librarian must be a completed approval object
- approvals.privacy_officer must be a completed approval object
- approvals.thesis_adviser must be a completed approval object
```

## Environment constraints observed

- Docker CLI is present, but the Docker engine is not running.
- Registry/network access required for a fresh npm audit and missing audit tools was denied in this environment.
- `axe-core`, Lighthouse, and the Playwright axe adapter are not installed locally.
- The protected deployment, disposable Supabase project, institutional records, assistive-technology sessions, and representative physical devices were not available to this repository audit.

These constraints are recorded as open evidence gates, not converted into passes.
