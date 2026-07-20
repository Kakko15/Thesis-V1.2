import { useEffect, useState } from 'react'

/* Shared helpers for the auth flow — pure functions + one timer hook. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value) {
  return EMAIL_RE.test((value || '').trim())
}

/** k.delacruz@isu.edu.ph → k•••@isu.edu.ph */
export function maskEmail(email) {
  const [local, domain] = (email || '').split('@')
  if (!domain) return email
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}•••@${domain}`
}

/** 0–4 heuristic used by the strength meter. */
export function passwordStrength(pw) {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score
}

export const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
export const STRENGTH_COLORS = ['bg-flame-500', 'bg-flame-500', 'bg-gold-400', 'bg-forest-500', 'bg-forest-500']

export const PASSWORD_RULES = [
  { key: 'len', label: '8+ characters', test: (pw) => pw.length >= 8 },
  { key: 'upper', label: 'Uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { key: 'digit', label: 'Number', test: (pw) => /[0-9]/.test(pw) },
  { key: 'symbol', label: 'Symbol', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

export function isStrongPassword(password) {
  return PASSWORD_RULES.every((rule) => rule.test(password || ''))
}

const AUTH_ERROR_RULES = [
  ['invalid login credentials', 'Incorrect email or password. Double-check and try again.'],
  ['email not confirmed', 'This email isn’t verified yet — we can send you a fresh verification code.'],
  ['user already registered', 'An account with this email already exists. Try signing in instead.'],
  ['signups not allowed for otp', 'No account found with this email. Create one first, then sign in with a code.'],
  [['invalid totp', 'invalid mfa', 'invalid code'], 'That code didn’t match. Codes rotate every 30 seconds — try the current one.'],
  [['expired', 'otp_expired'], 'That code has expired. Request a fresh one and try again.'],
  [['same password', 'different from the old'], 'Your new password must be different from the old one.'],
  [['auth session missing', 'session_not_found'], 'This link has expired. Request a new password-reset email.'],
  [['failed to fetch', 'network'], 'Network hiccup — check your connection and try again.'],
]

function matchesAuthRule(message, patterns) {
  const candidates = Array.isArray(patterns) ? patterns : [patterns]
  return candidates.some((pattern) => message.includes(pattern))
}

/** Map raw Supabase auth errors to human copy. Never leak internals. */
export function friendlyAuthError(err) {
  if (!err) return 'Something went wrong.'
  let raw = err.message || err.error_description || err.msg || err
  if (typeof raw !== 'string') {
    try { raw = JSON.stringify(raw) } catch { raw = String(raw) }
  }
  if (raw === '{}') return 'Internal server error from Supabase (500). Please check your SMTP settings.'
  const message = raw.toLowerCase()
  if (matchesAuthRule(message, ['rate limit', 'you can only request this after', 'too many requests'])) {
    const seconds = raw.match(/(\d+) seconds?/)?.[1]
    return `Supabase limits emails to 3 per hour for security. Please wait ${seconds ? `${seconds}s` : 'a moment'}, or disable "Enable Email Confirmations" in your Supabase Auth settings for testing.`
  }
  if (message.includes('password should be')) return raw
  const rule = AUTH_ERROR_RULES.find(([patterns]) => matchesAuthRule(message, patterns))
  return rule?.[1] || 'Authentication failed. Please try again.'
}

/** Parse "…after 42 seconds" out of a rate-limit error. */
export function retryAfterSeconds(err) {
  const m = (err?.message || '').match(/after (\d+) seconds?/)
  return m ? parseInt(m[1], 10) : 0
}

/** Countdown for resend buttons. `const [cooldown, setCooldown] = useResendTimer(60)` */
export function useResendTimer(initial = 0) {
  const [seconds, setSeconds] = useState(initial)
  useEffect(() => {
    if (seconds <= 0) return undefined
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])
  return [seconds, setSeconds]
}
