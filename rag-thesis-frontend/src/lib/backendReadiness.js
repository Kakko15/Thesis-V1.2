/**
 * Bounded wait for the dev backend, kept pure so the time limit is testable.
 *
 * `api.js` used to loop a fixed 40 attempts and then report "did not become
 * ready within 14 seconds", but each attempt was a Vite probe of up to the
 * probe timeout plus a pause, so the real wait was several times longer than
 * the message claimed. The loop is now bounded by elapsed time, and the error
 * names the same window it enforced.
 */

export const DEV_BACKEND_READY_TIMEOUT_MS = 30_000
export const DEV_BACKEND_READY_POLL_MS = 350

/**
 * Resolve once `probe()` reports ready; reject after `timeoutMs` of trying.
 *
 * @param {object} options
 * @param {() => Promise<boolean>} options.probe  Resolves true when ready. A
 *   rejection counts as "not ready yet" (Vite may be reloading its config).
 * @param {number} [options.timeoutMs]
 * @param {number} [options.pollMs]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export async function waitUntilReady({
  probe,
  timeoutMs = DEV_BACKEND_READY_TIMEOUT_MS,
  pollMs = DEV_BACKEND_READY_POLL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs
  for (;;) {
    try {
      if (await probe()) return
    } catch {
      // Not ready yet; keep polling until the deadline.
    }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(pollMs, remaining))
  }
  throw new Error(`The backend did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`)
}

/** Requests that need neither a session token nor a guest id. */
const PUBLIC_UNAUTHENTICATED_PATHS = new Set(['/health'])

export function isPublicUnauthenticatedRequest(config) {
  const url = String(config?.url || '').split('?')[0]
  return PUBLIC_UNAUTHENTICATED_PATHS.has(url)
}
