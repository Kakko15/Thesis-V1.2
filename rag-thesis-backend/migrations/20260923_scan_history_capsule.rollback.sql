-- Revert 20260923_scan_history_capsule.sql.
--
-- Drops the per-section results of every capsule scan. The scans themselves
-- stay in history with their overall figures and write-up, and read back as
-- ordinary scans. GET /duplication/history keeps working without the column;
-- POST /duplication/capsule answers 503 until it is re-applied.

begin;

alter table public.scan_history drop column if exists capsule_sections;

commit;
