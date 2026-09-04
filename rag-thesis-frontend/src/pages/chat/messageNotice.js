/**
 * Whether an assistant message is a system notice, and what to call it.
 *
 * The backend classifies each stored row as `answer` or `notice` at write time
 * and exposes `chat_messages.kind` specifically so a restored transcript can
 * tell them apart (`routers/sessions.py`). The live response instead carries
 * `no_relevant_thesis`, which is not a column and is never sent back.
 *
 * So the two paths supply different evidence for the same question, and
 * `loadSession` previously used neither — reloading a conversation made a
 * capacity apology or a refusal visually identical to a grounded answer.
 *
 * Kept as a pure function so the distinction is asserted directly, in the same
 * shape as `archiveFilters.js` and `uploadState.js`.
 */

export const NO_EVIDENCE_LABEL = 'Search completed · no qualifying archive evidence.'
export const SYSTEM_NOTICE_LABEL = 'System message · not a research answer.'

/**
 * The chip to show under an assistant message, or `null` for a real answer.
 *
 * The live no-evidence flag wins when present because it is the more specific
 * statement. A restored row only knows `notice`, which covers the capacity
 * apology, the guard refusal, the guest-allowance message and the no-evidence
 * result alike — so its wording stays generic rather than claiming "no
 * qualifying evidence" for a message that was really a refusal.
 */
export function messageNoticeLabel(message) {
  if (!message) return null
  if (message.no_relevant_thesis) return NO_EVIDENCE_LABEL
  if (message.notice_type === 'conversation') return null
  if (message.messageKind === 'notice') return SYSTEM_NOTICE_LABEL
  return null
}
