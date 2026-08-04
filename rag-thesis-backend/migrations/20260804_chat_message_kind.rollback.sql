-- ============================================================================
-- Rollback for 20260804_chat_message_kind.sql (B14).
--
-- Restores the 8-argument save_chat_exchange and removes the kind column. The
-- notice/answer distinction is lost, so the application falls back to
-- recognizing notices by their text on load — which is what this migration
-- replaced. Run only when reverting the matching application build.
-- ============================================================================

create or replace function public.save_chat_exchange(
  p_user_id uuid,
  p_session_id uuid,
  p_title text,
  p_question text,
  p_answer text,
  p_sources jsonb,
  p_duplication_alert jsonb,
  p_department text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid := p_session_id;
begin
  if v_session_id is null then
    insert into public.chat_sessions (user_id, title, department)
    values (p_user_id, left(p_title, 120), p_department)
    returning id into v_session_id;
  elsif not exists (
    select 1 from public.chat_sessions
    where id = v_session_id
      and user_id = p_user_id
      and department = p_department
  ) then
    raise exception 'Session not found, not owned by user, or belongs to another department';
  end if;

  insert into public.chat_messages (
    session_id, question, answer, sources, duplication_alert
  ) values (
    v_session_id, p_question, p_answer,
    coalesce(p_sources, '[]'::jsonb), p_duplication_alert
  );
  return v_session_id;
end;
$$;

revoke all on function public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text
) to service_role;

drop function if exists public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text, text
);

drop index if exists public.chat_messages_session_answer_idx;

alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages drop column if exists kind;
