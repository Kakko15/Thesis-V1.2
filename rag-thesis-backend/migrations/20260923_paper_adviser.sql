-- The thesis adviser, recorded on each paper for the Thesis Library.
--
-- The archive card and detail modal showed title, authors, year, category and
-- program, but not who advised the study, which is the other name a researcher
-- looks a thesis up by. The adviser is optional at upload and autofilled from
-- the manuscript's own front matter when it names one (routers/upload.py,
-- _extract_adviser).
--
-- Additive and idempotent. Existing rows stay null until
-- scripts/backfill_paper_advisers.py reads the adviser from their archived PDF.
--
-- Retrieval is untouched: match_chunks, check_topic_duplication,
-- commit_paper_ingestion and the chunk metadata are not redefined, so the
-- evaluated pipeline resolves exactly as before and no index is rebuilt.
--
-- commit_paper_ingestion inserts a fixed column list, so the value arrives the
-- way thesis_category does: a BEFORE INSERT trigger reading the upload job's
-- request_payload by new.id (a paper's id is its job's id). It is a separate
-- function rather than one more line in hydrate_paper_academic_classification
-- on purpose. That function is already redefined by 20260819, and adding this
-- to a third copy would mean replaying 20260819 later silently stops hydrating
-- the adviser -- the out-of-order hazard the README warns about. Triggers of
-- one timing fire in name order, so this runs right after that one.
--
-- No upload_jobs mirror column: request_payload is the carrier, and the
-- thesis_category mirror that precedent added is never written by any code.
-- No length CHECK either: the API caps the field at 200 characters, and a
-- violation here would surface inside commit_paper_ingestion, after OCR and
-- embedding had already been paid for.
--
-- Rollback: 20260923_paper_adviser.rollback.sql

begin;

alter table public.papers add column if not exists adviser text;

create or replace function public.hydrate_paper_adviser()
returns trigger language plpgsql set search_path = public as $$
declare v_payload jsonb;
begin
  select request_payload into v_payload from public.upload_jobs where id = new.id;
  if v_payload is not null then
    new.adviser := coalesce(nullif(btrim(v_payload ->> 'adviser'), ''), new.adviser);
  end if;
  return new;
end $$;

drop trigger if exists a_papers_hydrate_adviser on public.papers;
create trigger a_papers_hydrate_adviser before insert on public.papers
for each row execute function public.hydrate_paper_adviser();

commit;
