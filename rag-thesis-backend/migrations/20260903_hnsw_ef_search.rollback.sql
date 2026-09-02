-- Revert 20260903_hnsw_ef_search.sql: drop the per-function ef_search setting
-- and leave both RPCs on the server default of 40.
--
-- `alter function ... reset` removes only the setting, so the bodies stay
-- exactly as 20260819_thesis_category.sql left them. That is the reason this
-- file exists rather than an instruction to replay 20260819: replaying it would
-- reapply everything else in that migration too.
--
-- Retrieval can under-return top-k again once this runs. Only use it if the
-- setting is implicated in a problem, or when moving to
-- `hnsw.iterative_scan` on pgvector 0.8.0 or newer.

begin;

alter function public.match_chunks(
  vector(768), integer, double precision, text, text, integer, text
) reset hnsw.ef_search;

alter function public.check_topic_duplication(
  vector(768), double precision, text, text, integer, text
) reset hnsw.ef_search;

commit;
