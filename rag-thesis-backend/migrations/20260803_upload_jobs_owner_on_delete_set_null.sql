-- Let an uploader's account be deleted without destroying ingestion provenance.
--
-- upload_jobs.owner_id was NOT NULL referencing auth.users ON DELETE RESTRICT, so
-- deleting any user who had ever uploaded aborted the delete and administrators
-- saw an opaque 500 with nothing pointing at the cause. Cascading is the wrong
-- answer: the job history is the audit trail behind every indexed thesis and has
-- to outlive the account. The row is kept and the owner is cleared instead.
--
-- Dropping NOT NULL is required, not incidental — ON DELETE SET NULL against a
-- NOT NULL column still aborts the delete, just with a different error.
--
-- New jobs are unaffected: stage_upload_job rejects a null p_owner_id, so a null
-- owner only ever means "the account that created this job is gone". The unique
-- index on (owner_id, idempotency_key) keeps working because Postgres treats
-- NULLs as distinct, and orphaned rows are historical rather than deduplicated
-- against.
--
-- Safe to apply repeatedly.

begin;

alter table public.upload_jobs alter column owner_id drop not null;

alter table public.upload_jobs drop constraint if exists upload_jobs_owner_id_fkey;
alter table public.upload_jobs
  add constraint upload_jobs_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete set null;

commit;
