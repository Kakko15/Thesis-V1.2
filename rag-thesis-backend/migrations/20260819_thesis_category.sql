-- Thesis authorship provenance: every paper is a 'student' (undergraduate)
-- or 'faculty' thesis. This classifies the manuscript, not the uploader --
-- profiles.role also has a 'faculty' value and the two are deliberately
-- unrelated (an admin may upload a faculty-authored thesis).
--
-- Additive and idempotent. Existing rows backfill to 'student': everything
-- ingested before this migration is undergraduate work (proposal Section 1.3),
-- which also keeps the locked PI-08 evaluation corpus student-only.
--
-- The evaluated retrieval path stays frozen: match_chunks and
-- check_topic_duplication gain one trailing parameter that defaults to null,
-- and the application omits the key entirely unless a category filter was
-- requested, so every pre-existing call resolves to identical behaviour.
--
-- Rollback: 20260819_thesis_category.rollback.sql

alter table public.papers
  add column if not exists thesis_category text not null default 'student';
-- Forward-compat mirror of the papers column; request_payload remains the
-- authoritative carrier that the hydrate trigger reads.
alter table public.upload_jobs
  add column if not exists thesis_category text not null default 'student';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'papers_thesis_category_check'
  ) then
    alter table public.papers add constraint papers_thesis_category_check
      check (thesis_category in ('student', 'faculty'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'upload_jobs_thesis_category_check'
  ) then
    alter table public.upload_jobs add constraint upload_jobs_thesis_category_check
      check (thesis_category in ('student', 'faculty'));
  end if;
end;
$$;

create index if not exists papers_thesis_category_idx
  on public.papers (department, thesis_category) where ingestion_status = 'ready';

-- Same body as 20260725_normalized_academic_catalog.sql plus the
-- thesis_category line. Payloads queued by older application builds carry no
-- key, so they hydrate to 'student'. The trigger object itself is unchanged.
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
    new.thesis_category := coalesce(
      nullif(v_payload ->> 'thesis_category', ''), 'student'
    );
  end if;
  return new;
end $$;

-- Same body as 20260720_index_embedding_provenance.sql plus the defaulted
-- p_thesis_category parameter and its null-safe predicate. The six-argument
-- signature must be dropped (not replaced) because the argument list changes;
-- six-named-argument PostgREST calls from older builds still resolve through
-- the default.
drop function if exists public.match_chunks(
  vector(768), integer, double precision, text, text, integer
);
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count integer,
  match_threshold double precision,
  p_department text,
  p_embedding_model text,
  p_embedding_dimensions integer,
  p_thesis_category text default null
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
    and (p_thesis_category is null or p.thesis_category = p_thesis_category)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_chunks(
  vector(768), integer, double precision, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.match_chunks(
  vector(768), integer, double precision, text, text, integer, text
) to service_role;

drop function if exists public.check_topic_duplication(
  vector(768), double precision, text, text, integer
);
create or replace function public.check_topic_duplication(
  query_embedding vector(768),
  dup_threshold double precision,
  p_department text,
  p_embedding_model text,
  p_embedding_dimensions integer,
  p_thesis_category text default null
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
    and (p_thesis_category is null or p.thesis_category = p_thesis_category)
  order by c.embedding <=> query_embedding
  limit 1;
$$;

revoke all on function public.check_topic_duplication(
  vector(768), double precision, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.check_topic_duplication(
  vector(768), double precision, text, text, integer, text
) to service_role;

-- Guardrails: this migration never deletes rows or rewrites existing values;
-- the 'student' backfill is the documented pre-migration reality.
