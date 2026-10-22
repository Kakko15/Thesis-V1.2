-- Capsule proposal screening in Novelty Review.
--
-- A capsule is the short proposal an adviser reviews before a manuscript
-- exists: working title, rationale and significance, objectives, methodology.
-- POST /duplication/capsule screens each section against the archive on its
-- own (services/capsule.py explains why a capsule is not screened as a
-- manuscript) and stores the result in scan_history like any other scan, so
-- the report, the metadata export and the follow-up chat need no second path.
--
-- The per-section result has no existing column to live in, so it gets one.
-- Null marks a manuscript scan. Metadata only -- section, similarity, and the
-- closest archived thesis's title -- because the column is returned to the
-- client; the archived excerpts that ground the follow-up chat stay in
-- matched_chunks, which never is.
--
-- Additive and idempotent. GET /duplication/history retries without the
-- column when Postgres reports it missing, so the API can be deployed first;
-- POST /duplication/capsule answers 503 until this is applied.
--
-- Rollback: 20260923_scan_history_capsule.rollback.sql

begin;

alter table public.scan_history add column if not exists capsule_sections jsonb;

commit;
