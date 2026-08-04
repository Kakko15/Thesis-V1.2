-- ============================================================================
-- Rollback for 20260804_backup_runs.sql (8.1).
--
-- Removes backup-run recording. Backup staleness becomes unobservable from the
-- API again -- check_backup_freshness.ps1 still works, but only on the backup
-- machine itself. Set BACKUP_RPO_HOURS=0 before running this, or the operations
-- monitor will query a table that no longer exists.
-- ============================================================================

drop function if exists public.record_backup_run(text, timestamptz, integer, bigint, text, text);
drop index if exists public.backup_runs_completed_idx;
drop table if exists public.backup_runs;
