-- PI-04 pre-activation rollback. This preserves every legacy text field and row.
drop trigger if exists a_papers_hydrate_academic_classification on public.papers;
drop function if exists public.hydrate_paper_academic_classification();
drop trigger if exists profiles_validate_academic_classification on public.profiles;
drop trigger if exists papers_validate_academic_classification on public.papers;
drop function if exists public.validate_academic_classification();
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','papers','chat_sessions','scan_history','upload_jobs','activity_log'] loop
    execute format('alter table public.%I drop column if exists specialization_id', table_name);
    execute format('alter table public.%I drop column if exists program_id', table_name);
  end loop;
end $$;
alter table public.papers drop column if exists legacy_track;
alter table public.papers drop column if exists classification_status;
alter table public.upload_jobs drop column if exists legacy_track;
alter table public.upload_jobs drop column if exists classification_status;
drop table if exists public.specializations;
drop table if exists public.programs;
alter table public.departments drop column if exists active;
alter table public.departments drop column if exists code;
