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
export function branchBeforePrompt(messages, promptId) {
  const list = Array.isArray(messages) ? messages : []
  const index = list.findIndex((message) => message.id === promptId && message.kind === 'user')
  if (index < 0) return { messages: list, turn: null }
  return {
    messages: list.slice(0, index),
    turn: list.slice(0, index).filter((message) => message.kind === 'user').length,
  }
}
