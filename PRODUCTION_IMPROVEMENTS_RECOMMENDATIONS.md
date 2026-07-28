# Production Improvements & Enhancements — Recommendations

| Control | Value |
|---|---|
| Purpose | Every recommended improvement and enhancement to take the ISU Thesis Library (IskAI) from its current defense-ready state to a real-world production service |
| Baseline | Commit `54cb6e9` (2026-07-28), the joint paper-vs-system audit |
| Grounding | Each item cites the verified observation it addresses, from `PAPER_VS_SYSTEM_COMPARISON.md`, the dated evidence in `docs/evidence/` and `rag-thesis-backend/evaluation/iso25010_evidence.md`, and direct code inspection |
| Authority | This document is advisory. `ISU_ECHAGUE_PRODUCTION_ROADMAP.md` remains the only authoritative ledger for owners, dates, and delivery status. Items overlapping PI-12/PI-13 are marked as such |

## How to read

Every item carries three labels:

- **Priority** — P0 (do before any public production exposure) · P1 (first production quarter) · P2 (maturity) · P3 (nice-to-have)
- **Effort** — S (hours–1 day) · M (days) · L (week+)
- **Phase** — **A**: safe now, before the defense (hardening only — must not touch the frozen evaluated pipeline: chunking, retrieval, prompts, models) · **B**: post-defense pilot (matches roadmap PI-12 scope + operational maturity) · **C**: university scale (matches roadmap PI-13 scope)

> **Hard constraint:** the roadmap freezes the evaluated RAG pipeline until the defense baseline (PI-11, target 2026-08-28) is locked. No Phase A item below changes retrieval behavior, prompts, models, or chunking. Anything that does is deliberately placed in Phase B or C.

---

## 1. Top 10 highest-impact items

| # | Item | Why it matters most | Priority | Effort | Phase |
|---|---|---|---|---|---|
| 1 | Enforce `@isu.edu.ph` signup allowlist server-side (§4.1) | Today anyone with any email can create a student account; the domain appears only as placeholder text | P0 | S | A |
| 2 | Load-test the actual `/chat` RAG path (§2.5) | The measured JMeter evidence never exercised chat; production capacity for the core feature is unknown | P0 | M | A/B — **rig implemented 2026-07-28** (`jmeter/chat_load.jmx`); measured run still pending a disposable project |
| 3 | Multi-process API + externalized runtime state (§2.1) | Single uvicorn process is the whole API; one CPU-bound request degrades everyone | P0 | M | B |
| 4 | Prometheus metrics + dashboards + paging (§3.1) | Operations data already exists in code but is only visible in a superadmin tab; nobody gets woken up when it breaks | P1 | M | B |
| 5 | Scheduled automated encrypted backups + drill cadence (§6.1) | Backup tooling is excellent but manual; production needs unattended schedule + tested RTO/RPO | P1 | S | A |
| 6 | Gemini paid tier + quota strategy (§2.4) | Free-tier quotas and data-use terms are the single biggest availability and privacy constraint for real users | P0 | S–M | B |
| 7 | Server-side archive pagination/search (§2.2) | `GET /papers` ships the whole catalog to the browser; breaks at real corpus sizes | P1 | M | B |
| 8 | Hybrid retrieval + reranking (§5.1) | Known best-practice quality jump for specialized vocabulary; already planned as PI-12 | P1 | L | B |
| 9 | Turnstile (or equivalent) on guest chat (§4.2) | Guest chat spends Gemini quota with only IP+guest-ID rate limits between the public internet and the bill | P1 | S | A — **✅ implemented 2026-07-28**, config-gated (enable via `TURNSTILE_SECRET_KEY`) |
| 10 | Ragas regression smoke in CI with synthetic data (§5.4) | The scoring path has never executed non-empty; PI-10 defense evaluation depends on it working | P1 | S | A — **✅ smoke executed 2026-07-28**; found and fixed 2 harness defects |

---

## 2. Reliability & scalability

### 2.1 Multi-process API and externalized per-process state — P0 · M · Phase B
**Observed:** the API container runs a single uvicorn process (`rag-thesis-backend/Dockerfile:49`, no `--workers`). Three pieces of state live in process memory: the 60 s role cache and role-features cache (`dependencies/auth.py:23-24, 265-289`) and the Gemini capacity-cooldown circuit breaker (`routers/chat.py` + `gemini_capacity_cooldown_seconds`).
**Recommend:** run ≥2 workers (`uvicorn --workers` or replicated containers behind the tunnel). Before scaling out, move the capacity-cooldown flag into Redis (already a production dependency for rate limits) so one replica's 429 cooldown protects all replicas; the two 60 s caches are safe per-replica (worst case: one extra role lookup per replica per minute). Add `--limit-concurrency` and a request timeout aligned with the 25 s Gemini budget.

### 2.2 Server-side pagination, filtering, and search for the archive — P1 · M · Phase B
**Observed:** `GET /papers` returns every row; `Archive.jsx` filters in memory; admin tables paginate client-side only. Fine at 50 theses, not at 5,000 (the paper itself says the architecture "is designed to scale incrementally").
**Recommend:** add `limit/offset` (or keyset) + `q`, `program_id`, `specialization_id`, `year` params to `routers/papers.py`, backed by a `tsvector` GIN index over title/authors/abstract (metadata search only — full text stays indirect). Reuse the response shapes the frontend already consumes; wire `useArchiveCatalog.js` to server queries with React Query's infinite query.

### 2.3 pgvector index management as the corpus grows — P2 · S · Phase B
**Observed:** HNSW cosine index exists (`supabase_setup.sql:289-290`) with default build/search parameters.
**Recommend:** when the corpus exceeds a few hundred papers, benchmark `hnsw.ef_search` (session-settable in the `match_chunks` RPC) for recall-vs-latency, document chosen values in the release fingerprint, and add an index-health check (size, dead tuples) to the operations summary. No change needed before defense.

### 2.4 Gemini paid tier, quotas, and graceful degradation — P0 (before public launch) · S–M · Phase B
**Observed:** the deployment strategy is "free defense profile; paid university profile after defense" (roadmap). Free-tier quotas already required a capacity circuit breaker, and PI-08 restricts what content may reach the unpaid tier at all.
**Recommend:** for any real user base, move to the paid tier (removes the data-for-training concern that PI-08 spends pages mitigating, and raises rate limits). Set per-day token budgets per role in config; extend the existing cooldown into a tiered degradation path (queue → shorter answers via `gemini_max_output_tokens` → explicit "capacity reached" message, which already exists). Track spend via the LangSmith token counts already captured.

### 2.5 Load-test the real RAG chat path — P0 · M · Phase A (test rig) / B (with real corpus)
**Observed:** the JMeter evidence (900/900, p95 204 ms) exercised only `/health`, `/upload/tracks`, `/analytics/summary` (`jmeter/provider_independent_load.jmx`); live Gemini smoke was 3 single-user calls against an empty corpus. Chat concurrency capacity is unmeasured.
**Recommend:** add a `chat_load.jmx` profile posting realistic guest questions at 5/10/20 concurrent users against a disposable project with a seeded synthetic corpus; measure p95/p99 end-to-end and the rate-limit/429 envelope; run it via the existing `evaluation/summarize_jmeter.py`. Rerun against the production corpus after PI-10 so the ISO Performance Efficiency claim covers the core feature.

> **Status (2026-07-28): rig implemented.** `jmeter/chat_load.jmx` exists (parameterized users/loops/ramp, stable per-thread guest IDs, 60 s response timeout) with usage and quota caveats in `jmeter/README.md`. The measured evidence run against a disposable project remains pending.

### 2.6 Worker fleet scale-out documentation — P2 · S · Phase B
**Observed:** the leased job queue already supports N workers safely (PostgreSQL leases, heartbeats, idempotent commit), but compose runs exactly one worker and no doc states the scaling contract.
**Recommend:** document and test 2-worker operation (`docker compose up --scale worker=2`), including alert thresholds (`operations_queue_depth_threshold`) tuned for the fleet size.

### 2.7 SLOs and error budget — P1 · S · Phase B
**Recommend:** define and publish 3 SLOs (chat availability, chat p95 latency, ingestion completion time), measured from the metrics in §3.1. The roadmap's "honest about its lack of an SLA" stance stays true for the free profile; SLOs become the internal target that Phase C's SLA (PI-13) is later contracted from.

---

## 3. Observability

### 3.1 Metrics endpoint + dashboards + paging — P1 · M · Phase B
**Observed:** rich operational data already exists (`services/operations.py` computes queue depth, worker staleness, retries, cleanup lag; LangSmith spans capture per-stage latency) but is only visible in the superadmin Operations tab and optional HMAC webhooks. There is no `/metrics`, no dashboards, no on-call notification.
**Recommend:** expose Prometheus metrics from both API and worker (request counts/latency histograms, queue gauges, Gemini error/cooldown counters, ingestion stage durations); add Grafana + Alertmanager (or a hosted equivalent) to `docker-compose.operations.yml`; route the existing webhook alerts to email/Slack. Keep the privacy posture: metrics are numeric only, never content.

### 3.2 Log aggregation — P2 · S–M · Phase B
**Observed:** logs are privacy-filtered (`services/safe_logging.py`) but land only in container stdout.
**Recommend:** ship container logs to a store with retention (Loki/CloudWatch/hosted). The existing `PrivacyFilter` makes this safe; add a log-based alert for `ERROR` bursts.

### 3.3 Uptime + certificate monitoring — P1 · S · Phase A
**Recommend:** external synthetic checks (UptimeRobot/healthchecks.io tier is fine) against `/health`, `/ready`, `/health/worker`, and the public frontend, plus TLS expiry monitoring on the tunnel hostname. This is free and can be live before the defense demo.

### 3.4 Decide the tracing end-state — P2 · S · Phase B
**Observed:** LangSmith tracing is implemented privacy-safe but off by default; the free tier has retention/volume limits.
**Recommend:** either budget LangSmith paid for production volumes or migrate the `safe_trace()` wrapper to OpenTelemetry GenAI semantic conventions exported to your own collector; the wrapper (`services/observability.py`) is the single seam, so the swap is contained.

---

## 4. Security & compliance

### 4.1 Enforce institutional email domain at signup — P0 · S · Phase A
**Observed:** `@isu.edu.ph` appears only as UI placeholder text; `isValidEmail` accepts any address (`src/pages/auth/authUtils.js:5-9`); the DB trigger constrains role/department but not domain.
**Recommend:** enforce server-side in `handle_new_user()` (`supabase_setup.sql:43-70`) — reject or auto-`pending` non-`@isu.edu.ph` signups (guest mode already covers outsiders); mirror with a friendly client-side message. Keep a superadmin bypass path for panelists/librarians without ISU addresses if needed.

### 4.2 Bot/abuse protection on guest chat — P1 · S · Phase A
**Observed:** Turnstile protects auth flows only; guest chat is protected by 30/min-per-guest + 300/min-per-IP rate limits. A scripted guest can still burn daily Gemini quota from rotating IPs.
**Recommend:** require a Turnstile token on the first guest chat request per session (verify server-side in `get_optional_user` or a dedicated dependency), plus a global daily guest-token budget breaker in Redis. Both are additive and safe pre-defense (they gate access; they do not alter the evaluated pipeline).

> **Status (2026-07-28): ✅ implemented, config-gated.** `services/turnstile.py` verifies one token per guest session against Cloudflare (fail-closed, TTL-cached, in-process — move the cache to Redis with §2.1) and the `/chat` route enforces it via `ensure_guest_chat_verification()`; the widget appears once in the guest banner (`Chat.jsx`). Off by default: enable by setting `TURNSTILE_SECRET_KEY` (backend) with `VITE_TURNSTILE_SITE_KEY` (frontend). The evaluation harness's direct `_chat_impl` path is untouched. The global daily guest-token budget breaker remains open.

### 4.3 Supply-chain hardening — P1 · M · Phase A
**Observed:** direct Python deps are exact-pinned but transitive deps are not hash-locked; base images use tags not digests (comparison report §9); no SBOM or image signing. CI already runs pip-audit, npm audit, Trivy, Gitleaks.
**Recommend:** generate `requirements.lock` with `pip-compile --generate-hashes` and install with `--require-hashes`; pin `FROM` images by digest; add `cosign` signing and SBOM (syft) steps to the container jobs in `.github/workflows/quality.yml`; enable Dependabot security-only auto-PRs for the lock file.

### 4.4 Secrets management — P1 · S–M · Phase B
**Observed:** production compose loads secrets from `.env` files on the defense PC; the rotation runbook (`docs/SECRET_ROTATION.md`) is good but manual.
**Recommend:** move to the hosting platform's secret store or Docker secrets (compose supports `secrets:`); scope a separate service-role key per process where Supabase allows; record rotation events as `security_audit_events` (table already exists).

### 4.5 Edge protection for the public host — P1 · S · Phase B
**Observed:** planned exposure is Cloudflare Pages + outbound-only tunnel (roadmap §4), which is a strong baseline.
**Recommend:** add Cloudflare WAF managed rules + rate rules in front of the tunnel, country/ASN throttles if abuse appears, and turn on bot-fight mode for the API hostname. Validate headers post-deploy with the existing `npm run security:headers`.

### 4.6 Independent security assessment — P1 · M · Phase B
**Recommend:** before opening to the whole university, commission at least one manual penetration test focused on IDOR on session/scan/job resources, prompt-injection → citation integrity, storage-policy bypass attempts, and MFA/AAL2 downgrade paths. The self-assessments are strong; an external pass is the production bar.

### 4.7 Data Privacy Act operationalization — P0 (legal) · M · Phase A→B
**Observed:** PI-08 protocol is thorough but pending; retention enforcement is intentionally disabled; NPC registration is not mentioned anywhere.
**Recommend:** complete the PI-08 approvals, then: register the processing system with the National Privacy Commission if required for ISU's context, publish a user-facing privacy notice page in the frontend, wire the breach-notification path into the incident playbook (72-hour NPC rule), and activate retention (`RETENTION_ENFORCEMENT_ENABLED=true`) once the policy is signed.

---

## 5. RAG quality (all pipeline changes are Phase B — after the defense baseline is frozen)

### 5.1 Hybrid retrieval + reranking (roadmap PI-12) — P1 · L · Phase B
**Observed:** retrieval is pure cosine top-5 ≥ 0.30; no lexical channel, no reranker. Acronyms, author names, and exact course codes are exactly where dense retrieval is weakest (the paper's own literature review cites Arivazhagan et al. 2023 on this).
**Recommend:** add a `tsvector` lexical channel in `match_chunks` (or a sibling RPC), fuse with Reciprocal Rank Fusion, then rerank the top ~20 with the existing verdict-model pattern (`gemini-3.5-flash-lite` listwise) or a hosted reranker. Version it through `paper_index_versions` + the release fingerprint so evaluated-vs-enhanced pipelines stay distinguishable — the provenance machinery for this already exists.

### 5.2 Semantic response cache — P2 · M · Phase B
**Observed:** no response caching; every question pays embedding + retrieval + generation. Student query distributions are heavily repetitive around title-defense season.
**Recommend:** Redis cache keyed by (normalized question embedding ≥ ~0.97 similarity, department, index fingerprint), TTL hours, invalidated on `activate_paper_index`. Cache only grounded answers with their citation sets; never cache duplication alerts.

### 5.3 Citation entailment sampling — P1 · M · Phase B
**Observed:** citation validation is structural, not semantic — documented honestly in `services/citations.py` and the ISO evidence ("does not prove semantic entailment").
**Recommend:** background-sample N% of answers: verdict model checks "is claim X supported by cited chunk Y?" and logs an entailment score to `activity_log`/metrics. This converts the documented limitation into a monitored quality signal and gives faculty an audit trail; it changes nothing in the response path.

### 5.4 Ragas regression smoke in CI — P1 · S · Phase A
**Observed:** the Objective 2 harness is hardened but the Ragas scoring call has never run non-empty (open caveat in `PAPER_VS_SYSTEM_COMPARISON.md` appendix). PI-10 depends on it.
**Recommend:** a small opt-in CI job (or pre-PI-10 checklist step) that installs `evaluation/requirements-eval.txt` in `.venv3146`-equivalent, runs `--allow-unvalidated` over 2–3 synthetic queries with synthetic contexts, and asserts finite metric values. Uses no real thesis content, so it is PI-08-safe.

> **Status (2026-07-28): ✅ smoke executed end to end.** `evaluation/dev_smoke_dataset.json` (3 synthetic queries) ran through the deployed guest RAG path and full Ragas 0.4.3 scoring — Answer Correctness on both pathways, Faithfulness/Context Precision on real retrieved contexts (n=3), Shapiro-Wilk → paired t-test. It caught and fixed two harness defects before PI-10 could hit them: ragas' google provider is synchronous-only (evaluator switched to Gemini's OpenAI-compatible endpoint with `AsyncOpenAI`) and a numpy-bool JSON-serialization crash. Non-formal evidence: `evaluation/results/comparison_20260728_140718.json`. A recurring opt-in CI job remains optional follow-up.

### 5.5 Answer feedback loop — P2 · S–M · Phase B
**Observed:** no thumbs-up/down or "was this helpful" anywhere in the frontend (verified absent).
**Recommend:** add per-answer feedback buttons posting to a `chat_feedback` table (reuse the `activity_log` insert pattern and RLS posture), surfaced in the admin analytics tab. This is the cheapest source of retrieval-quality ground truth for tuning §5.1.

### 5.6 Retrieval drift monitoring — P2 · S · Phase B
**Recommend:** log (numeric-only) per-query top-similarity and no-result rates to metrics; alert when the no-result rate or mean top-similarity shifts materially after ingestions — early warning for corpus or index problems. `_top_similarity` is already computed in `routers/chat.py`.

### 5.7 Embedding/model upgrade path — P2 · S (process) · Phase B/C
**Observed:** the hard-won provenance system (`paper_index_versions`, fingerprint checks, staged `activate_paper_index`/rollback) already makes re-embedding safe; what is missing is only cadence and criteria.
**Recommend:** write a one-page policy: when Google announces embedding/model deprecations, run staged re-index in a disposable project, compare the Ragas mini-suite (§5.4) old-vs-new, then promote. No new code needed.

---

## 6. Data lifecycle & disaster recovery

### 6.1 Scheduled automated backups + measured RTO/RPO — P1 · S · Phase A
**Observed:** `scripts/backup_system.ps1` (encrypted, hash-reported) and the disposable restore drill are excellent but manual and unscheduled.
**Recommend:** schedule the backup nightly (Windows Task Scheduler now; a cron container in Phase B) with a stored-passphrase pattern from §4.4, alert on backup failure/staleness via §3.1, and run the restore drill quarterly, recording measured RTO/RPO against declared targets (suggest RPO 24 h, RTO 4 h for the pilot).

> **Status (2026-07-28): ✅ tooling implemented.** `scripts/scheduled_backup.ps1` (unattended wrapper, DPAPI-protected passphrase, transcript logging, prune-after-success), `scripts/register_backup_task.ps1` (nightly 02:00 task registration), and `scripts/check_backup_freshness.ps1` (48 h staleness gate), documented in `docs/OPERATIONS_SECURITY_RUNBOOK.md`. Remaining: the operator's one-time passphrase-file creation and task registration on the backup machine.

### 6.2 Supabase PITR + storage growth — P2 · S · Phase B/C
**Recommend:** on the paid Supabase tier enable point-in-time recovery (tightens RPO to minutes) and add storage-growth metrics (papers × chunks × vectors) to the operations summary so capacity is planned, not discovered.

### 6.3 Retention activation — P1 (after approval) · S · Phase B
**Observed:** dry-run tooling and the 30/90/365-day matrix are done; enforcement is correctly blocked on institutional approval.
**Recommend:** once approved, enable `RETENTION_ENFORCEMENT_ENABLED=true`, schedule `apply_operations_retention` (the RPC exists), and add a monthly "retention applied" report artifact for the compliance file.

---

## 7. Engineering process & quality

### 7.1 Coverage and static-analysis debt — P1 · M · Phase A
**Observed:** overall backend coverage is 85.86%, but `routers/chat.py` is 70.3% and `routers/upload.py` 70.9% — the two most complex request paths. Sonar carries 280 legacy code smells, whole-repo coverage 36.3% (frontend uncovered), and the gate passed with `ignoredConditions: true`.
**Recommend:** target ≥85% on those two routers specifically (error paths, cancellation races); burn down the smell backlog in small PRs; then re-run Sonar without ignored conditions so the Reliability evidence is unqualified. Add frontend coverage reporting (`node --test --experimental-test-coverage`) to CI so the 36.3% whole-repo number stops hiding frontend gaps.

> **Status (2026-07-28): ✅ router coverage done.** `tests/test_router_error_paths.py` (55 tests) lifts `routers/chat.py` to **97.0%** and `routers/upload.py` to **91.2%**; whole-backend coverage rose from 86.13% to **90.73%** (424 passed + 3 skipped). The Sonar smell burn-down and frontend coverage reporting remain open.

### 7.2 Staging environment + safe deploys — P1 · M · Phase B
**Observed:** validation currently uses disposable Supabase projects (good) but there is no persistent staging, and deploys are docker-compose restarts.
**Recommend:** a permanent staging stack (separate Supabase project + tunnel hostname) receiving every merge to `main`; production promotes a tested image digest. With ≥2 API replicas (§2.1), rolling restarts give zero-downtime deploys; document rollback = redeploy previous digest (fingerprints in `scripts/release_fingerprint.py` already identify builds).

### 7.3 CI contract and E2E tightening — P2 · S · Phase A
**Observed:** OpenAPI snapshot + SHA (`scripts/export_openapi.py`, `docs/evidence/contracts/`) exists but CI does not fail on drift; Playwright runs but branch protection/required checks are not documented.
**Recommend:** add a CI step that regenerates the OpenAPI snapshot and fails on unexplained diff; enable GitHub branch protection requiring the quality workflow; add the §2.5 chat load profile as a scheduled (weekly) workflow rather than per-push.

> **Status (2026-07-28): ✅ drift gate live.** `docs/evidence/contracts/iskai-openapi.current.json` is the tracked contract and `tests/test_export_openapi.py` fails the suite (and therefore CI) on any unexplained schema drift — it immediately caught that the July 25 snapshot still advertised the two removed `DuplicationAlert` fields. Dated snapshots stay immutable. Branch protection and the scheduled load test remain open.

### 7.4 Release checklist automation — P3 · S · Phase B
**Recommend:** a small script that assembles the release evidence bundle (fingerprint, coverage, Sonar export, JMeter summaries, corpus receipt when locked) into one dated folder — today this is assembled by hand across `docs/evidence/` and `evaluation/results/`.

---

## 8. Product & UX enhancements

| Item | Detail | Priority | Effort | Phase |
|---|---|---|---|---|
| SSE streaming chat | Roadmap PI-12; token streaming via FastAPI `StreamingResponse`; keep the non-streaming path for the frozen evaluation | P1 | M | B |
| Archive detail route + shareable links | `/thesis/:id` metadata-only page (modal exists today); enables citations/bookmarks; respects indirect access | P2 | S | B |
| Email notifications | Approval/rejection and upload-complete mail via Supabase auth SMTP; today users must poll the UI | P1 | S | B |
| Bulk upload | Multi-file queue UI over the existing durable job API (backend already handles queued jobs safely) | P2 | M | B |
| Exportable cited answers | "Export answer (PDF/print view)" with citation list — supports RRL workflows; metadata + answer only | P2 | S | B |
| Admin model/config panel | Superadmin+MFA view of the release fingerprint values and staged re-index trigger (`scripts/reindex_citations.py` exists as CLI) | P2 | M | B |
| PWA shell | Roadmap PI-12; installable, offline shell for metadata browsing only (chat requires network by design) | P3 | M | B |
| Filipino i18n | i18n scaffold + Filipino strings; matters for university-wide adoption | P3 | M | C |
| Full WCAG 2.2 AA + device matrix | Roadmap already flags the full matrix pending; commission a formal audit before university scale | P1 | M | B |
| Onboarding tour + empty-state guidance | First-run guest walkthrough of chat/citations/novelty; cheap adoption win | P3 | S | B |

---

## 9. University scale (Phase C — matches roadmap PI-13)

1. **SSO** — OIDC/SAML against ISU's identity provider via Supabase Auth external providers; map role/department claims into the existing `profiles` model; keep local accounts as fallback during migration. (P1 for Phase C, L)
2. **Multi-department activation** — the PI-04 normalized catalog (departments → programs → specializations) already models this; write the activation runbook: seed department, assign delegated admins, set per-department feature flags and quotas, verify RLS/scoping tests per department. (P1, M)
3. **Delegated administration & quotas** — per-department admin role scoped by the existing department boundary checks; per-department Gemini/token budgets in Redis. (P2, M)
4. **Paid managed platform** — Supabase Pro (PITR, support), managed Redis, container hosting with autoscaling + multi-replica HA; replace the school-PC/tunnel topology without changing contracts (the roadmap explicitly designed for this swap). (P1, L)
5. **Formal SLA** — contract an SLA only after two quarters of SLO data (§2.7); publish status page. (P2, S)
6. **Cost model** — a maintained sheet: Gemini paid-tier per-1k-queries cost (from LangSmith token telemetry), Supabase tier, hosting, ClamAV/Redis nodes; review quarterly. (P1, S)

---

## 10. Already production-grade — preserve, do not rebuild

These subsystems were verified strong during the audit; future work should extend, not replace them:

- **Durable leased ingestion** (PostgreSQL job queue, heartbeats, idempotency, cooperative cancellation, atomic commit, cleanup recovery)
- **Authorization posture** (RLS deny-by-default, column-level profile protection, service-role-only RPCs, department scoping, MFA/AAL2 for privileged roles, fail-closed pending/rejected gating)
- **Indirect-access enforcement** (private bucket + restrictive storage policy + metadata-only APIs + no frontend full-text surface)
- **Index provenance** (`paper_index_versions`, fingerprint checks blocking cross-embedding retrieval, staged activation/rollback)
- **Privacy engineering** (PII redaction at ingestion, privacy-filtered logging, hidden-payload LangSmith tracing, metadata-only duplication alerts)
- **Evidence discipline** (dated, hashed evidence bundles; fail-closed evaluation harness; release fingerprints; immutable corpus manifest tooling)
- **Backup/restore/rotation runbooks** (encrypted backups, local-only restore drills, secret-rotation sequences)

---

## 11. Suggested sequencing

1. **Now → defense (Phase A, no pipeline changes):** §4.1 email allowlist (deferred by researcher decision 2026-07-28 — any email may register for now) · §4.2 guest-chat Turnstile ✅ done 2026-07-28 · §6.1 scheduled backups ✅ tooling done 2026-07-28 (one-time operator passphrase/task setup pending) · §3.3 uptime checks · §5.4 Ragas smoke ✅ done 2026-07-28 · §2.5 chat load-test rig ✅ done 2026-07-28 (measured run pending) · §4.3 supply-chain hardening · §7.1 chat/upload coverage ✅ done 2026-07-28 (97.0% / 91.2%; Sonar smell burn-down still open) · §7.3 OpenAPI drift gate ✅ done 2026-07-28 (branch protection + scheduled load test still open)
2. **Defense (2026-08-28):** PI-08/09/10/11 per the roadmap — untouched by this document
3. **First post-defense quarter (Phase B):** §2.1 multi-worker API · §2.4 Gemini paid tier · §3.1 metrics/dashboards/paging · §2.2 archive pagination · §5.1 hybrid retrieval + reranking · SSE streaming · email notifications · §7.2 staging + safe deploys · §4.4–4.6 secrets/WAF/pen-test · §6.3 retention activation · WCAG audit
4. **University scale (Phase C):** SSO · multi-department activation · paid HA platform · SLA + status page · i18n · cost governance
