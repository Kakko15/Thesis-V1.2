-- Items 9-16: citation-aware, department-isolated, versioned RAG indexes.
-- Safe to review independently. This file is NOT executed by the application.

begin;

create extension if not exists vector;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  track_label text not null default 'Academic track',
  tracks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.departments (name, track_label, tracks) values (
  'CCSICT',
  'Academic track',
  '["Data Mining", "Web Development", "Network Security", "Intelligent Systems", "Information Management"]'::jsonb
)
on conflict (name) do nothing;

alter table public.papers add column if not exists department text not null default 'CCSICT';
alter table public.papers add column if not exists active_index_version uuid default gen_random_uuid();
update public.papers set active_index_version = gen_random_uuid() where active_index_version is null;
alter table public.papers alter column active_index_version set not null;
alter table public.papers alter column active_index_version set default gen_random_uuid();

alter table public.chunks add column if not exists page_start integer;
alter table public.chunks add column if not exists page_end integer;
alter table public.chunks add column if not exists section text;
alter table public.chunks add column if not exists index_version uuid;
alter table public.chunks add column if not exists indexed_at timestamptz not null default now();

-- Preserve every legacy paper immediately by assigning its existing chunks to
-- the generated active version. No embedding is replaced by this migration.
update public.chunks c
set index_version = p.active_index_version
from public.papers p
where c.paper_id = p.id and c.index_version is null;
alter table public.chunks alter column index_version set not null;

create unique index if not exists chunks_version_position_idx
  on public.chunks (paper_id, index_version, chunk_index);

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

delete from public.system_settings
where key in ('duplication_threshold', 'retrieval_threshold', 'retrieval_match_count');

drop function if exists public.match_chunks(vector(768), int, float);
drop function if exists public.match_chunks(vector(768), int, float, text);
create function public.match_chunks(
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
  select c.id, c.paper_id, c.chunk_index, c.content, c.metadata,
         c.page_start, c.page_end, c.section,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  where c.index_version = p.active_index_version
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

drop function if exists public.check_topic_duplication(vector(768), float);
drop function if exists public.check_topic_duplication(vector(768), float, text);
create function public.check_topic_duplication(
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
  select c.id, p.id, p.title, p.authors, p.year, p.track, p.abstract,
         c.content, c.chunk_index, p.department, c.page_start, c.page_end,
         c.section, 1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  where c.index_version = p.active_index_version
    and 1 - (c.embedding <=> query_embedding) >= dup_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit 1;
end;
$$;

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
    and exists (
      select 1 from public.chunks newer
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

alter table public.departments enable row level security;
do $$
declare existing_policy record;
begin
  for existing_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'departments'
  loop
    execute format('drop policy if exists %I on public.departments', existing_policy.policyname);
  end loop;
end;
$$;

commit;
