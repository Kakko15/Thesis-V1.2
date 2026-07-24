# PI-04 Verification — 2026-07-25

## Result

**VERIFIED.** The normalized CCSICT academic catalog passed reversible migration, preservation, isolation, integrity, idempotency, contract, and live API gates against the explicitly authorized disposable Supabase project.

## Verified gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Additive migration | PASS | Migration completed without an SQL error. |
| Catalog seed | PASS | 5 programs and 3 specializations matched the approved CCSICT catalog. |
| Reference integrity | PASS | 0 orphan specializations, program references, or invalid specialization/program pairs. |
| Legacy preservation | PASS | 0 changed legacy tracks. |
| RLS isolation | PASS | RLS enabled; `anon` and `authenticated` denied; `service_role` permitted. |
| Rollback | PASS | Catalog tables removed and all six measured legacy-table row counts preserved. |
| Idempotent reapply | PASS | The complete migration was reapplied twice without an SQL error. |
| Catalog contracts | PASS | 8/8 focused PyTest checks passed on Python 3.14.6. |
| Live API | PASS | HTTP 200, contract `2026-07-25`, CCSICT and the exact approved catalog returned. |

## Preserved row counts

| Table | Before rollback | After rollback |
| --- | ---: | ---: |
| profiles | 1 | 1 |
| papers | 1 | 1 |
| chat_sessions | 1 | 1 |
| scan_history | 0 | 0 |
| upload_jobs | 1 | 1 |
| activity_log | 36 | 36 |

## Approved CCSICT catalog

- BSCS — Data Mining
- BSIT — Web and Mobile Application Development; Network and Security
- BSDSA
- BSIS
- BLIS

Other departments and programs remain explicitly deferred until after the defense.

## Evidence bundle

- [Migration success](manual-20260725/01-migration-success.png)
- [RLS isolation](manual-20260725/02-rls-isolation.png)
- [Reference integrity and preserved catalog](manual-20260725/03-reference-integrity.png)
- [Rollback count preservation](manual-20260725/04-rollback-counts.png)
- [Eight focused catalog tests](manual-20260725/05-catalog-tests.png)
- [Live API verification](manual-20260725/06-live-api.png)
- [Machine-readable live report](live-20260725-051646/catalog-live-smoke.json)
- [Live evidence summary](live-20260725-051646/SUMMARY.md)

No credentials or database row contents are retained in the machine-readable live report.
