import { isE2ETestMode } from '../../testing/e2eSession'

const E2E_TURNSTILE_FLAG = 'isu_e2e_turnstile'
const e2eTurnstileEnabled = isE2ETestMode
  && globalThis.localStorage?.getItem(E2E_TURNSTILE_FLAG) === '1'

// E2E tests opt in before the application module graph loads, allowing an auth
// flow to exercise the same pending-to-solved gate without a real Cloudflare key.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
  || (e2eTurnstileEnabled ? 'e2e-turnstile-site-key' : '')
export const turnstileEnabled = Boolean(TURNSTILE_SITE_KEY)
