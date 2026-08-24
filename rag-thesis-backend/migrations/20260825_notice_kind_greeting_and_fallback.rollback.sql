-- ============================================================================
-- Rollback for 20260825_notice_kind_greeting_and_fallback.sql.
--
-- Returns the greeting and grounded-fallback rows to kind = 'answer'.
--
-- This restores a known defect: the history loader's SQL filter would hand
-- those rows back to the model as conversational context. The application's
-- text-matching defence (services/chat_notices.py::is_stored_non_answer) still
-- catches them at read time, so the practical effect is limited to anything
-- that reads the `kind` column directly.
--
-- Not exactly reversible, and deliberately so: a row that was genuinely stored
-- as a notice before this migration ran is indistinguishable from one this
-- migration relabelled. Reverting therefore marks BOTH as answers. Run only
-- when reverting the matching application build, and prefer leaving the
-- forward migration in place — it is additive and the newer application code
-- writes the correct kind at the source regardless.
-- ============================================================================

begin;

update public.chat_messages
set kind = 'answer'
where kind = 'notice'
  and (
    answer like 'Hello! I''m IskAI, the research assistant for the ISU Thesis AI Library.%'
    or answer like 'I could not verify a direct answer%'
  );

commit;
