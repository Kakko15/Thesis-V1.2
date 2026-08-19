-- Rollback for 20260819_isu_academic_catalog.sql.
--
-- Removes the nine standby colleges and their catalog rows, then drops the
-- title column. CCSICT and everything under it is left untouched.
--
-- The department foreign keys (papers, profiles, chat_sessions, scan_history,
-- upload_jobs, activity_log -> departments.name) are ON DELETE RESTRICT, and
-- programs/specializations are ON DELETE RESTRICT from papers and profiles, so
-- this fails loudly rather than silently orphaning institutional records if a
-- college was scaled up and used. Reassign those records before rolling back.

delete from public.specializations
where program_id in (
  select program.id from public.programs as program
  join public.departments as department on department.id = program.department_id
  where department.code in (
    'SVM', 'CA', 'IOF', 'CAS', 'COE', 'CBAPA', 'CON', 'CCJE', 'CED'
  )
);

delete from public.programs
where department_id in (
  select id from public.departments
  where code in ('SVM', 'CA', 'IOF', 'CAS', 'COE', 'CBAPA', 'CON', 'CCJE', 'CED')
);

delete from public.departments
where code in ('SVM', 'CA', 'IOF', 'CAS', 'COE', 'CBAPA', 'CON', 'CCJE', 'CED');

alter table public.departments drop column if exists title;
