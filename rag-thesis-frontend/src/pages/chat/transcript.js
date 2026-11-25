/**
 * Transcript edits that outlive a request.
 *
 * `send` appends the question optimistically and then awaits the answer. When
 * that request is abandoned -- the reader pressed Stop, or edited the wording
 * before it returned -- the bubble is left standing for a question nothing will
 * ever answer, so it has to come off.
 *
 * `stopWaiting` did this inline and `updatePrompt` did not, which is why
 * editing a pending prompt stacked the superseded wording above the edited one
 * and left it there: the abort path returns from `send` before its catch block
 * reaches its own trim. Kept as one pure function so the two callers cannot
 * disagree again, and so the rule is asserted directly, in the same shape as
 * `messageNotice.js`.
 */

/**
 * `messages` without the trailing optimistic question, if there is one.
 *
 * Only ever removes a trailing `user` entry. An assistant message last means
 * the exchange completed and there is nothing to withdraw, so the list is
 * returned untouched.
 */
export function dropPendingPrompt(messages) {
  const list = Array.isArray(messages) ? messages : []
  return list[list.length - 1]?.kind === 'user' ? list.slice(0, -1) : list
}

/**
 * The transcript branch before the prompt being edited, plus its zero-based
 * user-turn position for the saved-history API.
 */
/**
 * How many LATER questions an edit of `promptId` would delete.
 *
 * Editing a prompt resends it and the server deletes that turn and every turn
 * after it (`edit_from_turn`). Its own answer being replaced is the point of an
 * edit; later questions vanishing is not obvious, and until 2026-11-25 it
 * happened with no warning at all. Counts user turns after the prompt.
 */
export function laterTurnCount(messages, promptId) {
  const list = Array.isArray(messages) ? messages : []
  const index = list.findIndex((message) => message.id === promptId && message.kind === 'user')
  if (index < 0) return 0
  return list.slice(index + 1).filter((message) => message.kind === 'user').length
}

/** The confirm text for an edit that would delete `later` questions. */
export function editWarningMessage(later, saved) {
  const subject = later === 1
    ? 'the question that follows it and its answer'
    : `the ${later} questions that follow it and their answers`
  const fate = saved ? 'permanently deleted from this conversation' : 'removed'
  return `Your edited question will be answered again, and ${subject} will be ${fate}.`
}

export function branchBeforePrompt(messages, promptId) {
  const list = Array.isArray(messages) ? messages : []
  const index = list.findIndex((message) => message.id === promptId && message.kind === 'user')
  if (index < 0) return { messages: list, turn: null }
  return {
    messages: list.slice(0, index),
    turn: list.slice(0, index).filter((message) => message.kind === 'user').length,
  }
}

/**
 * `messages` as it should sit in the conversation cache: identical, except no
 * entry still asks for its entrance animation. A reopened conversation is a
 * restored page, not new arrivals, so nothing on it should fade in again.
 */
export function settledTranscript(messages) {
  const list = Array.isArray(messages) ? messages : []
  return list.map((message) => (message?.isNew ? { ...message, isNew: false } : message))
}

/**
 * Whether an on-screen transcript already shows exactly these saved rows.
 *
 * A cached conversation is painted at once and revalidated afterwards; the
 * fresh copy replaces it only when the saved turns actually differ (another
 * tab or device added or edited one). Rebuilding every time would remount
 * each bubble and flash the whole transcript for no visible change.
 */
export function matchesSavedRows(messages, rows) {
  const list = Array.isArray(messages) ? messages : []
  const saved = Array.isArray(rows) ? rows : []
  if (list.length !== saved.length * 2) return false
  return saved.every((row, index) => {
    const prompt = list[index * 2]
    const reply = list[index * 2 + 1]
    return prompt?.kind === 'user'
      && reply?.kind === 'ai'
      && prompt.text === row?.question
      && reply.answer === row?.answer
  })
}

/**
 * What a screen reader should hear when an answer arrives, or '' for nothing.
 *
 * Until 2026-11-26 the typing indicator was announced and the answer that
 * replaced it was silent, so a screen-reader user had to go looking for it.
 * Only a freshly arrived answer (`isNew`) is announced: a reopened conversation
 * is a restored page, not new arrivals. The text is plain prose, without
 * Markdown symbols or `[n]` citation markers read out as "left bracket one",
 * and is capped so the whole answer is not read in one go. The full answer and
 * its sources stay in the transcript.
 */
export function answerAnnouncement(messages, limit = 280) {
  const list = Array.isArray(messages) ? messages : []
  const last = list[list.length - 1]
  if (last?.kind !== 'ai' || !last.isNew) return ''
  const plain = String(last.answer || '')
    .replace(/```[^`]*```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+(?:,\s?\d+)*\]/g, '')
    .replace(/-{3,}/g, ' ')
    .replace(/[#*_`>|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim()
  if (!plain) return 'IskAI answered.'
  if (plain.length <= limit) return `IskAI answered: ${plain}`
  const cut = plain.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `IskAI answered: ${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`
}
