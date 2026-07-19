-- Security, ingestion-state, and strict indirect-access migration.
-- Validate in a disposable Supabase project before production use.

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
    case when new.raw_user_meta_data ->> 'requested_role' = 'faculty'
      then 'pending' else 'approved' end
  ) on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.profiles add column if not exists avatar_url text;

alter table public.papers add column if not exists ingestion_status text not null default 'ready';
alter table public.papers add column if not exists redaction_stats jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'papers_ingestion_status_check'
  ) then
    alter table public.papers add constraint papers_ingestion_status_check
      check (ingestion_status in ('processing', 'ready', 'failed', 'deletion_pending'));
  end if;
end $$;

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

drop trigger if exists protect_profile_security_fields on public.profiles;
create trigger protect_profile_security_fields
  before update on public.profiles
  for each row execute function public.protect_profile_security_fields();

create or replace function public.match_chunks(
  query_embedding vector(768), match_count int default 5,
  match_threshold float default 0.3, p_department text default null
)
returns table (
  id bigint, paper_id uuid, chunk_index integer, content text, metadata jsonb,
  page_start integer, page_end integer, section text, similarity float
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
    and p.ingestion_status = 'ready'
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

create or replace function public.check_topic_duplication(
  query_embedding vector(768), dup_threshold float default 0.85,
  p_department text default null
)
returns table (
  chunk_id bigint, paper_id uuid, title text, authors text, year integer,
  track text, abstract text, chunk_content text, chunk_index integer,
  department text, page_start integer, page_end integer, section text,
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
    and p.ingestion_status = 'ready'
    and 1 - (c.embedding <=> query_embedding) >= dup_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit 1;
end;
$$;
