/* Idle-session policy — pure constants and helpers so the rules are testable
   without mounting the guard. See components/IdleSessionGuard.jsx. */

/** Idle logout limits. Privileged roles manage the archive and accounts, so
    they get the OWASP sensitive-app floor; everyone else gets the campus
    standard. Shared lab PCs are the threat model, not personal laptops. */
export const IDLE_LIMIT_MS = {
  privileged: 15 * 60_000, // admin / superadmin
  standard: 30 * 60_000, // student / faculty
}

/** How long before the idle deadline the "Still there?" warning appears. */
export const IDLE_WARNING_MS = 60_000

/** Hard ceiling on any session, activity or not — bounds the damage window
    of a stolen refresh token. */
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60_000

/** localStorage keys shared across tabs (one session = one idle clock). */
export const IDLE_LAST_ACTIVITY_KEY = 'isu-idle-last-activity'
export const IDLE_SESSION_START_KEY = 'isu-session-started-at'

export function idleLimitForRole(isPrivileged) {
  return isPrivileged ? IDLE_LIMIT_MS.privileged : IDLE_LIMIT_MS.standard
}

/** Only same-origin, app-internal paths may be restored after re-login. */
export function safeNextPath(path, fallback = '/dashboard') {
  if (typeof path !== 'string') return fallback
  if (!path.startsWith('/') || path.startsWith('//')) return fallback
  return path
}

/** The query parameter that carries the post-login destination.
 *
 * Two places send a reader to /login with somewhere to come back to — an idle
 * logout and the 401 handler in api.js — and Login reads the destination once.
 * They disagreed: the 401 wrote `returnTo` while Login read `next`, so that
 * destination was silently dropped and the reader landed on /dashboard. The
 * key is named here so the three cannot drift apart again. */
export const LOGIN_NEXT_PARAM = 'next'

/** `/login`, carrying `here` as the destination when it is worth returning to.
 *
 * Bare `/login` for the landing page and for /login itself: neither is a place
 * to send anyone back to, and the second would loop. Read back through
 * `safeNextPath`, which is what rejects an off-origin destination. */
export function loginPathWithNext(here) {
  const worthKeeping = typeof here === 'string'
    && here.startsWith('/')
    && !here.startsWith('//')
    && here !== '/'
    && !here.startsWith('/login')
  return worthKeeping ? `/login?${LOGIN_NEXT_PARAM}=${encodeURIComponent(here)}` : '/login'
}

/** 65_000 → "1:05" — the warning modal's remaining-time readout. */
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}
