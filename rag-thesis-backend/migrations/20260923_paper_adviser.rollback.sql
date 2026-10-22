-- Revert 20260923_paper_adviser.sql: stop hydrating the adviser and drop the
-- column, including any values the backfill wrote.
--
-- The application survives this without a redeploy. GET /papers retries
-- without the adviser column when Postgres reports it missing, and the upload
-- request payload keeps carrying the key harmlessly, since nothing reads it once
-- the trigger is gone.

begin;

drop trigger if exists a_papers_hydrate_adviser on public.papers;
drop function if exists public.hydrate_paper_adviser();
alter table public.papers drop column if exists adviser;

commit;
