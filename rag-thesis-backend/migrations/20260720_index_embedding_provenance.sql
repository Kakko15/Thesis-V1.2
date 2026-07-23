-- Item 34: deterministic per-index embedding and preprocessing provenance.
-- Validate in the disposable project before applying to production.

begin;

create table if not exists public.paper_index_versions (
  paper_id uuid not null references public.papers(id) on delete cascade,
  index_version uuid not null,
  embedding_model text not null,
  embedding_dimensions integer not null check (embedding_dimensions = 768),
  preprocessing_version text not null,
  chunking_version text not null,
  tokenizer text,
  chunk_size_tokens integer check (chunk_size_tokens is null or chunk_size_tokens > 0),
  chunk_overlap_tokens integer check (
    chunk_overlap_tokens is null or chunk_overlap_tokens >= 0
  ),
  provenance_status text not null check (
    provenance_status in ('verified', 'legacy_assumed')
  ),
  constraint verified_index_provenance_is_current check (
    provenance_status = 'legacy_assumed'
    or (
      preprocessing_version = 'document-v1'
      and chunking_version = 'token-v1'
      and tokenizer = 'cl100k_base'
      and chunk_size_tokens = 800
      and chunk_overlap_tokens = 100
    )
  ),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  primary key (paper_id, index_version)
);

-- Repository history proves the existing vector space used this model at
-- 768 dimensions. Preprocessing remains explicitly unverified for indexes
-- created before provenance was stored.
insert into public.paper_index_versions (
  paper_id, index_version, embedding_model, embedding_dimensions,
  preprocessing_version, chunking_version, tokenizer,
  chunk_size_tokens, chunk_overlap_tokens, provenance_status,
  created_at, activated_at
)
select
  c.paper_id,
  c.index_version,
  'models/gemini-embedding-2',
  768,
  'legacy-document-v0',
  case
    when bool_and(coalesce(c.metadata ->> 'chunking_version', '') = 'token-v1')
      then 'token-v1'
    else 'legacy-char-v0'
  end,
  case
    when bool_and(coalesce(c.metadata ->> 'tokenizer', '') = 'cl100k_base')
      then 'cl100k_base'
    else null
  end,
  case
    when bool_and(coalesce(c.metadata ->> 'chunk_size_tokens', '') ~ '^[0-9]+$')
      then max(case
        when coalesce(c.metadata ->> 'chunk_size_tokens', '') ~ '^[0-9]+$'
          then (c.metadata ->> 'chunk_size_tokens')::integer
        else null
      end)
    else null
  end,
  case
    when bool_and(coalesce(c.metadata ->> 'chunk_overlap_tokens', '') ~ '^[0-9]+$')
      then max(case
        when coalesce(c.metadata ->> 'chunk_overlap_tokens', '') ~ '^[0-9]+$'
          then (c.metadata ->> 'chunk_overlap_tokens')::integer
        else null
      end)
    else null
  end,
  'legacy_assumed',
  min(c.indexed_at),
  case when c.index_version = p.active_index_version then now() else null end
from public.chunks c
join public.papers p on p.id = c.paper_id
group by c.paper_id, c.index_version, p.active_index_version
on conflict (paper_id, index_version) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chunks_index_provenance_fkey'
  ) then
    alter table public.chunks
      add constraint chunks_index_provenance_fkey
      foreign key (paper_id, index_version)
      references public.paper_index_versions(paper_id, index_version)
      on delete restrict;
  end if;
end;
$$;

alter table public.paper_index_versions enable row level security;
revoke all on table public.paper_index_versions from public, anon, authenticated;
grant all on table public.paper_index_versions to service_role;

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
  v_provenance jsonb := p_paper -> 'index_provenance';
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
  if coalesce(jsonb_typeof(v_provenance), 'null') <> 'object'
     or nullif(v_provenance ->> 'embedding_model', '') is null
     or coalesce((v_provenance ->> 'embedding_dimensions')::integer, 0) <> 768
     or coalesce(v_provenance ->> 'preprocessing_version', '') <> 'document-v1'
     or coalesce(v_provenance ->> 'chunking_version', '') <> 'token-v1'
     or coalesce(v_provenance ->> 'tokenizer', '') <> 'cl100k_base'
     or coalesce((v_provenance ->> 'chunk_size_tokens')::integer, 0) <> 800
     or coalesce((v_provenance ->> 'chunk_overlap_tokens')::integer, -1) <> 100
     or coalesce(v_provenance ->> 'provenance_status', '') <> 'verified' then
    raise exception 'Verified 768-dimensional index provenance is required';
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

  insert into public.paper_index_versions (
    paper_id, index_version, embedding_model, embedding_dimensions,
    preprocessing_version, chunking_version, tokenizer,
    chunk_size_tokens, chunk_overlap_tokens, provenance_status
  ) values (
    v_paper_id, v_index_version, v_provenance ->> 'embedding_model',
    (v_provenance ->> 'embedding_dimensions')::integer,
    v_provenance ->> 'preprocessing_version', v_provenance ->> 'chunking_version',
    nullif(v_provenance ->> 'tokenizer', ''),
    nullif(v_provenance ->> 'chunk_size_tokens', '')::integer,
    nullif(v_provenance ->> 'chunk_overlap_tokens', '')::integer,
    'verified'
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
  update public.paper_index_versions set activated_at = now()
  where paper_id = v_paper_id and index_version = v_index_version;
  return v_paper_id;
end;
$$;

revoke all on function public.commit_paper_ingestion(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_paper_ingestion(jsonb, jsonb) to service_role;

drop function if exists public.match_chunks(vector(768), integer, double precision, text);
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count integer,
  match_threshold double precision,
  p_department text,
  p_embedding_model text,
  p_embedding_dimensions integer
)
returns table (
  id bigint, paper_id uuid, chunk_index integer, content text, metadata jsonb,
  page_start integer, page_end integer, section text, similarity double precision
)
language sql
stable
as $$
  select c.id, c.paper_id, c.chunk_index, c.content, c.metadata,
         c.page_start, c.page_end, c.section,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  join public.paper_index_versions piv
    on piv.paper_id = c.paper_id and piv.index_version = c.index_version
  where c.index_version = p.active_index_version
    and p.ingestion_status = 'ready'
    and piv.embedding_model = p_embedding_model
    and piv.embedding_dimensions = p_embedding_dimensions
    and piv.provenance_status in ('verified', 'legacy_assumed')
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_chunks(
  vector(768), integer, double precision, text, text, integer
) from public, anon, authenticated;
grant execute on function public.match_chunks(
  vector(768), integer, double precision, text, text, integer
) to service_role;

drop function if exists public.check_topic_duplication(vector(768), double precision, text);
create or replace function public.check_topic_duplication(
  query_embedding vector(768),
  dup_threshold double precision,
  p_department text,
  p_embedding_model text,
  p_embedding_dimensions integer
)
returns table (
  chunk_id bigint, paper_id uuid, title text, authors text, year integer,
  track text, abstract text, chunk_content text, chunk_index integer,
  department text, page_start integer, page_end integer, section text,
  similarity double precision
)
language sql
stable
as $$
  select c.id, p.id, p.title, p.authors, p.year, p.track, p.abstract,
         c.content, c.chunk_index, p.department, c.page_start, c.page_end,
         c.section, 1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.papers p on p.id = c.paper_id
  join public.paper_index_versions piv
    on piv.paper_id = c.paper_id and piv.index_version = c.index_version
  where c.index_version = p.active_index_version
    and p.ingestion_status = 'ready'
    and piv.embedding_model = p_embedding_model
    and piv.embedding_dimensions = p_embedding_dimensions
    and piv.provenance_status in ('verified', 'legacy_assumed')
    and 1 - (c.embedding <=> query_embedding) >= dup_threshold
    and (p_department is null or p.department = p_department)
  order by c.embedding <=> query_embedding
  limit 1;
$$;

revoke all on function public.check_topic_duplication(
  vector(768), double precision, text, text, integer
) from public, anon, authenticated;
grant execute on function public.check_topic_duplication(
  vector(768), double precision, text, text, integer
) to service_role;

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
  if not exists (
    select 1 from public.paper_index_versions
    where paper_id = p_paper_id and index_version = p_index_version
      and provenance_status in ('verified', 'legacy_assumed')
  ) then
    raise exception 'Cannot activate an index without compatible provenance';
  end if;

  update public.papers set active_index_version = p_index_version
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

create or replace function public.prune_inactive_indexes(
  p_older_than_days integer default 7
)
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

  create temporary table if not exists provenance_prune_versions (
    paper_id uuid,
    index_version uuid,
    primary key (paper_id, index_version)
  ) on commit drop;
  truncate provenance_prune_versions;
  insert into provenance_prune_versions (paper_id, index_version)
    select piv.paper_id, piv.index_version
    from public.paper_index_versions piv
    join public.papers p on p.id = piv.paper_id
    where piv.index_version <> p.active_index_version
      and piv.created_at < now() - make_interval(days => p_older_than_days)
      and exists (
        select 1 from public.paper_index_versions newer
        where newer.paper_id = piv.paper_id
          and newer.index_version <> p.active_index_version
          and newer.index_version <> piv.index_version
          and newer.created_at > piv.created_at
      )
  ;

  delete from public.chunks c using provenance_prune_versions e
    where c.paper_id = e.paper_id and c.index_version = e.index_version
  ;
  get diagnostics deleted_count = row_count;

  delete from public.paper_index_versions piv using provenance_prune_versions e
  where piv.paper_id = e.paper_id and piv.index_version = e.index_version;
  return deleted_count;
end;
$$;

revoke all on function public.prune_inactive_indexes(integer)
  from public, anon, authenticated;
grant execute on function public.prune_inactive_indexes(integer) to service_role;

commit;
