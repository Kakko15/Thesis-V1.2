-- PI-04: additive, idempotent CCSICT department -> program -> specialization catalog.
-- Legacy text remains readable for one compatibility release.

create extension if not exists pgcrypto;

alter table public.departments add column if not exists code text;
alter table public.departments add column if not exists active boolean not null default true;
update public.departments set code = upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g')) where code is null;
alter table public.departments alter column code set not null;
create unique index if not exists departments_code_uq on public.departments(code);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9-]+$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, code)
);

create table if not exists public.specializations (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9-]+$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, code)
);

do $$
declare v_department uuid;
begin
  select id into v_department from public.departments where code = 'CCSICT' limit 1;
  if v_department is null then raise exception 'CCSICT department is required before catalog migration'; end if;
  insert into public.programs (id, department_id, code, name) values
    ('10000000-0000-4000-8000-000000000001', v_department, 'BSCS', 'Bachelor of Science in Computer Science'),
    ('10000000-0000-4000-8000-000000000002', v_department, 'BSIT', 'Bachelor of Science in Information Technology'),
    ('10000000-0000-4000-8000-000000000003', v_department, 'BSDSA', 'Bachelor of Science in Data Science and Analytics'),
    ('10000000-0000-4000-8000-000000000004', v_department, 'BSIS', 'Bachelor of Science in Information Systems'),
    ('10000000-0000-4000-8000-000000000005', v_department, 'BLIS', 'Bachelor of Library and Information Science')
  on conflict (department_id, code) do update set name = excluded.name;
  insert into public.specializations (id, program_id, code, name) values
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'DM', 'Data Mining'),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'WMAD', 'Web and Mobile Application Development'),
    ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'NETSEC', 'Network and Security')
  on conflict (program_id, code) do update set name = excluded.name;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','papers','chat_sessions','scan_history','upload_jobs','activity_log']
  loop
    execute format('alter table public.%I add column if not exists program_id uuid references public.programs(id) on delete restrict', table_name);
    execute format('alter table public.%I add column if not exists specialization_id uuid references public.specializations(id) on delete restrict', table_name);
  end loop;
end $$;

alter table public.papers add column if not exists legacy_track text;
alter table public.papers add column if not exists classification_status text not null default 'unclassified'
  check (classification_status in ('classified','needs_review','unclassified'));
alter table public.upload_jobs add column if not exists legacy_track text;
alter table public.upload_jobs add column if not exists classification_status text not null default 'unclassified'
  check (classification_status in ('classified','needs_review','unclassified'));

update public.papers set
  program_id = case track when 'Data Mining' then '10000000-0000-4000-8000-000000000001'::uuid
    when 'Web Development' then '10000000-0000-4000-8000-000000000002'::uuid
    when 'Network Security' then '10000000-0000-4000-8000-000000000002'::uuid end,
  specialization_id = case track when 'Data Mining' then '20000000-0000-4000-8000-000000000001'::uuid
    when 'Web Development' then '20000000-0000-4000-8000-000000000002'::uuid
    when 'Network Security' then '20000000-0000-4000-8000-000000000003'::uuid end,
  legacy_track = track,
  classification_status = case
    when track in ('Data Mining','Web Development','Network Security') then 'classified'
    when track in ('Intelligent Systems','Information Management') then 'needs_review'
    else 'unclassified' end
where program_id is null;

create index if not exists papers_program_specialization_idx
  on public.papers(department, program_id, specialization_id) where ingestion_status = 'ready';
create index if not exists profiles_program_specialization_idx
  on public.profiles(program_id, specialization_id);

alter table public.programs enable row level security;
alter table public.specializations enable row level security;
revoke all on public.programs, public.specializations from public, anon, authenticated;
grant all on public.programs, public.specializations to service_role;

create or replace function public.hydrate_paper_academic_classification()
returns trigger language plpgsql set search_path = public as $$
declare v_payload jsonb;
begin
  select request_payload into v_payload from public.upload_jobs where id = new.id;
  if v_payload is not null then
    new.program_id := nullif(v_payload ->> 'program_id', '')::uuid;
    new.specialization_id := nullif(v_payload ->> 'specialization_id', '')::uuid;
    new.legacy_track := nullif(v_payload ->> 'legacy_track', '');
    new.classification_status := coalesce(
      nullif(v_payload ->> 'classification_status', ''), 'unclassified'
    );
  end if;
  return new;
end $$;

drop trigger if exists a_papers_hydrate_academic_classification on public.papers;
create trigger a_papers_hydrate_academic_classification before insert on public.papers
for each row execute function public.hydrate_paper_academic_classification();

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

drop trigger if exists papers_validate_academic_classification on public.papers;
create trigger papers_validate_academic_classification before insert or update of program_id, specialization_id
on public.papers for each row execute function public.validate_academic_classification();

drop trigger if exists profiles_validate_academic_classification on public.profiles;
create trigger profiles_validate_academic_classification before insert or update of program_id, specialization_id
on public.profiles for each row execute function public.validate_academic_classification();

-- Guardrails: this migration never deletes or rewrites the legacy track column.
-- Run the companion rollback only before any client treats UUID classification as authoritative.
