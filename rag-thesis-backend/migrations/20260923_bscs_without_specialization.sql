-- BSCS without a specialization: retire Data Mining (DM) as a BSCS major.
--
-- CCSICT now classifies Computer Science theses by the program alone. Until
-- this migration BSCS carried exactly one specialization, DM, and both the API
-- (services/catalog.py) and the validate_academic_classification trigger from
-- 20260725 required it, so the upload form asked every BSCS uploader to pick
-- from a list of one, and the title-page extractor left the field blank
-- whenever a page omitted the major.
--
-- What this does, in the order the trigger needs:
--
--   1. Redefine validate_academic_classification so a program requires a
--      specialization exactly when it has an active one, instead of naming
--      BSCS and BSIT. A code list disagreed with the catalog the moment a
--      superadmin added or re-activated a major through the catalog API.
--      Must come first: the re-stamps in step 3 fire the trigger.
--   2. Deactivate DM rather than delete it. Every reference is ON DELETE
--      RESTRICT, activity_log rows are history, and the rollback needs the row.
--      Before the re-stamp, because while DM is active BSCS still offers a
--      specialization and clearing a paper's would be refused.
--   3. Clear the DM specialization from every table that references it, and
--      re-stamp papers.track 'Data Mining' -> 'BSCS', which is what
--      resolve_academic_selection now stamps for a BSCS upload. Queued upload
--      jobs are rewritten too, because the hydrate trigger copies
--      request_payload.specialization_id into the paper at commit.
--
-- Not touched: paper_chunks.metadata still records the track the chunk was
-- ingested under. Nothing reads it back -- match_chunks and every retriever
-- select return papers.track -- and rewriting it would touch the index for no
-- behavioural change. Embeddings are unchanged, so no reindex is needed.
--
-- Idempotent: a second run finds no DM references and an inactive DM row.
--
-- Rollback: 20260923_bscs_without_specialization.rollback.sql

begin;

create or replace function public.validate_academic_classification()
returns trigger language plpgsql set search_path = public as $$
declare v_program record; v_specialization record;
begin
  if new.program_id is null then
    if new.specialization_id is not null then raise exception 'Specialization requires a program'; end if;
    return new;
  end if;
  select * into v_program from public.programs where id = new.program_id and active;
  if not found then raise exception 'Unknown or archived program'; end if;
  if new.specialization_id is not null then
    select * into v_specialization from public.specializations
      where id = new.specialization_id and program_id = new.program_id and active;
    if not found then raise exception 'Specialization does not belong to program'; end if;
  end if;
  -- A program takes a specialization exactly when it has an active one, the
  -- rule services/catalog.py and the upload form apply. A specialization that
  -- was given is already known to be active and to belong to this program.
  if new.specialization_id is null and exists (
    select 1 from public.specializations s where s.program_id = new.program_id and s.active
  ) then
    raise exception '% requires a specialization', v_program.code;
  end if;
  return new;
end $$;

do $$
declare
  v_dm uuid;
  table_name text;
begin
  select s.id into v_dm
  from public.specializations s
  join public.programs p on p.id = s.program_id
  join public.departments d on d.id = p.department_id
  where d.code = 'CCSICT' and p.code = 'BSCS' and s.code = 'DM'
  limit 1;
  if v_dm is null then
    return;
  end if;

  update public.specializations set active = false, updated_at = now() where id = v_dm;

  update public.papers
  set specialization_id = null, track = 'BSCS'
  where specialization_id = v_dm;
  -- Pre-catalog rows carry the legacy track with no program id at all.
  update public.papers
  set track = 'BSCS'
  where track = 'Data Mining' and specialization_id is null;

  foreach table_name in array array['profiles', 'chat_sessions', 'scan_history', 'upload_jobs', 'activity_log']
  loop
    execute format(
      'update public.%I set specialization_id = null where specialization_id = $1', table_name
    ) using v_dm;
  end loop;

  update public.upload_jobs
  set request_payload = (request_payload - 'specialization_id')
    || jsonb_build_object('track', 'BSCS')
  where request_payload ->> 'specialization_id' = v_dm::text;

end $$;

commit;
