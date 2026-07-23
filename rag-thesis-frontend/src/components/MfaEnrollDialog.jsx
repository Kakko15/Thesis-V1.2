import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Fingerprint, ShieldCheck, ShieldOff } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { Button } from './ui/Button'
import { Modal, ConfirmDialog } from './ui/Modal'
import { OtpInput } from './ui/OtpInput'
import { Spinner } from './ui/Spinner'
import { friendlyAuthError } from '../pages/auth/authUtils'

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

function MfaBody({ onClose, onChanged }) {
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

      const { data: enrolled, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
      })
      if (err) throw err
      setEnroll({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret })
      setView('setup')
    } catch (err) {
      setError(friendlyAuthError(err))
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
        description: "You'll be asked for a code at every sign-in.",
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
      <div className="flex justify-center py-10">
        <Spinner size={28} />
      </div>
    )
  }

  if (view === 'error') {
    return (
      <div className="py-5 text-center">
        <ShieldOff className="mx-auto text-flame-500" size={28} />
        <p role="alert" className="mt-3 text-sm font-medium">Two-factor status could not be loaded.</p>
        <p className="mt-1 text-xs opacity-60">{error}</p>
        <Button className="mt-5" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    )
  }

  if (view === 'setup') {
    return (
      <div>
        <ol className="mb-5 space-y-1.5 text-sm opacity-70">
          <li>1. Open Google Authenticator, 1Password, or any TOTP app.</li>
          <li>2. Scan the QR code (or paste the secret).</li>
          <li>3. Enter the 6-digit code it shows.</li>
        </ol>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <img
            src={enroll.qr}
            alt="QR code — scan with your authenticator app"
            className="h-44 w-44 shrink-0 rounded-2xl bg-white p-3 shadow-lg"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider opacity-60">
              Can't scan? Enter this secret
            </div>
            <div className="glass mt-2 flex items-center gap-2 rounded-xl px-3 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">
                {enroll.secret}
              </code>
              <Button variant="ghost" size="icon-sm" onClick={copySecret} aria-label="Copy secret">
                {copied ? <Check size={14} className="text-forest-500" /> : <Copy size={14} />}
              </Button>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider opacity-60">
                Verification code
              </div>
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
                <p role="alert" className="mt-3 text-xs font-medium text-flame-500">{error}</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={code.length !== 6} onClick={() => verifySetup(code)}>
            <ShieldCheck size={16} /> Activate 2FA
          </Button>
        </div>
      </div>
    )
  }

  // status view
  return (
    <div>
      <div className="glass flex items-center gap-4 rounded-2xl p-5">
        <div
          className={
            factor
              ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25'
              : 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-forest-900/8 dark:bg-white/8'
          }
        >
          <Fingerprint size={20} className={factor ? 'text-gold-300' : 'opacity-50'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">
            {factor ? 'Two-factor authentication is on' : 'Two-factor authentication is off'}
          </div>
          <div className="mt-0.5 text-xs opacity-60">
            {factor
              ? 'Signing in requires your password and a rotating authenticator code.'
              : 'Add an authenticator app so a stolen password alone can never open your account.'}
          </div>
        </div>
        <span
          className={
            factor
              ? 'h-2.5 w-2.5 shrink-0 rounded-full bg-forest-500 shadow-[0_0_10px_rgba(16,185,108,0.8)]'
              : 'h-2.5 w-2.5 shrink-0 rounded-full bg-forest-900/20 dark:bg-white/20'
          }
        />
      </div>

      {error && <p role="alert" className="mt-4 text-xs font-medium text-flame-500">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
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
      </div>

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
    </div>
  )
}
