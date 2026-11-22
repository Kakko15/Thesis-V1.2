/**
 * Sidebar system-status derivation, kept pure so every state is unit-testable.
 *
 * The badge used to compute `online` from `data` alone, so while the very first
 * `/health` request was still in flight (`data === undefined`) it rendered a red
 * "Offline" dot on every page load, and a single failed cold-start probe kept it
 * red until the next 30-second poll. `pending` is the React Query state before
 * any result exists (including while its bounded retries run); it maps to a
 * neutral "Checking…" state instead of a failure.
 *
 * Settled states keep their exact labels and `aria-label`s ("System online",
 * "System degraded", "System offline"), which the E2E specs assert on.
 */

export const HEALTH_STATES = Object.freeze({
  CHECKING: 'checking',
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
})

const LABELS = Object.freeze({
  [HEALTH_STATES.CHECKING]: 'Checking…',
  [HEALTH_STATES.ONLINE]: 'Online',
  [HEALTH_STATES.DEGRADED]: 'Degraded',
  [HEALTH_STATES.OFFLINE]: 'Offline',
})

/**
 * @param {{ data?: { status?: string }, isError?: boolean, isPending?: boolean }} query
 *   The relevant fields of a React Query result for `['health']`.
 * @returns {{ state: string, label: string, ariaLabel: string }}
 */
export function deriveHealthStatus({ data, isError = false, isPending = false } = {}) {
  let state
  if (isPending && !data) {
    state = HEALTH_STATES.CHECKING
  } else if (isError || !data?.status) {
    state = HEALTH_STATES.OFFLINE
  } else if (data.status === 'ok') {
    state = HEALTH_STATES.ONLINE
  } else {
    state = HEALTH_STATES.DEGRADED
  }
  return { state, label: LABELS[state], ariaLabel: `System ${state}` }
}

// A cold backend can need a few seconds (connection setup plus the schema
// check) before its first `/health` answer; two quick retries cover that
// instead of leaving a failed first probe on screen for a full poll interval.
export const HEALTH_QUERY_RETRY = 2
export const HEALTH_QUERY_RETRY_DELAY_MS = 1000
export const HEALTH_QUERY_REFETCH_MS = 30_000
