-- ============================================================================
-- ISU CENTRALIZED AI-POWERED THESIS LIBRARY — COMPLETE SUPABASE SCHEMA
-- College of Computing Studies, Information and Communication Technology
-- Isabela State University, Echague Campus
--
-- Run this entire script in the Supabase SQL Editor of a fresh/disposable
-- project. It is transactional and idempotent: a failed run rolls back, and
-- re-running it will not duplicate objects.
--
-- IMPORTANT:
--   * The FastAPI backend must use the SERVICE_ROLE key (bypasses RLS).
--   * The React frontend uses the ANON key (restricted by RLS below).
--   * Storage bucket "pdfs" is PRIVATE — enforces the paper's indirect
--     access model at the infrastructure level (no public thesis PDFs).
-- ============================================================================

begin;


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
create extension if not exists vector;
create extension if not exists pgcrypto;


-- ============================================================================
-- 1. PROFILES (roles: student | faculty | admin | superadmin)
--    Auto-created by trigger whenever a user signs up through Supabase Auth.
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'faculty', 'admin', 'superadmin')),
  department text not null default 'CCSICT',
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, department, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data ->> 'requested_role' = 'faculty'
      then 'faculty' else 'student' end,
    'CCSICT', -- Public registration cannot self-assign another department.
    case 
      when new.raw_user_meta_data ->> 'requested_role' = 'faculty' then 'pending'
      else 'approved'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Backfill accounts created before the profile trigger was installed. Public
-- signup metadata may request faculty review, but can never grant a privileged
-- role or select another department.
insert into public.profiles (id, email, full_name, role, department, status)
select
  users.id,
  users.email,
  coalesce(
    nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(users.email, ''), '@', 1),
    'ISU User'
  ),
  case when users.raw_user_meta_data ->> 'requested_role' = 'faculty'
    then 'faculty' else 'student' end,
  'CCSICT',
  case when users.raw_user_meta_data ->> 'requested_role' = 'faculty'
    then 'pending' else 'approved' end
from auth.users as users
where not exists (
  select 1 from public.profiles as profiles where profiles.id = users.id
);

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.sync_profile_email();

revoke all on function public.sync_profile_email() from public, anon, authenticated;

create or replace function public.validate_editable_profile_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.full_name is not null and length(trim(new.full_name)) = 0 then
    raise exception 'Full name cannot be empty';
  end if;
  if (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
     and new.avatar_url is not null then
    if new.avatar_url not like new.id::text || '/%'
       or not exists (
         select 1 from storage.objects
         where bucket_id = 'avatars' and name = new.avatar_url
       ) then
      raise exception 'Avatar must be an existing object owned by the profile owner';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_editable_profile_fields()
  from public, anon, authenticated;
drop trigger if exists validate_editable_profile_fields on public.profiles;
create trigger validate_editable_profile_fields
  before insert or update of full_name, avatar_url on public.profiles
  for each row execute function public.validate_editable_profile_fields();


-- ============================================================================
-- 1A. DEPARTMENTS (server-managed retrieval boundaries)
-- ============================================================================
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  track_label text not null default 'Academic track',
  tracks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Migration helper for older or partially configured projects.
alter table public.profiles add column if not exists avatar_url text;
create index if not exists profiles_department_idx on public.profiles (department);
create index if not exists profiles_role_status_idx on public.profiles (role, status);

insert into public.departments (name, track_label, tracks) values (
  'CCSICT',
  'Academic track',
  '["Data Mining", "Web Development", "Network Security", "Intelligent Systems", "Information Management"]'::jsonb
)
on conflict (name) do nothing;


-- ============================================================================
-- 2. PAPERS (thesis metadata + extracted full text)
--    "track" is the CCSICT academic track per the thesis paper
--    (e.g. Data Mining, Web Development, Network Security).
--    "storage_path" points into the PRIVATE bucket — never exposed to users.
-- ============================================================================
create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  authors text,
  year integer,
  abstract text,
  track text,
  content text,
  filename text,
  storage_path text,
  chunk_count integer default 0,
  duplication_scan jsonb,
  uploaded_by uuid references auth.users(id) on delete set null,
  department text not null default 'CCSICT',
  active_index_version uuid not null default gen_random_uuid(),
  ingestion_status text not null default 'ready'
    check (ingestion_status in ('processing', 'ready', 'failed', 'deletion_pending')),
  redaction_stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Migration helpers for existing installations (no-ops on fresh projects)
alter table public.papers add column if not exists track text;
alter table public.papers add column if not exists storage_path text;
alter table public.papers add column if not exists chunk_count integer default 0;
-- Result of the automatic ingest-time duplication screening
-- (thesis paper, Section 3.2.3 Phase 3): {flagged, duplication_percentage,
-- threshold, matched_papers}.
alter table public.papers add column if not exists duplication_scan jsonb;
alter table public.papers add column if not exists uploaded_by uuid;
alter table public.papers add column if not exists department text not null default 'CCSICT';
alter table public.papers add column if not exists active_index_version uuid default gen_random_uuid();
alter table public.papers add column if not exists ingestion_status text not null default 'ready';
alter table public.papers add column if not exists redaction_stats jsonb not null default '{}'::jsonb;
update public.papers set active_index_version = gen_random_uuid() where active_index_version is null;
alter table public.papers alter column active_index_version set not null;
alter table public.papers alter column active_index_version set default gen_random_uuid();
alter table public.papers drop constraint if exists papers_ingestion_status_check;
alter table public.papers add constraint papers_ingestion_status_check
  check (ingestion_status in ('processing', 'ready', 'failed', 'deletion_pending'));

create index if not exists papers_track_idx on public.papers (track);
create index if not exists papers_year_idx on public.papers (year);
create index if not exists papers_department_idx on public.papers (department);


-- ============================================================================
-- 3. CHUNKS (768-dim Gemini embeddings + per-chunk citation metadata)
--    metadata JSON: {"title", "author", "track", "year"} per the paper's
--    Metadata Tagging requirement (Section 3.2.3, Phase 2).
-- ============================================================================
create table if not exists public.chunks (
  id bigserial primary key,
  paper_id uuid references public.papers(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(768),
  page_start integer,
  page_end integer,
  section text,
  index_version uuid,
  indexed_at timestamptz not null default now()
);

alter table public.chunks add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.chunks add column if not exists page_start integer;
alter table public.chunks add column if not exists page_end integer;
alter table public.chunks add column if not exists section text;
alter table public.chunks add column if not exists index_version uuid;
alter table public.chunks add column if not exists indexed_at timestamptz not null default now();
update public.chunks c
set index_version = p.active_index_version
from public.papers p
where c.paper_id = p.id and c.index_version is null;
alter table public.chunks alter column index_version set not null;

create index if not exists chunks_paper_id_idx on public.chunks (paper_id);
create index if not exists chunks_embedding_idx on public.chunks
  using hnsw (embedding vector_cosine_ops);
create unique index if not exists chunks_version_position_idx
  on public.chunks (paper_id, index_version, chunk_index);

-- Failed private-storage cleanup is persisted for a controlled retry.
create table if not exists public.storage_cleanup_queue (
  id bigserial primary key,
  operation text not null check (operation in ('rollback_upload', 'delete_paper')),
  resource_path text not null,
  paper_id uuid references public.papers(id) on delete set null,
  job_id text,
  error_category text not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Repair older/partial profile tables before any trigger references columns.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists department text not null default 'CCSICT';
alter table public.profiles add column if not exists status text not null default 'approved';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

update public.profiles
set avatar_url = split_part(avatar_url, '/storage/v1/object/public/avatars/', 2)
where avatar_url like '%/storage/v1/object/public/avatars/%';
update public.profiles
set avatar_url = null
where avatar_url is not null and avatar_url not like id::text || '/%';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles add constraint profiles_role_check
      check (role in ('student', 'faculty', 'admin', 'superadmin'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_status_check'
  ) then
    alter table public.profiles add constraint profiles_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

create or replace function public.commit_paper_ingestion(p_paper jsonb, p_chunks jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paper_id uuid := coalesce(nullif(p_paper ->> 'id', '')::uuid, gen_random_uuid());
  v_index_version uuid := gen_random_uuid();
  v_chunk jsonb;
  v_expected_count integer;
  v_inserted_count integer;
begin
  if nullif(btrim(p_paper ->> 'title'), '') is null then
    raise exception 'Paper title is required';
  end if;
  if coalesce(jsonb_typeof(p_chunks), 'null') <> 'array'
     or jsonb_array_length(p_chunks) = 0 then
    raise exception 'At least one verified chunk is required';
  end if;
  v_expected_count := jsonb_array_length(p_chunks);
  if coalesce((p_paper ->> 'chunk_count')::integer, -1) <> v_expected_count then
    raise exception 'Paper chunk count does not match staged chunks';
  end if;
  if exists (
    select 1 from public.papers p
    where p.id = v_paper_id and p.ingestion_status = 'ready'
      and p.chunk_count = v_expected_count
      and (select count(*) from public.chunks c where c.paper_id = p.id) = v_expected_count
  ) then
    return v_paper_id;
  elsif exists (select 1 from public.papers where id = v_paper_id) then
    raise exception 'Paper ingestion ID already exists in an incomplete state';
  end if;

  insert into public.papers (
    id, title, authors, year, abstract, track, content, filename,
    storage_path, chunk_count, duplication_scan, uploaded_by, department,
    active_index_version, ingestion_status, redaction_stats
  ) values (
    v_paper_id, p_paper ->> 'title', nullif(p_paper ->> 'authors', ''),
    nullif(p_paper ->> 'year', '')::integer, nullif(p_paper ->> 'abstract', ''),
    nullif(p_paper ->> 'track', ''), p_paper ->> 'content', p_paper ->> 'filename',
    p_paper ->> 'storage_path', v_expected_count, p_paper -> 'duplication_scan',
    nullif(p_paper ->> 'uploaded_by', '')::uuid,
    coalesce(nullif(p_paper ->> 'department', ''), 'CCSICT'),
    v_index_version, 'processing', coalesce(p_paper -> 'redaction_stats', '{}'::jsonb)
  );

  for v_chunk in select value from jsonb_array_elements(p_chunks)
  loop
    if coalesce(jsonb_typeof(v_chunk -> 'embedding'), 'null') <> 'array'
       or jsonb_array_length(v_chunk -> 'embedding') <> 768 then
      raise exception 'Invalid embedding dimensions';
    end if;
    if nullif(v_chunk ->> 'content', '') is null then
      raise exception 'Chunk content is required';
    end if;
    insert into public.chunks (
      paper_id, chunk_index, content, embedding, metadata,
      page_start, page_end, section, index_version
    ) values (
      v_paper_id, (v_chunk ->> 'chunk_index')::integer, v_chunk ->> 'content',
      (v_chunk -> 'embedding')::text::vector,
      coalesce(v_chunk -> 'metadata', '{}'::jsonb),
      nullif(v_chunk ->> 'page_start', '')::integer,
      nullif(v_chunk ->> 'page_end', '')::integer,
      nullif(v_chunk ->> 'section', ''), v_index_version
    );
  end loop;

  select count(*) into v_inserted_count from public.chunks
  where paper_id = v_paper_id and index_version = v_index_version;
  if v_inserted_count <> v_expected_count then
    raise exception 'Inserted chunk count verification failed';
  end if;
  update public.papers set ingestion_status = 'ready' where id = v_paper_id;
  return v_paper_id;
end;
$$;

revoke all on function public.commit_paper_ingestion(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_paper_ingestion(jsonb, jsonb) to service_role;


-- ============================================================================
-- 4. CHAT SESSIONS + MESSAGES
-- ============================================================================
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  department text not null default 'CCSICT',
  created_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_idx on public.chat_sessions (user_id, created_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  question text not null,
  answer text not null,
  sources jsonb default '[]'::jsonb,
  duplication_alert jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_messages add column if not exists duplication_alert jsonb;

create index if not exists chat_messages_session_idx on public.chat_messages (session_id, created_at);

create or replace function public.save_chat_exchange(
  p_user_id uuid,
  p_session_id uuid,
  p_title text,
  p_question text,
  p_answer text,
  p_sources jsonb,
  p_duplication_alert jsonb,
  p_department text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid := p_session_id;
begin
  if v_session_id is null then
    insert into public.chat_sessions (user_id, title, department)
    values (p_user_id, left(p_title, 120), p_department)
    returning id into v_session_id;
  elsif not exists (
    select 1 from public.chat_sessions
    where id = v_session_id
      and user_id = p_user_id
      and department = p_department
  ) then
    raise exception 'Session not found, not owned by user, or belongs to another department';
  end if;

  insert into public.chat_messages (
    session_id, question, answer, sources, duplication_alert
  ) values (
    v_session_id, p_question, p_answer,
    coalesce(p_sources, '[]'::jsonb), p_duplication_alert
  );
  return v_session_id;
end;
$$;

revoke all on function public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text
) to service_role;


-- ============================================================================
-- 5. SCAN HISTORY (topic novelty / duplication checks — faculty + admin)
-- ============================================================================
create table if not exists public.scan_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  duplication_percentage double precision not null default 0,
  top_matches jsonb default '[]'::jsonb,
  verdict_summary text,
  matched_chunks jsonb default '[]'::jsonb,
  chat_log jsonb default '[]'::jsonb,
  department text not null default 'CCSICT',
  highest_similarity double precision not null default 0,
  matched_chunk_percentage double precision not null default 0,
  matched_chunk_count integer not null default 0,
  total_chunks integer not null default 0,
  verdict_level text not null default 'clear'
    check (verdict_level in ('clear', 'review_suggested', 'high_overlap')),
  created_at timestamptz not null default now()
);

alter table public.chat_sessions add column if not exists department text not null default 'CCSICT';

alter table public.scan_history add column if not exists department text not null default 'CCSICT';
alter table public.scan_history add column if not exists highest_similarity double precision not null default 0;
alter table public.scan_history add column if not exists matched_chunk_percentage double precision not null default 0;
alter table public.scan_history add column if not exists matched_chunk_count integer not null default 0;
alter table public.scan_history add column if not exists total_chunks integer not null default 0;
alter table public.scan_history add column if not exists verdict_level text not null default 'clear';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scan_history_verdict_level_check'
  ) then
    alter table public.scan_history add constraint scan_history_verdict_level_check
      check (verdict_level in ('clear', 'review_suggested', 'high_overlap'));
  end if;
end;
$$;

create index if not exists scan_history_user_idx on public.scan_history (user_id, created_at desc);
create index if not exists scan_history_department_idx on public.scan_history (department);


-- ============================================================================
-- 6. SYSTEM SETTINGS (configurable thresholds per the paper)
-- ============================================================================
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

delete from public.system_settings
where key in ('duplication_threshold', 'retrieval_threshold', 'retrieval_match_count');

insert into public.system_settings (key, value, description) values
  ('role_features', '{"student":{"chat":true,"archive":true,"novelty":false,"upload":false},"faculty":{"chat":true,"archive":true,"novelty":true,"upload":false}}'::jsonb,
   'Role-based access permissions for system features')
on conflict (key) do nothing;


-- ============================================================================
-- 7. ACTIVITY LOG (institutional research analytics)
-- ============================================================================
create table if not exists public.activity_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,             -- e.g. 'chat_query', 'paper_upload', 'novelty_scan', 'paper_delete', 'role_change'
  department text,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_log add column if not exists department text;

create index if not exists activity_log_action_idx on public.activity_log (action, created_at desc);
create index if not exists activity_log_department_idx on public.activity_log (department, created_at desc);
create index if not exists chat_sessions_department_idx on public.chat_sessions (department, created_at desc);
create index if not exists storage_cleanup_pending_idx
  on public.storage_cleanup_queue (status, created_at);

-- Durable cross-worker status for background ingestion jobs.
create table if not exists public.upload_jobs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  department text not null default 'CCSICT',
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  stage text not null default 'extract',
  progress integer not null default 0 check (progress between 0 and 100),
  message text not null default '',
  paper_id uuid references public.papers(id) on delete set null,
  chunks integer,
  duplication jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists upload_jobs_owner_idx on public.upload_jobs (owner_id, created_at desc);
create index if not exists upload_jobs_status_idx on public.upload_jobs (status, updated_at);

-- Department names are authoritative and cascade safely on rename.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_department_fkey') then
    alter table public.profiles add constraint profiles_department_fkey
      foreign key (department) references public.departments(name)
      on update cascade on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'papers_department_fkey') then
    alter table public.papers add constraint papers_department_fkey
      foreign key (department) references public.departments(name)
      on update cascade on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scan_history_department_fkey') then
    alter table public.scan_history add constraint scan_history_department_fkey
      foreign key (department) references public.departments(name)
      on update cascade on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_sessions_department_fkey') then
    alter table public.chat_sessions add constraint chat_sessions_department_fkey
      foreign key (department) references public.departments(name)
      on update cascade on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'upload_jobs_department_fkey') then
    alter table public.upload_jobs add constraint upload_jobs_department_fkey
      foreign key (department) references public.departments(name)
      on update cascade on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activity_log_department_fkey') then
    alter table public.activity_log add constraint activity_log_department_fkey
      foreign key (department) references public.departments(name)
      on update cascade on delete restrict not valid;
  end if;
end;
$$;


-- ============================================================================
-- 8. RPC: match_chunks — cosine similarity vector search (returns metadata)
-- ============================================================================
drop function if exists public.match_chunks(vector(768), int, float);
drop function if exists public.match_chunks(vector(768), int, float, text);

create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int default 5,
  match_threshold float default 0.3,
  p_department text default null
)
returns table (
  id bigint,
  paper_id uuid,
  chunk_index integer,
  content text,
  metadata jsonb,
  page_start integer,
  page_end integer,
  section text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.paper_id,
    c.chunk_index,
    c.content,
    c.metadata,
    c.page_start,
    c.page_end,
    c.section,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  where c.index_version = p.active_index_version
    and p.ingestion_status = 'ready'
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

revoke all on function public.match_chunks(vector(768), integer, double precision, text)
  from public, anon, authenticated;
grant execute on function public.match_chunks(vector(768), integer, double precision, text)
  to service_role;


-- ============================================================================
-- 9. RPC: check_topic_duplication — query-time 85% novelty guard
--    Returns the single best matching chunk with its paper metadata so the
--    application layer can flag redundant topics with the exact percentage.
-- ============================================================================
drop function if exists public.check_topic_duplication(vector(768), float);
drop function if exists public.check_topic_duplication(vector(768), float, text);
create or replace function public.check_topic_duplication(
  query_embedding vector(768),
  dup_threshold float default 0.85,
  p_department text default null
)
returns table (
  chunk_id bigint,
  paper_id uuid,
  title text,
  authors text,
  year integer,
  track text,
  abstract text,
  chunk_content text,
  chunk_index integer,
  department text,
  page_start integer,
  page_end integer,
  section text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id as chunk_id,
    p.id as paper_id,
    p.title,
    p.authors,
    p.year,
    p.track,
    p.abstract,
    c.content as chunk_content,
    c.chunk_index,
    p.department,
    c.page_start,
    c.page_end,
    c.section,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  where c.index_version = p.active_index_version
    and p.ingestion_status = 'ready'
    and 1 - (c.embedding <=> query_embedding) >= dup_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit 1;
end;
$$;

revoke all on function public.check_topic_duplication(vector(768), double precision, text)
  from public, anon, authenticated;
grant execute on function public.check_topic_duplication(vector(768), double precision, text)
  to service_role;


-- Atomically activate a fully staged paper index. Backend service role only.
create or replace function public.activate_paper_index(
  p_paper_id uuid,
  p_index_version uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.chunks
    where paper_id = p_paper_id and index_version = p_index_version
  ) then
    raise exception 'Cannot activate an empty or missing index version';
  end if;

  update public.papers
  set active_index_version = p_index_version
  where id = p_paper_id;

  if not found then
    raise exception 'Paper not found';
  end if;
end;
$$;

revoke all on function public.activate_paper_index(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_paper_index(uuid, uuid) to service_role;


-- Explicit cleanup: never removes active indexes and respects a rollback window.
create or replace function public.prune_inactive_indexes(p_older_than_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if p_older_than_days < 1 then
    raise exception 'Rollback window must be at least one day';
  end if;

  delete from public.chunks c
  using public.papers p
  where c.paper_id = p.id
    and c.index_version <> p.active_index_version
    and c.indexed_at < now() - make_interval(days => p_older_than_days)
    -- Always retain the newest inactive version as the rollback index.
    and exists (
      select 1
      from public.chunks newer
      where newer.paper_id = c.paper_id
        and newer.index_version <> p.active_index_version
        and newer.index_version <> c.index_version
        and newer.indexed_at > c.indexed_at
    );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_inactive_indexes(integer) from public, anon, authenticated;
grant execute on function public.prune_inactive_indexes(integer) to service_role;


-- ============================================================================
-- 10. ROW LEVEL SECURITY
--     The backend uses the service_role key and bypasses RLS.
--     These policies protect against direct access with the anon key.
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.departments    enable row level security;
alter table public.papers         enable row level security;
alter table public.chunks         enable row level security;
alter table public.chat_sessions  enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.scan_history   enable row level security;
alter table public.system_settings enable row level security;
alter table public.activity_log   enable row level security;
alter table public.storage_cleanup_queue enable row level security;
alter table public.upload_jobs enable row level security;

revoke all on table public.storage_cleanup_queue from public, anon, authenticated;
grant all on table public.storage_cleanup_queue to service_role;
revoke all on table public.upload_jobs from public, anon, authenticated;
grant all on table public.upload_jobs to service_role;
revoke all on sequence public.storage_cleanup_queue_id_seq from public, anon, authenticated;
grant usage, select on sequence public.storage_cleanup_queue_id_seq to service_role;

-- Remove every direct client policy from backend-only institutional data.
do $$
declare existing_policy record;
begin
  for existing_policy in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'departments', 'papers', 'chunks', 'system_settings',
        'activity_log', 'storage_cleanup_queue', 'upload_jobs'
      ])
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      existing_policy.policyname,
      existing_policy.tablename
    );
  end loop;
end;
$$;

revoke all on table public.departments, public.papers, public.chunks,
  public.system_settings, public.activity_log, public.storage_cleanup_queue
  , public.upload_jobs
  from public, anon, authenticated;
grant all on table public.departments, public.papers, public.chunks,
  public.system_settings, public.activity_log, public.storage_cleanup_queue
  , public.upload_jobs
  to service_role;
grant all on table public.profiles, public.chat_sessions, public.chat_messages,
  public.scan_history to service_role;
grant usage, select on sequence public.chunks_id_seq,
  public.activity_log_id_seq, public.storage_cleanup_queue_id_seq to service_role;

-- Profiles: users can read their own profile (role lookup at login)
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and auth.uid() = old.id and (
    new.role is distinct from old.role or
    new.status is distinct from old.status or
    new.department is distinct from old.department or
    new.email is distinct from old.email
  ) then
    raise exception 'Protected profile fields may only be changed by the backend';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_security_fields()
  from public, anon, authenticated;

drop trigger if exists protect_profile_security_fields on public.profiles;
create trigger protect_profile_security_fields
  before update on public.profiles
  for each row execute function public.protect_profile_security_fields();

-- Papers: NO client policies — backend only (indirect access model).
-- The table stores the full extracted manuscript in `content`, so any
-- direct anon-key read would leak full thesis text and defeat the paper's
-- indirect access delimitation (Section 1.3). All metadata reads go through
-- the backend /papers endpoint, which selects citation metadata columns
-- only. RLS enabled with no policies = deny all for anon/authenticated.
-- The drop below also removes the exposure from existing installations.
drop policy if exists "papers_select_authenticated" on public.papers;

-- Chunks: never directly readable by clients (backend only)
-- (RLS enabled with no policies = deny all for anon/authenticated)

-- Chat sessions/messages: backend only. Ownership is enforced by API queries
-- and the service-role-only save_chat_exchange RPC.
revoke all on table public.chat_sessions, public.chat_messages from anon, authenticated;
drop policy if exists "sessions_owner_all" on public.chat_sessions;
drop policy if exists "messages_owner_all" on public.chat_messages;

-- Scan history: backend only. Sanitized owner-scoped records are returned by
-- API endpoints without archived comparison excerpts.
revoke all on table public.scan_history from public, anon, authenticated;
drop policy if exists "scans_owner_all" on public.scan_history;

-- System settings / activity log: backend only (no client policies)


-- ============================================================================
-- 11. PRIVATE STORAGE BUCKET for original thesis PDFs
--     Private bucket — originals are never exposed through signed URLs.
--     Backend ingestion, controlled re-indexing, rollback, and deletion are
--     the only permitted uses. No application role can obtain a file URL.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pdfs_indirect_access_only" on storage.objects;
create policy "pdfs_indirect_access_only" on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'pdfs')
  with check (bucket_id <> 'pdfs');

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select to public using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- 12. SEED / OPERATIONS
-- ============================================================================
-- CCSICT academic tracks are managed in application code:
--   Data Mining, Web Development, Network Security,
--   Intelligent Systems, Information Management
--
-- To promote the first administrator after they sign up, run:
--   update public.profiles set role = 'admin' where email = 'admin@isu.edu.ph';
--
-- To promote a faculty adviser:
--   update public.profiles set role = 'faculty' where email = 'adviser@isu.edu.ph';

-- Fail the transaction if the minimum application contract is incomplete.
do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'profiles', 'departments', 'papers', 'chunks', 'chat_sessions',
    'chat_messages', 'scan_history', 'system_settings', 'activity_log',
    'storage_cleanup_queue', 'upload_jobs'
  ]
  loop
    if to_regclass(format('public.%I', required_table)) is null then
      raise exception 'Required table public.% is missing', required_table;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'avatar_url'
  ) then
    raise exception 'Required column public.profiles.avatar_url is missing';
  end if;
  if not exists (
    select 1 from public.departments where name = 'CCSICT'
  ) then
    raise exception 'Required CCSICT department seed is missing';
  end if;
  if not exists (
    select 1 from storage.buckets where id = 'pdfs' and public = false
  ) then
    raise exception 'Private pdfs storage bucket is missing or public';
  end if;
  if not exists (
    select 1 from storage.buckets where id = 'avatars' and public = true
  ) then
    raise exception 'Public avatars storage bucket is missing';
  end if;
end;
$$;

commit;
