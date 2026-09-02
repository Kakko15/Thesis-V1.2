-- Guarantee top-k survives HNSW post-filtering.
--
-- Both retrieval RPCs order by the HNSW index and then apply six equality
-- predicates -- active index version, ready status, embedding model, embedding
-- dimensions, provenance status, department -- plus a similarity floor and an
-- optional thesis category. Postgres applies all of that *after* the index has
-- produced its candidates, and a non-iterative HNSW scan produces at most
-- `hnsw.ef_search` of them, which defaults to 40. With selective filters, and
-- especially while a reindex leaves the previous index version in place for its
-- seven-day rollback window, fewer than `match_count` rows can survive even
-- though qualifying chunks exist. Retrieval then quietly returns a short
-- context, and Context Precision gets measured against it.
--
-- 100 is 20x the configured retrieval_match_count of 5 and 2.5x the default:
-- ample headroom for an archive of this size, at negligible scan cost. The
-- cleaner fix is `hnsw.iterative_scan`, which keeps searching until enough rows
-- pass the filter, but that needs pgvector 0.8.0 and this deployment's version
-- is Supabase-managed and recorded nowhere in this repository. `ef_search` has
-- existed since pgvector 0.5.0, so it is the portable choice. Revisit once the
-- live extension version is confirmed.
--
-- Set on the function rather than the session on purpose: the RPC *is* the
-- retrieval contract, and PostgREST offers no per-request GUC hook. The cost is
-- that a `language sql` function carrying a SET clause can no longer be inlined
-- by the planner. The body still uses the index, so this trades a planning
-- nicety for a correctness guarantee.
--
-- The bodies below are otherwise character-for-character the ones from
-- 20260819_thesis_category.sql. Reverting by replaying that file would reapply
-- the rest of it too, which is the out-of-order hazard the README warns about;
-- use 20260903_hnsw_ef_search.rollback.sql instead.

begin;

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
set hnsw.ef_search = 100
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
set hnsw.ef_search = 100
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

commit;
