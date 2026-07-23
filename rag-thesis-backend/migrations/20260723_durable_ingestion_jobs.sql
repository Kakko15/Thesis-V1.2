-- Durable, leased, idempotent thesis-ingestion queue (Items 5 and 7).
-- Apply to a disposable project first. All objects remain backend/service-role only.

alter table public.upload_jobs
  add column if not exists idempotency_key uuid,
  add column if not exists source_path text,
  add column if not exists source_stored boolean not null default false,
  add column if not exists original_filename text,
  add column if not exists content_sha256 text,
  add column if not exists request_payload jsonb not null default '{}'::jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_retry_at timestamptz,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists failure_category text,
  add column if not exists cleanup_status text not null default 'not_required';

update public.upload_jobs
set idempotency_key = id
where idempotency_key is null;

alter table public.upload_jobs
  alter column idempotency_key set not null;

alter table public.upload_jobs drop constraint if exists upload_jobs_owner_id_fkey;
alter table public.upload_jobs
  add constraint upload_jobs_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete restrict;

alter table public.upload_jobs drop constraint if exists upload_jobs_status_check;
alter table public.upload_jobs
  add constraint upload_jobs_status_check
  check (status in ('staging', 'queued', 'processing', 'retry_wait', 'completed', 'failed'));

alter table public.upload_jobs drop constraint if exists upload_jobs_attempt_count_check;
alter table public.upload_jobs
  add constraint upload_jobs_attempt_count_check check (attempt_count >= 0);

alter table public.upload_jobs drop constraint if exists upload_jobs_max_attempts_check;
alter table public.upload_jobs
  add constraint upload_jobs_max_attempts_check check (max_attempts between 1 and 10);

alter table public.upload_jobs drop constraint if exists upload_jobs_cleanup_status_check;
alter table public.upload_jobs
  add constraint upload_jobs_cleanup_status_check
  check (cleanup_status in ('not_required', 'pending', 'processing', 'completed', 'delegated'));

-- A legacy active job cannot be recovered because the old API retained its PDF
-- only in process memory. Preserve the row, but fail it safely instead of
-- allowing a new worker to claim an incomplete payload.
update public.upload_jobs
set status = 'failed',
    stage = 'error',
    progress = 100,
    message = 'The previous ingestion worker stopped before the durable source was staged.',
    error = 'Please submit the manuscript again.',
    failure_category = 'legacy_source_unavailable',
    cleanup_status = 'not_required',
    completed_at = coalesce(completed_at, now()),
    expires_at = coalesce(expires_at, now() + interval '30 days'),
    updated_at = now()
where status in ('queued', 'processing') and source_path is null;

update public.upload_jobs
set completed_at = coalesce(completed_at, updated_at, created_at),
    expires_at = coalesce(expires_at, coalesce(updated_at, created_at) + interval '30 days')
where status in ('completed', 'failed');

create unique index if not exists upload_jobs_owner_idempotency_uidx
  on public.upload_jobs (owner_id, idempotency_key);
create index if not exists upload_jobs_claim_idx
  on public.upload_jobs (status, next_retry_at, created_at)
  where status in ('queued', 'retry_wait', 'processing');
create index if not exists upload_jobs_lease_idx
  on public.upload_jobs (lease_expires_at)
  where status = 'processing';
create index if not exists upload_jobs_cleanup_idx
  on public.upload_jobs (cleanup_status, completed_at)
  where cleanup_status = 'pending';
create index if not exists upload_jobs_expiry_idx
  on public.upload_jobs (expires_at)
  where status in ('completed', 'failed');

create or replace function public.reserve_upload_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_department text,
  p_idempotency_key uuid,
  p_source_path text,
  p_original_filename text,
  p_content_sha256 text,
  p_request_payload jsonb,
  p_max_attempts integer default 3
)
returns table (
  job_id uuid,
  job_status text,
  stored_source_path text,
  stored_content_sha256 text,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.upload_jobs%rowtype;
  v_created boolean := false;
begin
  if p_owner_id is null or p_idempotency_key is null then
    raise exception 'Owner and idempotency key are required';
  end if;
  if p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid SHA-256 digest';
  end if;
  if p_max_attempts not between 1 and 10 then
    raise exception 'Invalid maximum attempt count';
  end if;

  insert into public.upload_jobs (
    id, owner_id, department, status, stage, progress, message,
    idempotency_key, source_path, original_filename, content_sha256,
    request_payload, max_attempts, cleanup_status
  ) values (
    p_job_id, p_owner_id, p_department, 'staging', 'store', 5,
    'Reserving private storage...', p_idempotency_key, p_source_path,
    p_original_filename, p_content_sha256, coalesce(p_request_payload, '{}'::jsonb),
    p_max_attempts, 'not_required'
  )
  on conflict (owner_id, idempotency_key) do nothing;
  v_created := found;

  select * into v_job
  from public.upload_jobs
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key;

  if v_job.id is null then
    raise exception 'Could not reserve upload job';
  end if;
  if v_job.content_sha256 is distinct from p_content_sha256 then
    raise exception using
      message = 'Idempotency key was already used for different content',
      errcode = '22000';
  end if;

  return query select v_job.id, v_job.status, v_job.source_path,
    v_job.content_sha256, v_created;
end;
$$;

create or replace function public.queue_upload_job(p_job_id uuid, p_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.upload_jobs
  set status = 'queued', stage = 'extract', progress = 8,
      message = 'Queued for durable processing...', source_stored = true,
      next_retry_at = now(), updated_at = now()
  where id = p_job_id and owner_id = p_owner_id and status = 'staging';
  return found;
end;
$$;

create or replace function public.claim_upload_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.upload_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if nullif(trim(p_worker_id), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Invalid worker lease request';
  end if;

  -- Staging reservations never become worker-visible until the PDF is safely stored.
  update public.upload_jobs
  set status = 'failed', stage = 'error', progress = 100,
      message = 'Private source staging did not complete.',
      error = 'Please submit the manuscript again.',
      failure_category = 'staging_timeout',
      source_stored = source_path is not null,
      cleanup_status = case when source_path is not null then 'pending' else 'not_required' end,
      completed_at = now(), expires_at = now() + interval '30 days', updated_at = now()
  where status = 'staging' and updated_at < now() - interval '15 minutes';

  -- A worker that exhausted its final leased attempt cannot be reclaimed.
  update public.upload_jobs
  set status = 'failed', stage = 'error', progress = 100,
      message = 'Ingestion could not complete after the allowed retries.',
      error = 'Please submit the manuscript again later.',
      failure_category = coalesce(failure_category, 'worker_lease_expired'),
      cleanup_status = case when source_stored then 'pending' else 'not_required' end,
      completed_at = now(), expires_at = now() + interval '30 days',
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where status = 'processing' and lease_expires_at < now()
    and attempt_count >= max_attempts;

  select id into v_job_id
  from public.upload_jobs
  where (
      status = 'queued'
      or (status = 'retry_wait' and coalesce(next_retry_at, now()) <= now())
      or (status = 'processing' and lease_expires_at < now())
    )
    and attempt_count < max_attempts
    and source_stored = true
  order by coalesce(next_retry_at, created_at), created_at
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  return query
  update public.upload_jobs
  set status = 'processing', stage = 'download', progress = 10,
      message = 'Durable worker claimed the ingestion job.',
      attempt_count = attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_job_id
  returning *;
end;
$$;

create or replace function public.heartbeat_upload_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_stage text default null,
  p_progress integer default null,
  p_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.upload_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      stage = coalesce(p_stage, stage),
      progress = coalesce(p_progress, progress),
      message = coalesce(p_message, message),
      updated_at = now()
  where id = p_job_id and status = 'processing'
    and lease_owner = p_worker_id and lease_expires_at >= now();
  return found;
end;
$$;

create or replace function public.schedule_upload_retry(
  p_job_id uuid,
  p_worker_id text,
  p_retry_at timestamptz,
  p_failure_category text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.upload_jobs
  set status = 'retry_wait',
      message = 'A temporary service problem occurred. The job will retry automatically.',
      error = null, failure_category = p_failure_category,
      next_retry_at = greatest(p_retry_at, now()),
      lease_owner = null, lease_expires_at = null, heartbeat_at = null,
      updated_at = now()
  where id = p_job_id and status = 'processing'
    and lease_owner = p_worker_id and lease_expires_at >= now()
    and attempt_count < max_attempts;
  return found;
end;
$$;

create or replace function public.fail_upload_job(
  p_job_id uuid,
  p_worker_id text,
  p_failure_category text,
  p_public_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.upload_jobs
  set status = 'failed', stage = 'error', progress = 100,
      message = 'Ingestion failed.', error = p_public_error,
      failure_category = p_failure_category,
      cleanup_status = case when source_stored then 'pending' else 'not_required' end,
      completed_at = now(), expires_at = now() + interval '30 days',
      lease_owner = null, lease_expires_at = null, heartbeat_at = null,
      updated_at = now()
  where id = p_job_id and status = 'processing'
    and lease_owner = p_worker_id and lease_expires_at >= now();
  return found;
end;
$$;

create or replace function public.commit_upload_ingestion(
  p_job_id uuid,
  p_worker_id text,
  p_paper jsonb,
  p_chunks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.upload_jobs%rowtype;
  v_paper_id uuid;
begin
  select * into v_job from public.upload_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Upload job not found';
  end if;
  if v_job.status = 'completed' and v_job.paper_id is not null then
    return v_job.paper_id;
  end if;
  if v_job.status <> 'processing' or v_job.lease_owner is distinct from p_worker_id
      or v_job.lease_expires_at < now() then
    raise exception 'Upload worker lease is no longer valid';
  end if;
  if nullif(p_paper ->> 'id', '')::uuid is distinct from p_job_id then
    raise exception 'Paper identifier must match upload job';
  end if;

  v_paper_id := public.commit_paper_ingestion(p_paper, p_chunks);

  update public.upload_jobs
  set status = 'completed', stage = 'done', progress = 100,
      message = 'Thesis indexed successfully.', paper_id = v_paper_id,
      chunks = jsonb_array_length(p_chunks),
      duplication = p_paper -> 'duplication_scan', error = null,
      failure_category = null, cleanup_status = 'not_required',
      completed_at = now(), expires_at = now() + interval '30 days',
      lease_owner = null, lease_expires_at = null, heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id;
  return v_paper_id;
end;
$$;

create or replace function public.claim_upload_cleanup(p_worker_id text)
returns setof public.upload_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.upload_jobs
  where status = 'failed' and cleanup_status = 'pending' and source_stored = true
  order by completed_at nulls first, created_at
  for update skip locked
  limit 1;
  if v_job_id is null then return; end if;
  return query
  update public.upload_jobs
  set cleanup_status = 'processing', lease_owner = p_worker_id,
      lease_expires_at = now() + interval '120 seconds', updated_at = now()
  where id = v_job_id
  returning *;
end;
$$;

create or replace function public.finish_upload_cleanup(
  p_job_id uuid,
  p_worker_id text,
  p_delegated boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.upload_jobs
  set cleanup_status = case when p_delegated then 'delegated' else 'completed' end,
      source_stored = case when p_delegated then source_stored else false end,
      lease_owner = null, lease_expires_at = null,
      updated_at = now()
  where id = p_job_id and cleanup_status = 'processing' and lease_owner = p_worker_id;
  return found;
end;
$$;

create or replace function public.expire_upload_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  -- Recover cleanup claims abandoned by a stopped worker.
  update public.upload_jobs
  set cleanup_status = 'pending', lease_owner = null, lease_expires_at = null, updated_at = now()
  where cleanup_status = 'processing' and lease_expires_at < now();

  delete from public.upload_jobs
  where expires_at < now()
    and (
      (status = 'completed' and cleanup_status = 'not_required')
      or (
        status = 'failed' and source_stored = false
        and cleanup_status in ('not_required', 'completed')
      )
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.reserve_upload_job(uuid, uuid, text, uuid, text, text, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.queue_upload_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_upload_job(text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_upload_job(uuid, text, integer, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.schedule_upload_retry(uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.fail_upload_job(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.commit_upload_ingestion(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_upload_cleanup(text) from public, anon, authenticated;
revoke all on function public.finish_upload_cleanup(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.expire_upload_jobs() from public, anon, authenticated;

grant execute on function public.reserve_upload_job(uuid, uuid, text, uuid, text, text, text, jsonb, integer)
  to service_role;
grant execute on function public.queue_upload_job(uuid, uuid) to service_role;
grant execute on function public.claim_upload_job(text, integer) to service_role;
grant execute on function public.heartbeat_upload_job(uuid, text, integer, text, integer, text)
  to service_role;
grant execute on function public.schedule_upload_retry(uuid, text, timestamptz, text)
  to service_role;
grant execute on function public.fail_upload_job(uuid, text, text, text) to service_role;
grant execute on function public.commit_upload_ingestion(uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.claim_upload_cleanup(text) to service_role;
grant execute on function public.finish_upload_cleanup(uuid, text, boolean) to service_role;
grant execute on function public.expire_upload_jobs() to service_role;

alter table public.upload_jobs enable row level security;
revoke all on table public.upload_jobs from public, anon, authenticated;
grant all on table public.upload_jobs to service_role;
