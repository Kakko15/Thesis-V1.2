-- Production hardening: account state, durable jobs, department integrity,
-- atomic chat persistence, avatar storage, and strict indirect PDF access.
-- Validate in the disposable Supabase project before production application.

begin;

alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists avatar_url text;

update public.profiles
set avatar_url = split_part(avatar_url, '/storage/v1/object/public/avatars/', 2)
where avatar_url like '%/storage/v1/object/public/avatars/%';
update public.profiles
set avatar_url = null
where avatar_url is not null and avatar_url not like id::text || '/%';

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

alter table public.chat_sessions
  add column if not exists department text not null default 'CCSICT';
alter table public.activity_log add column if not exists department text;

update public.chat_sessions s
set department = p.department
from public.profiles p
where p.id = s.user_id and s.department is distinct from p.department;

update public.activity_log a
set department = p.department
from public.profiles p
where p.id = a.user_id and a.department is null;

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

create index if not exists upload_jobs_owner_idx
  on public.upload_jobs (owner_id, created_at desc);
create index if not exists upload_jobs_status_idx
  on public.upload_jobs (status, updated_at);
create index if not exists activity_log_department_idx
  on public.activity_log (department, created_at desc);
create index if not exists chat_sessions_department_idx
  on public.chat_sessions (department, created_at desc);

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

alter table public.upload_jobs enable row level security;
revoke all on table public.upload_jobs from public, anon, authenticated;
grant all on table public.upload_jobs to service_role;

-- Chat persistence is backend-owned; remove direct client mutation paths.
revoke all on table public.chat_sessions, public.chat_messages from anon, authenticated;
drop policy if exists "sessions_owner_all" on public.chat_sessions;
drop policy if exists "messages_owner_all" on public.chat_messages;

-- Novelty records may contain bounded comparison evidence used only by the
-- backend reviewer. Clients read sanitized responses through the API.
revoke all on table public.scan_history from public, anon, authenticated;
drop policy if exists "scans_owner_all" on public.scan_history;

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

commit;
