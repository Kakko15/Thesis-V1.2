-- Rollback for 20260924_paper_panel.sql

begin;

drop trigger if exists a_papers_hydrate_panel on public.papers;
drop function if exists public.hydrate_paper_panel();
alter table public.papers drop column if exists panel_chair;
alter table public.papers drop column if exists panel_members;

commit;
