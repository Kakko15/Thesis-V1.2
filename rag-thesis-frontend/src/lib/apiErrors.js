/* Reading an Axios failure. Pure functions — no axios, no session, no DOM — so
 * the rules a screen shows a user are testable on their own. */

/**
 * The human-readable reason the server gave, or `fallback`.
 *
 * FastAPI puts it in `detail`: a string for `HTTPException`, a list of field
 * errors for a request-validation failure.
 */
export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map(d => `${d.loc?.join('.') || 'Field'}: ${d.msg}`).join(', ');
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  const message = error?.response?.data?.message
  if (typeof message === 'string' && message.trim()) return message
  if (!error?.response && typeof error?.message === 'string' && error.message.trim()) {
    return error.message
  }
  return fallback
}

/** The HTTP status a failure carried, or 0 when no reply ever arrived. */
export function apiErrorStatus(error) {
  return Number(error?.response?.status) || 0
}

/**
 * Whether repeating the identical request could plausibly succeed.
 *
 * A 4xx is a decision about *this* request — who is asking, or what they sent.
 * Nothing about pressing Retry changes either, so offering the button against
 * one advertises a recovery that cannot happen and hides the real reason
 * behind a second identical refusal. A 5xx, and a request that never got a
 * reply at all, are both server- or transport-side and do clear on their own.
 */
export function isRetryableFailure(error) {
  const status = apiErrorStatus(error)
  return status === 0 || status >= 500
}
