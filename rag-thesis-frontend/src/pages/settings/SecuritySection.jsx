import { useState } from 'react'
import { Fingerprint, Laptop, LogOut, Mail, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { apiErrorMessage } from '../../api'
import { authOptions, friendlyAuthError, isStrongPassword } from '../auth/authUtils'
import { PasswordGuide } from '../auth/AuthFx'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { OtpInput } from '../../components/ui/OtpInput'
import { SecurityCheck } from '../../components/security/SecurityCheck'
import { useSecurityGate } from '../../components/security/useSecurityGate'
import { TwoFactorSettings } from '../../components/TwoFactorSettings'
import { SectionCard } from './SectionCard'
import { timeAgo } from '../../lib/utils'

function EmailCard() {
  const { user, refreshProfile, reloadSession } = useAuth()
  const [email, setEmail] = useState(user?.email || '')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState('')
  const [shakeNonce, setShakeNonce] = useState(0)

  const handleUpdate = async () => {
    if (!email || email === user?.email) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ email })
      if (error) throw error
      setVerifying(true)
      toast.success('6-digit code sent to your new email.')
    } catch (err) {
      toast.error('Failed to update email', { description: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (code.length !== 6) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'email_change' })
      if (error) throw error
      toast.success('Email updated successfully')
      setVerifying(false)
      setCode('')
      await reloadSession()
      await refreshProfile()
    } catch (err) {
      toast.error('Verification failed', { description: apiErrorMessage(err) })
      setShakeNonce((n) => n + 1)
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SectionCard icon={Mail} title="Email address" description="Used for sign-in and security verification codes.">
      {verifying ? (
        <div className="space-y-4 rounded-2xl border border-gold-400/20 bg-gold-400/5 p-4">
          <div className="text-sm">Enter the 6-digit code sent to <span className="font-semibold">{email}</span></div>
          <OtpInput value={code} onChange={setCode} onComplete={handleVerify} disabled={loading} shakeNonce={shakeNonce} ariaLabel="Email verification code" />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVerifying(false)}>Cancel</Button>
            <Button size="sm" loading={loading} disabled={code.length !== 6} onClick={handleVerify}>Verify</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input value={email} onChange={(event) => setEmail(event.target.value)} className="flex-1" aria-label="Email address" />
            <Button variant="secondary" loading={loading} onClick={handleUpdate} disabled={email === user?.email || !email}>
              Update
            </Button>
          </div>
          <p className="ml-1 mt-1.5 text-xs text-ink-muted">You will need to verify your new email with a 6-digit code.</p>
        </>
      )}
    </SectionCard>
  )
}

function PasswordCard() {
  const { user } = useAuth()
  const captcha = useSecurityGate()
  const [captchaReset, setCaptchaReset] = useState(0)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState('')
  const [shakeNonce, setShakeNonce] = useState(0)

  const handleRequest = async () => {
    if (!isStrongPassword(password)) {
      toast.error('Use 8+ characters with uppercase, number, and symbol')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, authOptions({
        redirectTo: window.location.origin,
      }, captcha.token))
      if (error) throw error
      setVerifying(true)
      toast.success('6-digit code sent to your email.')
    } catch (err) {
      toast.error('Password change request failed', { description: friendlyAuthError(err) })
    } finally {
      setLoading(false)
      captcha.onToken(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  const handleVerify = async () => {
    if (code.length !== 6) return
    setLoading(true)
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({ email: user.email, token: code, type: 'recovery' })
      if (otpError) throw otpError
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      toast.success('Password updated successfully')
      setVerifying(false)
      setCode('')
      setPassword('')
    } catch (err) {
      toast.error('Verification failed', { description: apiErrorMessage(err) })
      setShakeNonce((n) => n + 1)
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SectionCard icon={ShieldCheck} title="Password" description="Changing your password requires a code sent to your email.">
      {verifying ? (
        <div className="space-y-4 rounded-2xl border border-gold-400/20 bg-gold-400/5 p-4">
          <div className="text-sm">To change your password, enter the 6-digit code sent to your email.</div>
          <OtpInput value={code} onChange={setCode} onComplete={handleVerify} disabled={loading} shakeNonce={shakeNonce} ariaLabel="Password verification code" />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVerifying(false)}>Cancel</Button>
            <Button size="sm" loading={loading} disabled={code.length !== 6} onClick={handleVerify}>Verify &amp; Save</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <SecurityCheck variant="inline" action="password_reset" onToken={captcha.onToken} onStatusChange={captcha.onStatusChange} resetKey={captchaReset} />
          <div className="flex gap-2">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password (min. 8 chars)"
              className="flex-1"
              aria-label="New password"
            />
            <Button variant="secondary" loading={loading} onClick={handleRequest} disabled={!isStrongPassword(password) || captcha.blocked}>
              Update
            </Button>
          </div>
          <PasswordGuide password={password} />
        </div>
      )}
    </SectionCard>
  )
}

function SessionsCard() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)

  const signOutOthers = async () => {
    setBusy(true)
    try {
      // 'others' revokes every refresh token except this device's session.
      const { error } = await supabase.auth.signOut({ scope: 'others' })
      if (error) throw error
      toast.success('Signed out on all other devices')
    } catch (err) {
      toast.error('Could not sign out other devices', { description: friendlyAuthError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard icon={Laptop} title="Sessions" description="Where your account is currently signed in.">
      <div className="space-y-3">
        <div className="glass flex items-center gap-3 rounded-2xl p-4">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forest-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-forest-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">This device</div>
            <div className="text-xs text-ink-muted">
              {user?.last_sign_in_at ? `Signed in ${timeAgo(user.last_sign_in_at)}` : 'Current session'}
            </div>
          </div>
          <span className="rounded-full bg-forest-500/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-forest-700 dark:text-forest-300">
            Active
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-xs text-ink-muted">
            Lost a device or signed in somewhere public? Revoke every session except this one.
          </p>
          <Button variant="outline" size="sm" loading={busy} onClick={signOutOthers}>
            <LogOut size={14} /> Sign out other devices
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

export function SecuritySection() {
  return (
    <div className="space-y-5">
      <SectionCard icon={Fingerprint} title="Two-factor authentication" description="The strongest protection available for your account." tone="gold">
        <TwoFactorSettings />
      </SectionCard>
      <EmailCard />
      <PasswordCard />
      <SessionsCard />
    </div>
  )
}
