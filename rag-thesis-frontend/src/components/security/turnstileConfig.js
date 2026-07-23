export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || ''
export const turnstileEnabled = Boolean(TURNSTILE_SITE_KEY)

