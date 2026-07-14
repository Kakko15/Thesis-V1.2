-- ============================================================================
-- ISU CENTRALIZED AI-POWERED THESIS LIBRARY — SUPABASE PRODUCTION SETUP
-- College of Computing Studies, Information and Communication Technology
-- Isabela State University, Echague Campus
--
-- Run this entire script ONCE in the Supabase SQL Editor of a fresh project.
-- It is idempotent: re-running it will not duplicate objects.
--
-- IMPORTANT:
--   * The FastAPI backend must use the SERVICE_ROLE key (bypasses RLS).
--   * The React frontend uses the ANON key (restricted by RLS below).
--   * Storage bucket "pdfs" is PRIVATE — enforces the paper's indirect
--     access model at the infrastructure level (no public thesis PDFs).
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
create extension if not exists vector;
create extension if not exists pgcrypto;


-- ============================================================================
-- 1. PROFILES (roles: student | faculty | admin)
--    Auto-created by trigger whenever a user signs up through Supabase Auth.
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
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
    coalesce(new.raw_user_meta_data ->> 'requested_role', 'student'),
    coalesce(new.raw_user_meta_data ->> 'department', 'CCSICT'),
    case 
      when (new.raw_user_meta_data ->> 'requested_role') in ('faculty', 'admin') then 'pending'
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

create index if not exists papers_track_idx on public.papers (track);
create index if not exists papers_year_idx on public.papers (year);


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
  embedding vector(768)
);

alter table public.chunks add column if not exists metadata jsonb default '{}'::jsonb;

create index if not exists chunks_paper_id_idx on public.chunks (paper_id);
create index if not exists chunks_embedding_idx on public.chunks
  using hnsw (embedding vector_cosine_ops);


-- ============================================================================
-- 4. CHAT SESSIONS + MESSAGES
-- ============================================================================
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
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
  created_at timestamptz not null default now()
);

create index if not exists scan_history_user_idx on public.scan_history (user_id, created_at desc);


-- ============================================================================
-- 6. SYSTEM SETTINGS (configurable thresholds per the paper)
-- ============================================================================
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.system_settings (key, value, description) values
  ('duplication_threshold', '0.85', 'Cosine similarity threshold for flagging topic duplication (thesis paper: 85%)'),
  ('retrieval_threshold',   '0.30', 'Minimum cosine similarity for RAG retrieval; below this the system reports no relevant thesis found'),
  ('retrieval_match_count', '5',    'Top-k chunks retrieved per query')
on conflict (key) do nothing;


-- ============================================================================
-- 7. ACTIVITY LOG (institutional research analytics)
-- ============================================================================
create table if not exists public.activity_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,             -- e.g. 'chat_query', 'paper_upload', 'novelty_scan', 'paper_delete', 'role_change'
  detail jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_action_idx on public.activity_log (action, created_at desc);


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
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  where 1 - (c.embedding <=> query_embedding) > match_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- ============================================================================
-- 9. RPC: check_topic_duplication — query-time 85% novelty guard
--    Returns the single best matching chunk with its paper metadata so the
--    application layer can flag redundant topics with the exact percentage.
-- ============================================================================
drop function if exists public.check_topic_duplication(vector(768), float);
create or replace function public.check_topic_duplication(
  query_embedding vector(768),
  dup_threshold float default 0.85
)
returns table (
  paper_id uuid,
  title text,
  authors text,
  year integer,
  track text,
  abstract text,
  chunk_content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    p.id as paper_id,
    p.title,
    p.authors,
    p.year,
    p.track,
    p.abstract,
    c.content as chunk_content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  where 1 - (c.embedding <=> query_embedding) >= dup_threshold
  order by c.embedding <=> query_embedding
  limit 1;
end;
$$;


-- ============================================================================
-- 10. ROW LEVEL SECURITY
--     The backend uses the service_role key and bypasses RLS.
--     These policies protect against direct access with the anon key.
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.papers         enable row level security;
alter table public.chunks         enable row level security;
alter table public.chat_sessions  enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.scan_history   enable row level security;
alter table public.system_settings enable row level security;
alter table public.activity_log   enable row level security;

-- Profiles: users can read their own profile (role lookup at login)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()));

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

-- Chat sessions/messages: owners only
drop policy if exists "sessions_owner_all" on public.chat_sessions;
create policy "sessions_owner_all" on public.chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "messages_owner_all" on public.chat_messages;
create policy "messages_owner_all" on public.chat_messages
  for all using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

-- Scan history: owners only
drop policy if exists "scans_owner_all" on public.scan_history;
create policy "scans_owner_all" on public.scan_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- System settings / activity log: backend only (no client policies)


-- ============================================================================
-- 11. PRIVATE STORAGE BUCKET for original thesis PDFs
--     Private bucket — files are ONLY reachable through short-lived signed
--     URLs generated by the backend for admins. Students/faculty can never
--     view or download full theses (indirect access model).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', false)
on conflict (id) do update set public = false;


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
