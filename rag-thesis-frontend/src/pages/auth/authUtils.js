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

/** Map raw Supabase auth errors to human copy. Never leak internals. */
export function friendlyAuthError(err) {
  if (!err) return 'Something went wrong.'
  let raw = err.message || err.error_description || err.msg || err
  if (typeof raw !== 'string') {
    try { raw = JSON.stringify(raw) } catch { raw = String(raw) }
  }
  if (raw === '{}') return 'Internal server error from Supabase (500). Please check your SMTP settings.'
  const msg = raw.toLowerCase()
  if (msg.includes('invalid login credentials'))
    return 'Incorrect email or password. Double-check and try again.'
  if (msg.includes('email not confirmed'))
    return 'This email isn’t verified yet — we can send you a fresh verification code.'
  if (msg.includes('user already registered'))
    return 'An account with this email already exists. Try signing in instead.'
  if (msg.includes('signups not allowed for otp'))
    return 'No account found with this email. Create one first, then sign in with a code.'
  if (msg.includes('invalid totp') || msg.includes('invalid mfa') || msg.includes('invalid code'))
    return 'That code didn’t match. Codes rotate every 30 seconds — try the current one.'
  if (msg.includes('expired') || msg.includes('otp_expired'))
    return 'That code has expired. Request a fresh one and try again.'
  if (msg.includes('rate limit') || msg.includes('you can only request this after') || msg.includes('too many requests')) {
    const secs = raw.match(/(\d+) seconds?/)?.[1]
    return `Supabase limits emails to 3 per hour for security. Please wait ${secs ? `${secs}s` : 'a moment'}, or disable "Enable Email Confirmations" in your Supabase Auth settings for testing.`
  }
  if (msg.includes('password should be')) return raw
  if (msg.includes('same password') || msg.includes('different from the old'))
    return 'Your new password must be different from the old one.'
  if (msg.includes('auth session missing') || msg.includes('session_not_found'))
    return 'This link has expired. Request a new password-reset email.'
  if (msg.includes('failed to fetch') || msg.includes('network'))
    return 'Network hiccup — check your connection and try again.'
  return raw || 'Something went wrong. Please try again.'
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
