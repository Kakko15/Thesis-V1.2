/* Recognising the one refusal a signed-in user can clear on their own.
 *
 * Supabase raises a session to `aal2` only through an authenticator-app
 * challenge. An emailed code proves a second step to this app but leaves the
 * access token at `aal1`, and the API reads that claim — so a privileged
 * account verified by email lands in a UI whose every privileged call the
 * server refuses. The refusal itself is the reliable signal: it does not
 * depend on knowing the viewer's role before the profile loads, and it stays
 * correct whether or not the deployment enforces MFA at all.
 *
 * The wording below is the API's, pinned by
 * `rag-thesis-backend/tests/test_auth_authorization.py`. Matched as a
 * lowercase prefix so the sentence can gain a clause without going deaf.
 */

const PRIVILEGED_MFA_MARKER = 'multi-factor authentication is required'

/** True only for the API's "this session has not reached aal2" refusal. */
export function isPrivilegedMfaRefusal(error) {
  if (Number(error?.response?.status) !== 403) return false
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' && detail.toLowerCase().includes(PRIVILEGED_MFA_MARKER)
}

const listeners = new Set()

/** Subscribe to server refusals. Returns the unsubscribe. */
export function onPrivilegedMfaRequired(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Announce that the API refused this session for want of a second factor.
 * Iterates a copy so a listener that unsubscribes itself cannot disturb the
 * walk, and one throwing listener cannot swallow the notice for the rest.
 */
export function reportPrivilegedMfaRequired() {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* a subscriber's failure is not the reporter's to handle */
    }
  }
}

/** Test seam: drop every subscription. */
export function resetPrivilegedMfaListeners() {
  listeners.clear()
}
