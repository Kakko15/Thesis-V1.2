import { useCallback, useState } from 'react'

import { turnstileEnabled } from './turnstileConfig'

/**
 * Whether a form may be submitted while a Turnstile challenge is outstanding.
 *
 * Every auth form used to gate its submit button on `turnstileEnabled &&
 * !captchaToken`, which is correct while a challenge is *running* and a total
 * outage once it stops answering. On 2026-08-04 Cloudflare's challenge host was
 * unreachable: the script loaded, `turnstile.render()` ran, no `error-callback`
 * ever fired, and the status stayed `pending` forever. Sign in, email-a-link,
 * sign up, password reset, and password change were all permanently disabled
 * behind a spinner reading "Checking your browser", with no error and no escape.
 *
 * Two changes fix that class of failure:
 *
 *   1. `SecurityCheck` gives `pending` a deadline, so a hung challenge becomes a
 *      reported status instead of an indefinite spinner.
 *   2. Once verification is known to be unavailable, the form stops blocking.
 *
 * Failing open here is deliberate. Supabase Auth is the authority on whether a
 * CAPTCHA token is required: if it enforces one, the submission returns a real
 * error the visitor can read and act on, which is strictly better than a dead
 * button. If it does not, sign-in simply works. Either way the server decides,
 * and provider rate limiting still applies. The alternative — a third-party CDN
 * outage locking every account out of the system — is the worse failure.
 */
const VERIFICATION_UNAVAILABLE = new Set(['error', 'unsupported', 'unavailable'])

export function useSecurityGate() {
  const [token, setToken] = useState(null)
  const [status, setStatus] = useState('pending')

  const onToken = useCallback((next) => setToken(next), [])
  const onStatusChange = useCallback((next) => setStatus(next), [])

  const unavailable = VERIFICATION_UNAVAILABLE.has(status)

  return {
    token,
    status,
    unavailable,
    /** True while submission should be held back. */
    blocked: turnstileEnabled && !token && !unavailable,
    onToken,
    onStatusChange,
  }
}
