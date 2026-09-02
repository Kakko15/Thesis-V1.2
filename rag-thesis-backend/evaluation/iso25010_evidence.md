# ISO/IEC 25010 Evidence Snapshot

> **Snapshot notice:** This file records the dated evidence below and is not a live delivery-status ledger. Final evidence must be regenerated from the immutable release manifest (`scripts/corpus_manifest.py` and `scripts/release_fingerprint.py`).
>
> This notice previously pointed at `ISU_ECHAGUE_PRODUCTION_ROADMAP.md` as the authoritative ledger. That file does not exist in the repository and is listed in `.gitignore`, so anyone following the link — including a panel member — reached nothing.

This file reports only observed command results. Pending external measurements are never represented as successful results.

## Current local revalidation - 2026-09-03, `9cb3659`

Measured on Windows 11 against commit `9cb3659` with a clean working tree, after the
five commits of 2026-09-03 (`866d557`, `6c71278`, `145eca9`, `ce66a29`, `9cb3659`)
landed on `main` and CI went green on that revision. Toolchain unchanged from the
`da9e931` pass below (`.venv`, Python 3.14.6, PyTest 9.1.1, Pylint 4.0.6, Node.js
24.18.0, ESLint 9.39.5). Every figure was read from the command's **exit code**. Backend
counts taken without `ALLOW_DISPOSABLE_SUPABASE_TESTS` set, so the three
disposable-project integration tests skipped as designed.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov, enforced `--cov-fail-under=85` | 970 passed and 3 opt-in external integration tests skipped; 91.58% coverage (4,277 statements, 360 missed) | Passed |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Backend container image starts | `docker build` of `rag-thesis-backend`, then `docker run ... python -c "import main, workers.ingestion_worker"` with placeholder credentials | Both entrypoints import; the image built from `da9e931` failed the same command with `ModuleNotFoundError: warning_filters` (see below) | Passed |
| Live Gemini release smoke (PI-03) | `scripts/gemini_release_smoke.py` inside the same release image, direct Google route, synthetic input only | PASS: `gemini-3.6-flash` 1,521.93 ms, `gemini-3.5-flash-lite` 806.15 ms, `gemini-embedding-001` 514.99 ms returning 768 finite values. Evidence `docs/evidence/security/pi-03-gemini-20260903-045753/`; supersedes the 2026-07-25 bundle, which recorded `gemini-embedding-2`. First run with `docker run` and `APP_ENVIRONMENT=development` because the compose wrapper forced production, which now requires `GUEST_DAILY_TOKEN_BUDGET`; the wrapper was then repaired to pass that override itself and re-run through the documented path, producing `pi-03-gemini-20260903-051421/` (PASS, same model set) | Passed |
| Frontend unit tests and coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 130 passed; 95.15% lines, 90.09% branches, 95.24% functions | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors, 1 warning (the `Archive.jsx` complexity advisory recorded on 2026-08-30, unchanged) | Passed; one advisory |
| Frontend production build | Vite | Production build completed in 610 ms from a removed `dist/`, 3,888 modules transformed | Passed |
| Frontend bundle budget | `npm run bundle:budget` | Eager payload 316.9 kB gzipped across 11 files against a 330 kB budget | Passed |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Critical browser journeys and accessibility matrix | Playwright 1.61.1 with @axe-core/playwright 4.12.1, Chromium, 24 tests including the 11-surface axe matrix | 24 passed in 2.8 min | Passed |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Not re-run locally in this pass; green in CI on `9cb3659` | Passed in CI |
| Container vulnerability scan | Trivy | Not run locally in this pass; both images green in CI on `9cb3659` | Passed in CI |
| Backend dependency vulnerability audit | pip-audit against `requirements.lock` | Cannot run on this host (`tesserocr` has no wheel here); green in CI on `9cb3659` | Passed in CI |

### CI on `9cb3659`

Verified against the unauthenticated GitHub Actions API, not by assumption:
[run 33680548573](https://github.com/Kakko15/Thesis-V1.2/actions/runs/33680548573), check
suite `91276003580`, head `9cb365999a7bd0a615d5101ab26573c190fb7e35`, started
2026-09-02T20:39:03Z — all six check runs `completed` with conclusion `success`: Backend
(PyTest + Pylint), Frontend (ESLint + build), Secret scan, both container vulnerability
scans, and SonarQube.

### What changed in the measured system

- `866d557` — **the backend image could not start.** `main.py` and the ingestion worker
  import `warning_filters` first, a module added on 2026-09-02 that the Dockerfile's
  named COPY list never included. Trivy and the SBOM inspect the image without running
  it, so every green container check since `c201b81` was taken on an image that failed
  at import. Reproduced on the image built from `da9e931`; fixed, and guarded by
  `tests/test_dockerfile_contents.py`, which resolves the entrypoints' first-party
  imports against the COPY instructions.
- `6c71278` — `is_capacity_error` matched the bare substring `429`, so any error text
  carrying those digits tripped the 60-second provider cooldown and rotated the key
  pool. It now matches a labelled HTTP status, sharing the pattern `network_retry`
  already used for the same reason.
- `145eca9` — one password rule on every reset path, a typed novelty dropzone, the
  coverage metric labelled as coverage, and dead frontend code removed.
- `ce66a29` — documentation only, including this file's axe-matrix wording (55 scans,
  not every state at both widths) and the `.venv` name in the governance protocol.
- `9cb3659` — manuscript corrections (Pass 8); no effect on the measured system.

### Suite growth since `da9e931`

Backend rose from **944** to **970**: 12 from `b74d872` and `3c5a121` (effect size,
interval, rank-biserial and notice-split tests, skipped where scipy is absent), which
landed after the `da9e931` pass and were never recorded; 11 from `6c71278` pinning the
capacity-error shapes that must and must not match; and 3 from `866d557`. Statements
under coverage rose from 4,273 to 4,277 with the same 360 missed, so the percentage is
unchanged at 91.58%. Frontend unchanged at 130 tests and 95.15/90.09/95.24.

### Live index provenance

Read from the live project on 2026-09-03 (read-only): `paper_index_versions` holds five
rows. The three **active** indexes, one per ready paper, are `models/gemini-embedding-001`,
768 dimensions, `document-v1` / `token-v1`, `provenance_status = verified`. The two
remaining rows are `models/gemini-embedding-2` / `legacy_assumed` and are inactive
rollback versions kept by the reindex procedure by design; they are unreachable under the
configured model, which is the intended behaviour of the model filter in `match_chunks`.

### Objective 2 remains gated

Unchanged from the `da9e931` pass: no formal baseline-versus-RAG result exists. All 40
ground truths and all 40 source-thesis fields in `evaluation/golden_dataset.json` are
still `REPLACE:` placeholders, `validated_by_faculty_panel` is `false`, and the 50-thesis
governed corpus, its lock, its receipt and the four PI-08 approvals are outstanding.

## Local revalidation - 2026-09-03, `da9e931`

Measured on Windows 11 against commit `da9e931` with a clean working tree, after the
five remediation commits of 2026-09-02/03 landed on `main` and CI went green on that
revision. Toolchain unchanged from the 2026-09-02 pass (`.venv`, Python 3.14.6,
PyTest 9.1.1, Pylint 4.0.6, Node.js 24.18.0, ESLint 9.39.5). Every figure was read from
the command's **exit code**. Backend counts taken with `ALLOW_DISPOSABLE_SUPABASE_TESTS=0`.
Unlike the 2026-09-02 pass, the browser journeys were re-run locally in this one.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov, enforced `--cov-fail-under=85` | 944 passed and 3 opt-in external integration tests skipped; 91.58% coverage (4,273 statements, 360 missed) | Passed |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests and coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 130 passed; 95.15% lines, 90.09% branches, 95.24% functions | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors, 1 warning (the `Archive.jsx` complexity advisory recorded on 2026-08-30, unchanged) | Passed; one advisory |
| Frontend production build | Vite | Production build completed in 635 ms from a removed `dist/` | Passed |
| Frontend bundle budget | `npm run bundle:budget` | Eager payload 316.9 kB gzipped across 11 files against a 330 kB budget | Passed |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Critical browser journeys and accessibility matrix | Playwright 1.61.1 with @axe-core/playwright 4.12.1, Chromium, 24 tests including the 11-surface axe matrix | 24 passed in 2.1 min | Passed |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Not re-run locally in this pass; green in CI on `da9e931` | Passed in CI |
| Container vulnerability scan | Trivy | Not run locally in this pass; both images green in CI on `da9e931` | Passed in CI |
| Backend dependency vulnerability audit | pip-audit 2.10.1 against `requirements.lock` | Cannot run on this host: `pip-audit` builds the dependency set to resolve it, and `tesserocr` has no wheel here and no Tesseract headers to build one. Green in CI on `da9e931` — see below | Passed in CI |

Every earlier block records this criterion as "Pending re-run", which understated
what was already known. `pip-audit --no-deps -r requirements.lock` has been a step
of the CI Backend job since before the 2026-07-25 pass, with no
`continue-on-error`, so it has passed on every green run. It audits the
hash-pinned lock rather than `requirements.txt`, which covers transitive
advisories too — stronger evidence than the dated local result it was being
compared against. The rows below are left as those passes recorded them.

### CI on `da9e931`

Verified by polling the unauthenticated GitHub check-runs API, not by assumption:
[run 33658152770](https://github.com/Kakko15/Thesis-V1.2/actions/runs/33658152770), check
suite `91212170254`, head `da9e9310e5282ae1eb543744ffd3c7bd4ac62608` — all six checks
`completed` with conclusion `success`: Backend (PyTest + Pylint), Frontend (ESLint +
build), Secret scan, both container vulnerability scans, and SonarQube.

### What changed in the measured system

This pass is the first taken after the defects in
`docs/FIDELITY_AUDIT_2026-09-02.html` were acted on, so the system under
measurement is not the one the earlier passes measured:

- `6162193` — `POST /departments/` supplied the `code` column that
  `20260725_normalized_academic_catalog.sql` makes NOT NULL, so department creation no
  longer fails with an unhandled 500 on a fully migrated project.
- `fc56a23` — the post-login return path, the administrator 2FA challenge, the account
  status badges, and the Content-Security-Policy font origins.
- `47e8a7d` — **relevant to Objective 2.** `match_chunks` and `check_topic_duplication`
  now set `hnsw.ef_search = 100`. Both apply six equality predicates and a similarity
  floor after the HNSW scan has produced its candidates, and a non-iterative scan
  produces at most `ef_search` of them (40 by default), so filtered retrieval could
  return fewer than `match_count` rows while qualifying chunks existed. Any Context
  Precision figure measured before this commit was taken against the narrower behaviour.
  The change is guarded in both schema sources by
  `test_retrieval_rpcs_raise_ef_search_above_the_default` but has **not** been verified
  against a live database.
- `c9160b3` — a late answer no longer lands in the conversation the reader switched to,
  and editing a pending question no longer leaves the superseded wording behind.
- `a1893b1` — manuscript corrections; no effect on the measured system.

### Suite growth since 2026-09-02

Backend rose from **874** passed (the 2026-09-02 post-rename pass recorded at the end of
this file) to **944**, and coverage from 91.17% to 91.58%. Most of that growth is prior
work this file never recorded: no pass was taken at `cc886e5`, eight commits after
`dacc99b`, where the fidelity audit measured 932 passed at 91.51%. The remaining 12 are
this pass's own — 8 from `6162193` covering derived and explicit department codes, the
underivable and over-long cases, and the unique-violation path, and 4 from `47e8a7d`
asserting the `ef_search` setting across two functions in both schema sources. Frontend
rose from 116 to 130: 8 from `fc56a23` and 6 from `c9160b3`, with coverage up from
93.66/88.09/94.29 to 95.15/90.09/95.24 because both commits moved logic out of JSX into
pure modules the unit runner can import directly.

### Objective 2 remains gated

Unchanged, and restated because it is the one figure a reader will look for: no formal
baseline-versus-RAG result exists. `evaluation/golden_dataset.json` holds 40 queries in
which **all 40 ground truths and all 40 source-thesis fields are still `REPLACE:`
placeholders** and `validated_by_faculty_panel` is `false`, so
`validate_formal_dataset` refuses the run by design. The 50-thesis governed corpus, its
lock and its receipt do not exist, and the four PI-08 approvals remain outstanding.
Nothing in this pass changes that; the commits above are engineering remediation only.

## Local revalidation - 2026-09-02

Measured on Windows 11 against commit `dacc99b` with a clean working tree — the
first pass taken at a committed, pushed and CI-green revision rather than mid-change.
Toolchain unchanged from the 2026-09-01 pass (`.venv3146`, Python 3.14.6, PyTest 9.1.1,
Pylint 4.0.6, Node.js 24.18.0, ESLint 9.39.5). Every figure was read from the command's
**exit code**. Backend counts taken with `ALLOW_DISPOSABLE_SUPABASE_TESTS=0`.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov, enforced `--cov-fail-under=85` | 851 passed and 3 opt-in external integration tests skipped; 91.03% coverage (4,138 statements, 371 missed) | Passed |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests and coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 93.66% lines, 88.09% branches, 94.29% functions | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors, 1 warning (the `Archive.jsx` complexity advisory recorded on 2026-08-30, unchanged) | Passed; one advisory |
| Frontend production build | Vite | Production build completed in 859 ms | Passed |
| Frontend bundle budget | `npm run bundle:budget` | Bundle budget OK | Passed |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Not re-run locally in this pass; green in CI on `dacc99b` | Passed in CI |
| Container vulnerability scan | Trivy | Not run locally in this pass; both images green in CI on `dacc99b` | Passed in CI |
| Backend dependency vulnerability audit | pip-audit | Not run in this pass | Pending re-run |

Critical browser journeys and the axe accessibility matrix were **not** re-run
locally in this pass; they run inside the CI Frontend job, which is green on
`dacc99b`. The 2026-09-01 and 2026-08-30 figures stand.

### CI on `dacc99b`

Verified by polling the unauthenticated GitHub check-runs API, not by assumption:
[run 33549370159](https://github.com/Kakko15/Thesis-V1.2/actions/runs/33549370159),
all six checks `completed` with conclusion `success` — Backend (PyTest + Pylint),
Frontend (ESLint + build), Secret scan, both container vulnerability scans, and
SonarQube.

### Suite growth since 2026-09-01

The backend suite grew by **61 tests** (790 to 851) and coverage rose from 90.90% to
91.03%. They arrived with the four test-bearing commits of 2026-09-01/02 — `c574827`
and `1dc0be3` (provider outages excluded from scoring rather than recorded as wrong RAG
answers), `557fbee` (the shared prompt layer in `services/prompts.py` and its parity
tests), and `ba43731` (the `GEMINI_MAX_OUTPUT_TOKENS` correction). The `generation_route`
fingerprint tests from `f28400d` were already counted in the 790, since that work was
present in the working tree when the 2026-09-01 pass was taken. Statement count rose
from 4,078 to 4,138 with missed statements unchanged at 371.

### Objective 2 remains gated

Unchanged from the entries below and restated because it is the one figure a reader
will look for: no formal baseline-versus-RAG result exists. `evaluation/golden_dataset.json`
holds 40 queries of which **40 are still `REPLACE:` placeholders**, `validated_by_faculty_panel`
is not true, and every artifact in `evaluation/results/` carries `formal_result: false`.
The three `comparison_20260901_*` artifacts are 3-query development smokes whose recorded
`dataset_validation_issues` name the placeholder count and the missing faculty validators.

## Local revalidation - 2026-09-01

Measured on Windows 11 against commit `4d216ea` with the documentation and release
fingerprint work of that day present but not yet committed. Toolchain unchanged from
the 2026-08-30 pass (`.venv3146`, Python 3.14.6, PyTest 9.1.1, Pylint 4.0.6, Node.js
24.18.0, ESLint 9.39.5). Every figure was read from the command's **exit code**.
Backend counts taken with `ALLOW_DISPOSABLE_SUPABASE_TESTS=0`.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend functional suitability | PyTest with pytest-cov, enforced `--cov-fail-under=85` | 790 passed and 3 opt-in external integration tests skipped; 90.90% coverage (4,078 statements, 371 missed) | Passed |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests and coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 93.66% lines, 88.09% branches, 94.29% functions | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors, 1 warning (the `Archive.jsx` complexity advisory recorded on 2026-08-30, unchanged) | Passed; one advisory |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771, SonarScanner CLI 7.3.0 in `sonarsource/sonar-scanner-cli` | Quality gate **PASSED** (scanner exit 0). 0 bugs, 0 vulnerabilities, 0 security hotspots. Reliability **A**, Security **A**, Maintainability **A**. Duplication 1.3%. 330 code smells retained as backlog | Passed |
| Backend dependency vulnerability audit | pip-audit | Not run in this pass | Pending re-run |
| Container vulnerability scan | Trivy | Not run in this pass; no image build was performed | Pending re-run |

### Suite growth since 2026-08-30

The backend suite grew by **47 tests** (743 to 790) and coverage rose from 90.56% to
90.90%. Two of the new tests cover `generation_route` in the release fingerprint; the
rest arrived with the 2026-08-31 and 09-01 feature and audit commits.

### Reliability: the first SonarQube run since 2026-07-20

Run locally against SonarQube Community Build **26.7.0.124771** — the same build the
paper's Table 4 names — with both coverage reports supplied. Gate status was read from
the scanner's **exit code** with `sonar.qualitygate.wait=true`, not from the dashboard.

**Result: quality gate PASSED, 0 bugs, 0 vulnerabilities, 0 security hotspots, A/A/A**, with 102 Python and 122 JavaScript/JSX source files analysed, the same backend surface as the first run, so the result is not an artifact of a narrowed scope (see defect 3).

Getting there required fixing four defects in the analysis configuration itself. None
had ever been caught, because the scan had not been run since 2026-07-20.

1. **The virtualenv exclusion did not match the virtualenv.** `sonar.exclusions` listed
   `rag-thesis-backend/.venv/**` while the environment in use is `.venv3146`, so every
   vendored library under it sat inside `sonar.sources`. The glob is now `.venv*/**`.

2. **A full second copy of the source tree was inside the analysis scope.**
   `rag-thesis-backend/tmp-review-py312` holds **411 Python files** — a complete copy of
   the backend. It is gitignored, so a clean CI checkout never sees it, but any local run
   would have analysed it and reported the entire backend as duplicated code. The scratch
   directories are now excluded explicitly.

3. **Frontend unit tests were analysed as production code.** `sonar.tests` named only
   `rag-thesis-backend/tests`; the frontend's tests sit beside the code they cover and so
   cannot be listed there. Two of the three bugs in the first run came from one
   `.test.js` file this way — rules intended for shipped software applied to assertions.
   The obvious fix, `sonar.test.inclusions=**/*.test.js`, is wrong and was reverted.
   That property filters the **entire** test file set rather than the frontend's share
   of it, so a `.js` pattern silently dropped every Python file under `sonar.tests`
   from the analysis: Python files analysed fell from **102 to 59**, and the improved
   ratings from that run were partly an artifact of a smaller analysed surface. The
   frontend tests are instead excluded from *source* analysis by
   `rag-thesis-frontend/src/**/*.test.js` in `sonar.exclusions`, which leaves backend
   test indexing untouched (re-measured: 102 Python files, as before). Their coverage
   is unaffected, arriving through `sonar.javascript.lcov.reportPaths`. A comment in
   `sonar-project.properties` records why the property must not be reintroduced.

4. **Backend Python coverage did not import at all.** The first run reported
   `Cannot resolve 41 file paths, ignoring coverage measures for those files`, and
   whole-repository coverage read **9.5%**. The documented pytest command passes seven
   separate `--cov=` targets, so `coverage.xml` records several absolute `<source>` roots
   with bare filenames such as `activity.py`. This is a local-scan artifact rather than a
   CI defect — GitHub Actions checks out at a fixed path, so the absolute roots resolve
   there — but it makes the report non-portable, and it is worth knowing that a
   whole-repository coverage figure quoted from a local scan may silently exclude the
   backend. For this run the `<source>` roots were remapped to the container's mount
   point; no coverage measure was altered.

Two real code findings survived that cleanup and were fixed rather than suppressed:

- `rag-thesis-frontend/src/components/security/SecurityCheck.jsx` carried a conditional
  returning the same value on both branches (`isPanel ? 'text-xs' : 'text-xs'`), a
  leftover from an earlier size tweak. Collapsed to the single class.
- `rag-thesis-backend/scripts/seed_synthetic_corpus.py` raised four `S2245`
  pseudorandom-generator findings. These are **not** weaknesses: the script seeds an
  obviously-labelled synthetic corpus and `--seed` exists precisely so the corpus is
  reproducible, which a cryptographic generator would defeat. Nothing derived from the
  stream is a secret, token, or access-control identifier. Suppressed with `NOSONAR`
  and that rationale recorded inline, matching the existing convention in
  `dependencies/auth.py`.

**On the whole-repository coverage figure (48.1%).** This is not in tension with the
90.90% backend and 93.66% frontend numbers above, and the difference must be stated
whenever it is quoted. The gated figures measure the modules the gates name; SonarQube
measures everything inside `sonar.sources`, which additionally includes `scripts/`,
`evaluation/`, `migrations/`, and every React component whose behaviour is covered by
Playwright rather than by instrumented unit tests. The comparable historical number is
the 36.3% baseline recorded on 2026-07-20.

### Instrument defect found and corrected: a stale virtual environment

The backend gate was first run in `rag-thesis-backend/.venv` and returned **21
collection errors** with Pylint at **9.99/10, exit 16** — every failure a
`ModuleNotFoundError: No module named 'langchain_openai'`.

The repository is not at fault. That venv holds Python 3.14.3, `langchain-core` 1.4.8
against a pin of 1.5.1, `langchain-google-genai` 4.2.6 against 4.3.1, and no
`langchain-openai` at all, which `requirements.txt:18` has declared since `a50b59b`.
The evidence venv is `.venv3146`, and every result in this file was produced there.

This is the same shape as the 2026-08-30 line-endings defect: **a red local gate
against a green CI**, with a printed score that gives no hint why. It is worth naming
the root cause, because it is structural rather than accidental — `README.md` tells a
new contributor to create `.venv`, while every command block in this file uses
`.venv3146`. Following the README therefore produces an environment the documented
commands never exercise. Delete the stale `.venv` and `.venv312`, or reconcile the two
names, before the next contributor reproduces this.

## Local revalidation - 2026-08-30

Measured on Windows 11 against commit `00e2f69`, with the paper and figure work of
that day present in the working tree but not yet committed. No application source
changed in this pass; the only backend files touched were line-ending
normalizations, verified content-identical with `git diff --numstat`.

Toolchain: Python 3.14.6 (`.venv3146`), PyTest 9.1.1, coverage 7.15.2, Pylint 4.0.6,
Node.js 24.18.0, Vite 8.1.5, ESLint 9.39.5, Playwright 1.61.1, axe-core 4.12.1.
**Interpreter note:** the local venv is 3.14.6 while CI and the container assert
3.14.7 (`.github/workflows/quality.yml:33`, `Dockerfile:27`); `requirements.lock`
resolves against Python 3.14 at the minor level, so the pinned set is identical.

Every figure below was read from the command's **exit code**, not from its printed
summary. Backend counts were taken with `ALLOW_DISPOSABLE_SUPABASE_TESTS=0`.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov, enforced `--cov-fail-under=85` | 743 passed and 3 opt-in external integration tests skipped; 90.56% coverage (3,931 statements, 371 missed) | Passed |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests | Node test runner | 89/89 passed across 7 suites | Passed |
| Frontend coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 93.35% lines, 87.73% branches, 94.20% functions | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors, **1 warning** (see below) | Passed; one advisory |
| Frontend production build | Vite 8.1.5 | Production build completed in 10.65 s | Passed |
| Frontend bundle budget | `npm run bundle:budget` | Bundle budget OK | Passed |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Critical browser journeys and accessibility | Playwright 1.61.1 with Chromium, axe-core 4.12.1 | 24/24 passed in 2.2 min | Passed |
| Backend dependency vulnerability audit | pip-audit | Not run in this pass; requires network access to the advisory database | Pending re-run |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Not run in this pass; no SonarQube server was available | Pending re-run |
| Container vulnerability scan | Trivy | Not run in this pass; no image build was performed | Pending re-run |

### Suite growth since 2026-08-25

The backend suite grew by **32 tests** (711 to 743), the frontend by **4** (85 to 89),
and the Playwright suite by **3 specs** (21 to 24). Backend coverage moved from 91.49%
to 90.56%, a 0.93-point fall from new code landing below the existing average; the
85% gate is unaffected.

### Corrected: the ESLint result is no longer clean

The 2026-08-25 block above records "0 errors and 0 warnings". That was accurate when
measured. `rag-thesis-frontend/src/pages/Archive.jsx` has since changed in commit
`0ce89c6`, and ESLint now reports:

```
src/pages/Archive.jsx:185:16  warning  Function 'Archive' has a complexity of 27. Maximum allowed is 24  complexity
```

It is a warning, not an error, so `npm run lint` still exits 0 and the CI gate still
passes. Recorded here rather than silently carried forward, because the earlier line
would otherwise misdescribe the current build.

### Instrument defect found and corrected: mixed line endings

Pylint initially reported **9.94/10, exit code 16**. Every message was `C0327`
(mixed-line-endings) against `rag-thesis-backend/services/retriever.py`, whose working
copy held 476 CRLF lines mixed into 255 LF ones.

This never reached CI. Every text blob in the repository is stored with LF, and CI
checks out on Linux, so the mixture existed only in the Windows working tree — which
is precisely what made it dangerous: **the local gate was red while CI stayed green,
and the printed score gave no hint why.** A local run quoting 9.94 would have
understated a build that scores 10.00 in the environment that actually gates it.

Fourteen tracked files had drifted (9 CRLF-only, 5 mixed, including
`tests/test_chat_logic.py` and two frontend sources). All were normalized to LF;
`git diff --numstat` confirms **zero content change** in every file not edited for
other reasons. Pylint then returned **10.00/10, exit 0**.

A repository-level `.gitattributes` now pins `* text=auto eol=lf`, so a checked-out
working tree matches CI byte for byte and this class of drift cannot recur silently.
One consequence worth recording: normalizing `evaluation/golden_dataset.json` changed
its bytes and therefore its SHA-256. The dataset is still entirely placeholders and no
formal run has consumed it, so no retained result is invalidated — but the hash is now
fixed ahead of the formal evaluation rather than during it.

## Local revalidation - 2026-08-25

Measured on Windows 11 against commit `733e186` with PyTest 9.1.1, Pylint 4.0.6,
Node.js 24.18.0, Vite 8.1.5 and ESLint 9.39.5. **Interpreter note:** the local
venv is Python 3.14.6 while CI and the container assert 3.14.7
(`.github/workflows/quality.yml:33`, `Dockerfile:27`); `requirements.lock`
resolves against Python 3.14 at the minor level, so the pinned set is identical
either way.

Every figure below was read from the command's **exit code**, not from its
printed summary. Backend counts are the CI-reproducible ones, taken with
`ALLOW_DISPOSABLE_SUPABASE_TESTS=0`.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` in `.venv3146` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov and enforced `--cov-fail-under=85` | 711 passed and 3 opt-in external integration tests skipped; 91.49% coverage (3,690 statements, 314 missed) | Passed |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests | Node test runner | 85/85 passed across 7 suites | Passed |
| Frontend coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 92.95% lines, 86.72% branches, 95.38% functions; lcov fed to SonarQube | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors and 0 warnings | Passed |
| Frontend production build | Vite 8.1.5 | 3,865 modules transformed; production build completed | Passed |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Green in CI on `733e186`; not re-run locally | Passed in CI |
| Container vulnerability scan | Trivy, `--ignore-unfixed --severity CRITICAL,HIGH` | Both images clean in CI on `733e186`. The backend finding **CVE-2026-14456** (OpenSSL DoS, `libcrypto3`/`libssl3` 3.6.3-r3) was cleared on 2026-08-25 by re-pinning the Chainguard base images, which carried the interpreter to 3.14.7 | Passed |

Playwright and the axe accessibility matrix were **not** re-run locally in this
pass. The 2026-08-04 figures below stand, and CI reports the suite green on
`733e186`.

## Local revalidation - 2026-08-04

Measured on Windows 11 with Python 3.14.6, PyTest 9.1.1, Pylint 4.0.6, Node.js 24.18.0, npm 11.16.0, Vite 8.1.5, Playwright 1.61.1 and axe-core 4.12.1. This workstation now matches the pinned CI/container targets (Python 3.14.6, Node 24.18.0), and the active virtual environment is `.venv3146`.

Every figure below was read from the command's **exit code**, not from its printed
summary. Backend counts are the CI-reproducible ones, taken with
`ALLOW_DISPOSABLE_SUPABASE_TESTS=0`: with the flag set, two live
disposable-project checks also run and the totals read 677 passed / 1 skipped.

| Criterion | Instrument | Observed result | Status |
|---|---|---|---|
| Backend dependency consistency | `pip check` in `.venv3146` | No broken requirements found | Passed |
| Backend functional suitability | PyTest with pytest-cov and enforced `--cov-fail-under=85` | 675 passed and 3 opt-in external integration tests skipped; 91.53% coverage | Passed |
| PI-04 catalog controls | PyTest | 8/8 normalized selection, safe legacy/pre-migration translation, no-guess review, nested API, CRUD/archive, additive migration, and rollback contract tests passed | Passed locally |
| PI-08 corpus controls | PyTest + Pylint | 15/15 manifest validation, immutable-locking, no-overwrite, and tamper-evidence tests passed; focused Pylint 10.00/10 | Passed locally |
| Backend maintainability | Pylint | 10.00/10 | Passed |
| Frontend unit tests | Node test runner | 80/80 passed | Passed |
| Frontend coverage | Node test runner with `--experimental-test-coverage`, gated at 85/80/85 | 92.71% lines, 86.23% branches, 95.16% functions; lcov fed to SonarQube | Passed |
| Frontend maintainability | ESLint 9.39.5 | 0 errors and 0 warnings | Passed |
| Frontend production build | Vite 8.1.5 | 3,859 modules transformed; production build completed | Passed |
| Critical browser journeys | Playwright 1.61.1 with Chromium | 21/21 passed (11 accessibility surfaces, 9 critical flows, 1 visual-quality matrix) | Passed |
| Accessibility (WCAG 2.2 AA) | Playwright + axe-core 4.12.1 | 0 blocking (serious/critical) **and 0 advisory** findings across 55 scans: 11 surfaces x 4 theme states at 1280px, plus dark-standard at 360px (wording corrected 2026-09-03; the spec has never run every state at both widths). The 25 advisory `heading-order` findings recorded on 2026-08-03 were five distinct problems counted across five theme/viewport states; all are closed | Passed |
| Frontend production dependency audit | `npm audit --omit=dev` | found 0 vulnerabilities | Passed |
| Backend dependency vulnerability audit | pip-audit | Not re-run in this pass; requires network access to the advisory database. Last dated result (2026-07-25) was clean | Pending re-run |
| Reliability (SonarQube) | SonarQube Community Build 26.7.0.124771 | Not re-run in this pass; no SonarQube server was available. See the 2026-07-20 snapshot below and its recorded qualifications | Pending re-run |

The three skipped backend checks are two explicitly authorized disposable-Supabase integrations and one ClamAV Docker/EICAR integration. The PI-04 migration has not been applied to a disposable Supabase project because no local Supabase CLI/Docker daemon was available. They remain deployment/evidence gates and were not represented as passing. Deployed security-header validation also remains pending because it requires the final deployment URL.

> **Superseded evidence — Objective 2 smoke run.** `evaluation/results/comparison_20260728_140718.json` records `generation_contract.max_output_tokens: 500`, while `config.py` now specifies **2000**. Its fingerprint therefore no longer describes this build and it must not be presented as characterizing the current system. The artifact is retained unaltered as dated evidence; it has to be re-run and re-fingerprinted before the formal evaluation. It was in any case a three-query synthetic development smoke explicitly marked `"formal_result": false`.

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

> **Environment renamed 2026-09-02.** The evidence venv was `.venv3146` throughout
> every dated block above, and those blocks record it as it was. It was renamed to
> `.venv` on 2026-09-02 so the README's setup instructions and the commands below
> finally name the same directory — the mismatch had produced a red local gate
> against a green CI and a worker command that failed outright. Nothing about the
> environment changed but its name: same Python 3.14.6, same pinned packages,
> re-verified after the rename at 874 passed / 3 skipped / 91.17% coverage and
> Pylint 10.00/10, both read by exit code.

```powershell
# Backend: current suite and enforced coverage gate
cd rag-thesis-backend
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pytest `
  --cov=routers --cov=services --cov=dependencies --cov=workers `
  --cov=main --cov=config --cov=models `
  --cov-report=term-missing --cov-report=xml --cov-fail-under=85

# Opt-in disposable-project integration test
$env:ALLOW_DISPOSABLE_SUPABASE_TESTS='1'
.\.venv\Scripts\python.exe -m pytest -m integration -v

# Backend maintainability
.\.venv\Scripts\python.exe -m pylint --rcfile=.pylintrc `
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
