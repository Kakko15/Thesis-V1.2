-- Keep the displayed chunk total aligned with the active rebuilt index.
-- `activate_paper_index` is the only transition that changes which index is
-- searchable, so it updates the total in the same database transaction.
create or replace function public.activate_paper_index(
  p_paper_id uuid,
  p_index_version uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chunk_count integer;
begin
  select count(*) into v_chunk_count
  from public.chunks
  where paper_id = p_paper_id and index_version = p_index_version;

  if v_chunk_count = 0 then
    raise exception 'Cannot activate an empty or missing index version';
  end if;
  if not exists (
    select 1 from public.paper_index_versions
    where paper_id = p_paper_id and index_version = p_index_version
      and provenance_status in ('verified', 'legacy_assumed')
  ) then
    raise exception 'Cannot activate an index without compatible provenance';
  end if;

  update public.papers
  set active_index_version = p_index_version,
      chunk_count = v_chunk_count
  where id = p_paper_id;
  if not found then
    raise exception 'Paper not found';
  end if;
  update public.paper_index_versions set activated_at = now()
  where paper_id = p_paper_id and index_version = p_index_version;
end;
$$;

revoke all on function public.activate_paper_index(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_paper_index(uuid, uuid) to service_role;
