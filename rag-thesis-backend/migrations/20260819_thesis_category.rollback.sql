-- Rollback for 20260819_thesis_category.sql.
-- Run only while reverting to the pre-category application build: category
-- filtering requests fail once the column is gone, though unfiltered browse
-- survives through the papers legacy-fields fallback.

-- Restore the six-argument match_chunks exactly as defined by
-- 20260720_index_embedding_provenance.sql.
drop function if exists public.match_chunks(
  vector(768), integer, double precision, text, text, integer, text
);
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

-- Restore the five-argument check_topic_duplication exactly as defined by
-- 20260720_index_embedding_provenance.sql.
drop function if exists public.check_topic_duplication(
  vector(768), double precision, text, text, integer, text
);
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

-- Restore the hydrate function exactly as defined by
-- 20260725_normalized_academic_catalog.sql.
create or replace function public.hydrate_paper_academic_classification()
returns trigger language plpgsql set search_path = public as $$
declare v_payload jsonb;
begin
  select request_payload into v_payload from public.upload_jobs where id = new.id;
  if v_payload is not null then
    new.program_id := nullif(v_payload ->> 'program_id', '')::uuid;
    new.specialization_id := nullif(v_payload ->> 'specialization_id', '')::uuid;
    new.legacy_track := nullif(v_payload ->> 'legacy_track', '');
    new.classification_status := coalesce(
      nullif(v_payload ->> 'classification_status', ''), 'unclassified'
    );
  end if;
  return new;
end $$;

drop index if exists public.papers_thesis_category_idx;
alter table public.papers drop constraint if exists papers_thesis_category_check;
alter table public.upload_jobs drop constraint if exists upload_jobs_thesis_category_check;
alter table public.papers drop column if exists thesis_category;
alter table public.upload_jobs drop column if exists thesis_category;
