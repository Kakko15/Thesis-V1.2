-- The thesis examining panel (panel chair and panel members), recorded on each
-- paper for the Thesis Library alongside the adviser.
--
-- Optional at upload and autofilled from the manuscript's approval sheet when
-- it names a PANEL COMMITTEE (services/front_matter.py::extract_panel).
--
-- Retrieval is untouched: match_chunks, check_topic_duplication,
-- commit_paper_ingestion and the chunk metadata are not redefined.
--
-- Rollback: 20260924_paper_panel.rollback.sql

begin;

alter table public.papers add column if not exists panel_chair text;
alter table public.papers add column if not exists panel_members text;

create or replace function public.hydrate_paper_panel()
returns trigger language plpgsql set search_path = public as $$
declare v_payload jsonb;
begin
  select request_payload into v_payload from public.upload_jobs where id = new.id;
  if v_payload is not null then
    new.panel_chair := coalesce(nullif(btrim(v_payload ->> 'panel_chair'), ''), new.panel_chair);
    new.panel_members := coalesce(nullif(btrim(v_payload ->> 'panel_members'), ''), new.panel_members);
  end if;
  return new;
end $$;

drop trigger if exists a_papers_hydrate_panel on public.papers;
create trigger a_papers_hydrate_panel before insert on public.papers
for each row execute function public.hydrate_paper_panel();

commit;
