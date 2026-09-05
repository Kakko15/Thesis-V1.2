import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Check, Copy, Fingerprint, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'
import { contentKeys } from '../lib/keys'
import { Button } from './ui/Button'
import { Modal, ConfirmDialog } from './ui/Modal'
import { OtpInput } from './ui/OtpInput'
import { Spinner } from './ui/Spinner'
import { staggerContainer, staggerItem } from './ui/Motion'
import { friendlyAuthError } from '../pages/auth/authUtils'

/**
 * Google Authenticator — the 2023+ pinwheel: six rounded arms in Google's
 * four brand colors, blue arms overlapping into the darker core.
 */
function GoogleAuthenticatorIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-white shadow-sm ring-1 ring-forest-900/10 dark:ring-white/15"
    >
      <svg viewBox="0 0 24 24" width={13} height={13} focusable="false">
        <g strokeLinecap="round" strokeWidth={4.2}>
          <line x1="12" y1="12" x2="4.4" y2="12" stroke="#34A853" />
          <line x1="12" y1="12" x2="8.2" y2="5.42" stroke="#FBBC04" />
          <line x1="12" y1="12" x2="8.2" y2="18.58" stroke="#EA4335" />
          <line x1="12" y1="12" x2="15.8" y2="18.58" stroke="#EA4335" />
          <line x1="12" y1="12" x2="15.8" y2="5.42" stroke="#4285F4" />
          <line x1="12" y1="12" x2="19.6" y2="12" stroke="#4285F4" />
        </g>
        <circle cx="12" cy="12" r="2.2" fill="#1A73E8" />
      </svg>
    </span>
  )
}

/**
 * 1Password — the classic ring mark: white edge, blue band, ivory dial and
 * the dark notched keyhole (keyhole geometry from simple-icons, CC0).
 */
function OnePasswordIcon() {
  return (
    <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" width={19} height={19} focusable="false">
        <defs>
          <linearGradient id="mfa-op-ring" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0F7CE8" />
            <stop offset="1" stopColor="#37A8FF" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="11.4" fill="#ffffff" stroke="rgba(15,40,80,0.14)" strokeWidth={0.6} />
        <circle cx="12" cy="12" r="9" fill="url(#mfa-op-ring)" />
        <circle cx="12" cy="12" r="6" fill="#F5F5F5" />
        <path
          fill="#3B3B3D"
          transform="translate(12 12) scale(0.78) translate(-12 -12)"
          d="M12 0m-.893 4.86c-.485 0-.727.001-.913.095a.87.87 0 0 0-.378.379c-.094.185-.095.428-.095.912v2.747c0 .12 0 .182.016.238q.02.075.065.138a1 1 0 0 0 .175.162l.695.564c.113.092.17.139.19.194a.22.22 0 0 1 0 .15c-.02.056-.077.102-.19.194l-.695.564a1 1 0 0 0-.175.162.4.4 0 0 0-.065.138 1 1 0 0 0-.016.238v6.019c0 .485 0 .728.095.913a.87.87 0 0 0 .378.378c.186.094.428.094.913.094h1.786c.485 0 .727 0 .913-.094a.87.87 0 0 0 .378-.378c.095-.185.095-.428.095-.913v-2.747c0-.12 0-.182-.016-.238a.4.4 0 0 0-.065-.138 1 1 0 0 0-.175-.162l-.695-.564c-.113-.092-.17-.138-.191-.193a.22.22 0 0 1 0-.152c.02-.055.078-.1.19-.193l.696-.564a1 1 0 0 0 .175-.162.4.4 0 0 0 .065-.138 1 1 0 0 0 .016-.238V6.246c0-.484 0-.727-.095-.912a.87.87 0 0 0-.378-.379c-.186-.094-.428-.094-.913-.094Z"
        />
      </svg>
    </span>
  )
}

/** Bitwarden — white shield (simple-icons, CC0) on the official blue tile. */
function BitwardenIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[#175DDC] shadow-sm"
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill="#ffffff" focusable="false">
        <path d="M21.722.296A.964.964 0 0 0 21.018 0H2.982a.959.959 0 0 0-.703.296.96.96 0 0 0-.297.702v12c0 .895.174 1.783.523 2.665.349.88.783 1.66 1.3 2.345.517.68 1.132 1.346 1.848 1.993a21.807 21.807 0 0 0 1.98 1.609c.605.427 1.235.83 1.893 1.212.657.381 1.125.638 1.4.772.276.134.5.241.664.311a.916.916 0 0 0 .814 0c.168-.073.389-.177.667-.311.275-.134.743-.394 1.401-.772a25.305 25.305 0 0 0 1.894-1.212A21.891 21.891 0 0 0 18.348 20c.716-.647 1.33-1.31 1.847-1.993s.949-1.463 1.3-2.345c.35-.879.524-1.767.524-2.665V1.001a.95.95 0 0 0-.297-.705zm-2.325 12.815c0 4.344-7.397 8.087-7.397 8.087V2.57h7.397v10.54z" />
      </svg>
    </span>
  )
}

/** Well-known TOTP apps shown with their real app icons in step 1. */
const AUTHENTICATOR_APPS = [
  { name: 'Google Authenticator', Icon: GoogleAuthenticatorIcon },
  { name: '1Password', Icon: OnePasswordIcon },
  { name: 'Bitwarden', Icon: BitwardenIcon },
]

/**
 * Manage TOTP two-factor authentication:
 *  status → (setup: QR + secret + verify code) | (disable with confirm).
 * Body remounts per open so every session starts fresh.
 */
export function MfaEnrollDialog({ open, onClose, onChanged }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Two-factor authentication"
      description="A rotating 6-digit code from your phone, required at every sign-in."
    >
      {open && <MfaBody onClose={onClose} onChanged={onChanged} />}
    </Modal>
  )
}

/** One guided step: badge + title header, full-width content below. */
function Step({ index, title, subtitle, last = false, children }) {
  return (
    <motion.li variants={staggerItem} className="relative">
      {/* Connector runs the full step height behind the badge (opaque, z-10),
          so the rail reads as one continuous line down to the next step. */}
      {!last && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[13.5px] top-0 w-px bg-gradient-to-b from-forest-500/35 via-forest-500/15 to-transparent dark:from-white/25 dark:via-white/10"
        />
      )}
      <div className="flex items-center gap-3">
        <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-forest-600 to-forest-800 font-display text-[13px] font-bold text-white shadow-md shadow-forest-900/25 ring-4 ring-forest-500/10 dark:from-forest-400 dark:to-forest-600 dark:text-forest-950 dark:ring-white/5">
          {index}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {/* Full dialog width — centered content (QR, OTP) centers on the dialog,
          not on a badge-indented column. */}
      <div className={cn('mt-3.5', last ? 'pb-1' : 'pb-7')}>{children}</div>
    </motion.li>
  )
}

/** QR in a camera-viewfinder frame: corner brackets, ambient glow, scan sweep. */
function QrCard({ src, account }) {
  const corner = 'absolute h-5 w-5 border-forest-600 dark:border-forest-400'
  return (
    <div className="relative">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-forest-500/20 via-gold-400/20 to-forest-500/20 blur-2xl dark:from-forest-500/10 dark:via-gold-400/10 dark:to-forest-500/10"
      />
      <div className="relative overflow-hidden rounded-[1.4rem] bg-white p-3 shadow-[0_18px_40px_-12px_rgba(4,42,24,0.35)] ring-1 ring-forest-900/10">
        <img src={src} alt="QR code — scan with your authenticator app" className="h-40 w-40" />
        {/* Scanning shine sweep (disabled under reduced-effects prefs) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.4rem]">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2/5 animate-shine bg-gradient-to-r from-transparent via-forest-500/10 to-transparent" />
        </div>
        <div className="mt-1.5 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-forest-800/70">IskAI</div>
          {account && <div className="text-[10px] text-neutral-500">{account}</div>}
        </div>
      </div>
      {/* Viewfinder corner brackets */}
      <span aria-hidden="true" className={`${corner} -left-1.5 -top-1.5 rounded-tl-lg border-l-[2.5px] border-t-[2.5px]`} />
      <span aria-hidden="true" className={`${corner} -right-1.5 -top-1.5 rounded-tr-lg border-r-[2.5px] border-t-[2.5px]`} />
      <span aria-hidden="true" className={`${corner} -bottom-1.5 -left-1.5 rounded-bl-lg border-b-[2.5px] border-l-[2.5px]`} />
      <span aria-hidden="true" className={`${corner} -bottom-1.5 -right-1.5 rounded-br-lg border-b-[2.5px] border-r-[2.5px]`} />
    </div>
  )
}

/**
 * Enroll failures are user-actionable — surface the server's reason, with
 * plain-language translations for the known Supabase 422 cases.
 */
function mfaSetupErrorMessage(err) {
  const message = (err?.message || '').toLowerCase()
  if (message.includes('disabled')) {
    return 'TOTP enrollment is turned off for this Supabase project — enable it under Authentication → Multi-Factor Authentication, then retry.'
  }
  if (message.includes('maximum number of factors') || message.includes('factor limit') || message.includes('too many factors')) {
    return 'This account has reached Supabase’s factor limit. Remove an existing factor and retry.'
  }
  return err?.message || friendlyAuthError(err)
}

function MfaBody({ onClose, onChanged }) {
  const { user } = useAuth()
  const [view, setView] = useState('loading') // loading | status | setup
  const [factor, setFactor] = useState(null)
  const [enroll, setEnroll] = useState(null) // { id, qr, secret }
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [shakeNonce, setShakeNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    supabase.auth.mfa.listFactors().then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) {
        setError(friendlyAuthError(loadError))
        setView('error')
        return
      }
      setFactor(data?.totp?.find((f) => f.status === 'verified') ?? null)
      setView('status')
    }).catch((loadError) => {
      if (!active) return
      setError(friendlyAuthError(loadError))
      setView('error')
    })
    return () => {
      active = false
    }
  }, [])

  const startSetup = async () => {
    setBusy(true)
    setError('')
    try {
      // Clear dangling unverified factors first — Supabase caps enrollments.
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      const stale = (data?.totp ?? []).filter((f) => f.status !== 'verified')
      for (const f of stale) {
        const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: f.id })
        if (removeError) throw removeError
      }

      let { data: enrolled, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
        issuer: 'IskAI',
      })
      if (err && /friendly.?name/i.test(err.message ?? '')) {
        // A same-named factor still lingers server-side — retry uniquely named.
        ;({ data: enrolled, error: err } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `Authenticator app (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
          issuer: 'IskAI',
        }))
      }
      if (err) throw err
      setEnroll({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret })
      setView('setup')
    } catch (err) {
      console.error('[MFA] setup failed:', err)
      setError(mfaSetupErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verifySetup = async (token) => {
    setBusy(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enroll.id,
        code: token,
      })
      if (err) throw err
      toast.success('Two-factor authentication enabled', {
        description: "You'll be asked to verify a second step at every sign-in.",
      })
      onChanged?.()
      onClose()
    } catch (err) {
      setError(friendlyAuthError(err))
      setShakeNonce((n) => n + 1)
      setCode('')
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (err) throw err
      toast.success('Two-factor authentication disabled')
      onChanged?.()
      onClose()
    } catch (err) {
      toast.error('Could not disable 2FA', { description: friendlyAuthError(err) })
      setBusy(false)
      setConfirmOff(false)
    }
  }

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(enroll.secret)
      setCopied(true)
      toast.success('Secret copied')
    } catch {
      toast.error('Could not copy — select the code manually')
    }
  }

  if (view === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <Spinner size={28} />
        <p className="text-xs text-ink-muted">Checking your security settings…</p>
      </div>
    )
  }

  if (view === 'error') {
    return (
      <div className="py-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-flame-500/10 ring-1 ring-flame-500/20">
          <ShieldOff className="text-flame-500" size={22} />
        </div>
        <p role="alert" className="mt-3 text-sm font-medium">Two-factor status could not be loaded.</p>
        <p className="mt-1 text-xs text-ink-muted">{error}</p>
        <Button className="mt-5" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    )
  }

  if (view === 'setup') {
    // Google-style grouping: fixed 4-char chunks, each an unbreakable unit so
    // a group never splits across lines.
    const secretChunks = enroll.secret.replace(/\s/g, '').match(/.{1,4}/g) ?? []
    const secretChunkKeys = contentKeys(secretChunks, 'secret')
    return (
      <motion.div variants={staggerContainer} initial="hidden" animate="show">
        <motion.ol variants={staggerContainer} className="list-none">
          <Step index={1} title="Get an authenticator app">
            <div className="flex flex-wrap items-center gap-2">
              {AUTHENTICATOR_APPS.map(({ name, Icon }) => (
                <span
                  key={name}
                  className="glass-subtle inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-xs font-semibold text-ink-muted"
                >
                  <Icon />
                  {name}
                </span>
              ))}
              <span className="px-1 text-xs text-ink-faint">or any TOTP app</span>
            </div>
          </Step>

          <Step index={2} title="Scan the QR code" subtitle="Point your authenticator app's camera at the code.">
            <div className="flex flex-col items-center pt-1">
              <QrCard src={enroll.qr} account={user?.email} />
              <div className="mt-5 w-full">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                  Can't scan it? Enter this secret
                </div>
                <div className="glass-subtle mt-2 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
                  <KeyRound size={14} className="shrink-0 text-gold-500" aria-hidden="true" />
                  <code className="grid min-w-0 flex-1 grid-cols-4 justify-items-center gap-x-2.5 gap-y-1.5 font-mono text-[13px] font-semibold tracking-[0.12em]">
                    {secretChunks.map((chunk, i) => (
                      <span key={secretChunkKeys[i]} className="whitespace-nowrap">{chunk}</span>
                    ))}
                  </code>
                  <Button variant="ghost" size="icon-sm" onClick={copySecret} aria-label="Copy setup secret" className="shrink-0">
                    {copied ? <Check size={14} className="text-forest-500" /> : <Copy size={14} />}
                  </Button>
                </div>
              </div>
            </div>
          </Step>

          <Step index={3} title="Enter the 6-digit code" subtitle="Type the code shown next to your IskAI account." last>
            <div className="pt-1">
              <OtpInput
                value={code}
                onChange={setCode}
                onComplete={verifySetup}
                disabled={busy}
                error={!!error}
                shakeNonce={shakeNonce}
                autoFocus={false}
                ariaLabel="Authenticator verification code"
              />
              {error && (
                <p role="alert" className="mt-3 text-center text-xs font-medium text-flame-500">{error}</p>
              )}
            </div>
          </Step>
        </motion.ol>

        <motion.div
          variants={staggerItem}
          className="mt-4 flex justify-end gap-3 border-t border-forest-900/8 pt-4 dark:border-white/8"
        >
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={code.length !== 6} onClick={() => verifySetup(code)}>
            <ShieldCheck size={16} /> Activate 2FA
          </Button>
        </motion.div>
      </motion.div>
    )
  }

  // status view
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">
      <motion.div
        variants={staggerItem}
        className="relative overflow-hidden rounded-3xl border border-forest-900/10 bg-gradient-to-br from-forest-500/8 via-transparent to-gold-400/10 p-5 dark:border-white/10 dark:from-forest-400/[0.07] dark:to-gold-400/[0.08]"
      >
        {/* Decorative glows */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-gold-400/20 blur-3xl dark:bg-gold-400/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-12 -left-10 h-36 w-36 rounded-full bg-forest-500/15 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div
            className={
              factor
                ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25 ring-1 ring-white/20'
                : 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-forest-900/8 dark:bg-white/8'
            }
          >
            <Fingerprint size={20} className={factor ? 'text-gold-300' : 'opacity-50'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              {factor ? 'Two-factor authentication is on' : 'Two-factor authentication is off'}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">
              {factor
                ? 'Sign-in asks for a second step. Administration and Operations require a code from this app.'
                : 'Add an authenticator app so a stolen password alone can never open your account.'}
            </div>
          </div>
          {factor ? (
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forest-500 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-forest-500" />
            </span>
          ) : (
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-forest-900/20 dark:bg-white/20" />
          )}
        </div>
      </motion.div>

      {error && <p role="alert" className="mt-4 text-xs font-medium text-flame-500">{error}</p>}

      <motion.div variants={staggerItem} className="mt-5 flex justify-end gap-3">
        {factor ? (
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="danger" loading={busy} onClick={() => setConfirmOff(true)}>
              <ShieldOff size={16} /> Disable 2FA
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Not now</Button>
            <Button loading={busy} onClick={startSetup}>
              <ShieldCheck size={16} /> Set up 2FA
            </Button>
          </>
        )}
      </motion.div>

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={disable}
        title="Disable two-factor authentication?"
        message="Your account will be protected by your password alone. You can re-enable 2FA at any time."
        confirmLabel="Disable 2FA"
        danger
        loading={busy}
      />
    </motion.div>
  )
}
