-- ============================================================================
-- Extend the B14 notice backfill to the two system messages it missed.
--
-- 20260804_chat_message_kind.sql called its four prefixes "the complete set of
-- system notices the application has ever persisted". Two were not in that set
-- and were being stored as research answers:
--
--   1. The greeting / identity reply. `_conversation_response()` answers a
--      greeting or a "what are you" question without retrieval or generation.
--      It has no sources, and the history loader was replaying
--      "AI: Hello! I'm IskAI..." to the model as conversational context on the
--      next turn.
--
--   2. The grounded retrieval fallback. `_grounded_retrieval_fallback()` is
--      returned when citation validation and its bounded repair both fail, or
--      when the model answers a research question with a misdirected greeting.
--      It reports that no direct answer could be verified and then points at
--      the closest archived studies.
--
-- The fallback keeps its citations and its source cards on screen: retrieval
-- did succeed and those studies are real. It is reclassified only so it stops
-- becoming model context, not to hide it. `no_relevant_thesis` is deliberately
-- NOT set for it — that flag means retrieval found nothing, which is untrue
-- here and would strip the sources the message exists to offer.
--
-- Both remain visible in the user's transcript, exactly as the other notices
-- do. This changes which rows the model is shown, never which rows the user is.
--
-- Ordering note: the application already recognizes both texts at read time via
-- services/chat_notices.py::is_stored_non_answer, which runs after the SQL
-- `kind` filter in routers/chat.py. So an unmigrated database was never feeding
-- these rows to the model — this migration makes the stored `kind` column agree
-- with that behaviour, so anything reading `kind` directly (a transcript badge,
-- an export, an analytics query) sees the truth too.
--
-- Additive and idempotent. Touches no other column, deletes nothing, and only
-- relabels rows still marked 'answer'.
--
-- Rollback: 20260825_notice_kind_greeting_and_fallback.rollback.sql
-- ============================================================================

begin;

update public.chat_messages
set kind = 'notice'
where kind = 'answer'
  and (
    answer like 'Hello! I''m IskAI, the research assistant for the ISU Thesis AI Library.%'
    or answer like 'I could not verify a direct answer%'
  );

commit;

-- Guardrail: this migration relabels chat_messages.kind only. It creates no
-- row, drops no column, and cannot affect papers, chunks, or any index.
