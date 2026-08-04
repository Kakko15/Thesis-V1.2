-- ============================================================================
-- B14 — distinguish stored answers from stored system notices.
--
-- The chat endpoint persists whatever it returned. When Gemini's quota is
-- exhausted, or the guard refuses a generation request, or retrieval finds
-- nothing above the similarity threshold, the response is a system notice with
-- no sources — and it was written to chat_messages as though it were research
-- output. The history loader then replayed it to the model as conversational
-- context, giving the next question an apology to build on and no prior sources
-- to anchor a follow-up to.
--
-- The previous mitigation recognized these rows by matching their text on load.
-- That works until the wording changes. This migration replaces the string
-- match with a structural marker written at the source.
--
-- Notices remain visible in the user's transcript: the conversation did happen,
-- and hiding the question they asked would be worse than showing the notice.
-- They are excluded from the model's context, not from the user's history.
--
-- Additive and idempotent. Apply before deploying the matching application
-- change, because save_chat_exchange gains a parameter.
-- Rollback: 20260804_chat_message_kind.rollback.sql
-- ============================================================================

alter table public.chat_messages
  add column if not exists kind text not null default 'answer';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_messages_kind_check'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_kind_check check (kind in ('answer', 'notice'));
  end if;
end $$;

-- Backfill the rows written before this column existed. These four prefixes are
-- the complete set of system notices the application has ever persisted:
-- the capacity apology, the guard refusal, the guest-allowance notice, and the
-- no-relevant-thesis message. Matched on a prefix because the department name is
-- interpolated into the last one.
update public.chat_messages
set kind = 'notice'
where kind = 'answer'
  and (
    answer like 'IskAI has reached the research AI service usage limit%'
    or answer like 'IskAI''s shared daily allowance for guest research questions%'
    or answer like 'I can help you discover, compare, summarize, and cite existing archived studies%'
    or answer like 'No relevant thesis was found in the%'
  );

-- The history loader reads only real answers, so index exactly that.
create index if not exists chat_messages_session_answer_idx
  on public.chat_messages (session_id, created_at desc)
  where kind = 'answer';

-- ----------------------------------------------------------------------------
-- save_chat_exchange gains p_kind. Defaulted so an older application build that
-- omits it keeps working against this schema.
-- ----------------------------------------------------------------------------
create or replace function public.save_chat_exchange(
  p_user_id uuid,
  p_session_id uuid,
  p_title text,
  p_question text,
  p_answer text,
  p_sources jsonb,
  p_duplication_alert jsonb,
  p_department text,
  p_kind text default 'answer'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid := p_session_id;
begin
  if p_kind is null or p_kind not in ('answer', 'notice') then
    raise exception 'Unsupported chat message kind: %', p_kind;
  end if;

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
    session_id, question, answer, sources, duplication_alert, kind
  ) values (
    v_session_id, p_question, p_answer,
    coalesce(p_sources, '[]'::jsonb), p_duplication_alert, p_kind
  );
  return v_session_id;
end;
$$;

revoke all on function public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text, text
) to service_role;

-- The 8-argument signature is a distinct function in PostgreSQL, not an
-- overload that the 9-argument version replaces. Drop it so a caller cannot
-- reach the old body and write an unmarked notice.
drop function if exists public.save_chat_exchange(
  uuid, uuid, text, text, text, jsonb, jsonb, text
);
