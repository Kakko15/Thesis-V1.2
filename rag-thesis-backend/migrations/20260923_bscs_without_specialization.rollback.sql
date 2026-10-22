-- Revert 20260923_bscs_without_specialization.sql: BSCS requires DM again.
--
-- Order is the reverse of the forward file, for the same trigger reason: the
-- 20260725 rule (BSCS and BSIT take a specialization) must be back before the
-- re-stamp, or setting DM on a BSCS paper is refused as "does not accept a
-- specialization".
--
-- Every classified BSCS paper gets DM back, including ones uploaded after the
-- forward migration. That is the only state the restored rule accepts: DM was
-- BSCS's sole specialization and it was mandatory. Profiles, chat sessions,
-- scans and the activity log are not re-stamped; their specialization was
-- informational and null is valid for them under either rule.
--
-- services/catalog.py needs no change to match: it reads the rule from the
-- catalog, so with DM active again it requires a specialization for BSCS, the
-- same as the restored trigger.

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
  if v_program.code in ('BSCS','BSIT') and new.specialization_id is null then
    raise exception '% requires a specialization', v_program.code;
  end if;
  if v_program.code not in ('BSCS','BSIT') and new.specialization_id is not null then
    raise exception '% does not accept a specialization', v_program.code;
  end if;
  return new;
end $$;

do $$
declare
  v_bscs uuid;
  v_dm uuid;
begin
  select p.id, s.id into v_bscs, v_dm
  from public.specializations s
  join public.programs p on p.id = s.program_id
  join public.departments d on d.id = p.department_id
  where d.code = 'CCSICT' and p.code = 'BSCS' and s.code = 'DM'
  limit 1;
  if v_dm is null then
    return;
  end if;

  update public.specializations set active = true, updated_at = now() where id = v_dm;

  update public.papers
  set specialization_id = v_dm, track = 'Data Mining'
  where program_id = v_bscs and specialization_id is null;
  update public.papers
  set track = 'Data Mining'
  where track = 'BSCS' and program_id is null;

  update public.upload_jobs
  set request_payload = request_payload
    || jsonb_build_object('specialization_id', v_dm::text, 'track', 'Data Mining')
  where request_payload ->> 'program_id' = v_bscs::text
    and status not in ('completed', 'failed');
end $$;

commit;
