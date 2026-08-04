-- ============================================================================
-- 8.1 -- record completed backups so staleness can be alerted on.
--
-- The backup tooling (scripts/backup_system.ps1 and friends) already produces
-- encrypted, hashed, verifiable backups. What was missing is that nothing
-- outside the backup machine knew whether a backup had actually run. A nightly
-- task that silently stopped firing -- an expired account password, a machine
-- left off, a full disk -- looked identical to a healthy system, and
-- check_backup_freshness.ps1 can only answer the question while standing on
-- that same machine.
--
-- Each successful run now records one row here, and the operations monitor
-- raises a `backup_stale` alert when the newest row is older than the declared
-- RPO. That turns "did last night's backup run?" into something the existing
-- alert pipeline answers.
--
-- Privacy: no filesystem paths and no hostnames. The machine is identified by a
-- caller-supplied opaque fingerprint, matching how ingestion_workers hashes its
-- worker ids. The manifest hash is a digest of a digest list -- it identifies a
-- backup without describing its contents.
--
-- Additive and idempotent.
-- Rollback: 20260804_backup_runs.rollback.sql
-- ============================================================================

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  -- The backup folder stamp (yyyy-MM-dd-HHmmss). Unique so a retried recording
  -- of the same run updates rather than duplicates.
  backup_id text not null unique,
  completed_at timestamptz not null,
  artifact_count integer not null default 0 check (artifact_count >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  manifest_sha256 text,
  host_fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists backup_runs_completed_idx
  on public.backup_runs (completed_at desc);

-- ----------------------------------------------------------------------------
-- Recording RPC. The backup machine already holds the service-role key (it
-- needs it to dump the database), so it calls this rather than writing to the
-- table directly -- the insert stays inside a checked, auditable surface.
-- ----------------------------------------------------------------------------
create or replace function public.record_backup_run(
  p_backup_id text,
  p_completed_at timestamptz,
  p_artifact_count integer,
  p_total_bytes bigint,
  p_manifest_sha256 text default null,
  p_host_fingerprint text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_backup_id is null or length(trim(p_backup_id)) = 0 then
    raise exception 'A backup id is required';
  end if;
  if p_completed_at is null then
    raise exception 'A completion timestamp is required';
  end if;
  -- A backup that produced no artifacts did not succeed, whatever the caller
  -- believes. Recording it would silence the staleness alert for nothing.
  if coalesce(p_artifact_count, 0) <= 0 then
    raise exception 'A completed backup must record at least one artifact';
  end if;

  insert into public.backup_runs as target (
    backup_id, completed_at, artifact_count, total_bytes,
    manifest_sha256, host_fingerprint
  ) values (
    trim(p_backup_id), p_completed_at, p_artifact_count,
    coalesce(p_total_bytes, 0), p_manifest_sha256, p_host_fingerprint
  )
  on conflict (backup_id) do update set
    completed_at = excluded.completed_at,
    artifact_count = excluded.artifact_count,
    total_bytes = excluded.total_bytes,
    manifest_sha256 = excluded.manifest_sha256,
    host_fingerprint = excluded.host_fingerprint
  returning target.id into v_id;

  return v_id;
end;
$$;

alter table public.backup_runs enable row level security;

revoke all on table public.backup_runs from public, anon, authenticated;
revoke all on table public.backup_runs from service_role;
grant select on table public.backup_runs to service_role;

revoke all on function public.record_backup_run(text, timestamptz, integer, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.record_backup_run(text, timestamptz, integer, bigint, text, text)
  to service_role;
