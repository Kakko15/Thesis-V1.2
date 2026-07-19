-- Atomic new-paper ingestion and retryable private-storage cleanup.
-- Apply only after 20260717_rag_items_9_16.sql and
-- 20260717_security_scope_evaluation.sql in a disposable project first.

alter table public.papers drop constraint if exists papers_ingestion_status_check;
alter table public.papers add constraint papers_ingestion_status_check
  check (ingestion_status in ('processing', 'ready', 'failed', 'deletion_pending'));

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

alter table public.storage_cleanup_queue enable row level security;
revoke all on table public.storage_cleanup_queue from public, anon, authenticated;
grant all on table public.storage_cleanup_queue to service_role;
grant usage, select on sequence public.storage_cleanup_queue_id_seq to service_role;

create or replace function public.commit_paper_ingestion(
  p_paper jsonb,
  p_chunks jsonb
)
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
    v_paper_id,
    p_paper ->> 'title',
    nullif(p_paper ->> 'authors', ''),
    nullif(p_paper ->> 'year', '')::integer,
    nullif(p_paper ->> 'abstract', ''),
    nullif(p_paper ->> 'track', ''),
    p_paper ->> 'content',
    p_paper ->> 'filename',
    p_paper ->> 'storage_path',
    v_expected_count,
    p_paper -> 'duplication_scan',
    nullif(p_paper ->> 'uploaded_by', '')::uuid,
    coalesce(nullif(p_paper ->> 'department', ''), 'CCSICT'),
    v_index_version,
    'processing',
    coalesce(p_paper -> 'redaction_stats', '{}'::jsonb)
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
      v_paper_id,
      (v_chunk ->> 'chunk_index')::integer,
      v_chunk ->> 'content',
      (v_chunk -> 'embedding')::text::vector,
      coalesce(v_chunk -> 'metadata', '{}'::jsonb),
      nullif(v_chunk ->> 'page_start', '')::integer,
      nullif(v_chunk ->> 'page_end', '')::integer,
      nullif(v_chunk ->> 'section', ''),
      v_index_version
    );
  end loop;

  select count(*) into v_inserted_count
  from public.chunks
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
