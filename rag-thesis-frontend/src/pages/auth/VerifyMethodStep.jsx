import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ChevronRight, Fingerprint, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { OtpInput } from '../../components/ui/OtpInput'
import { SecurityCheck } from '../../components/security/SecurityCheck'
import { useSecurityGate } from '../../components/security/useSecurityGate'
import { useAuth } from '../../context/AuthContext'
import { cn } from '../../lib/utils'
import { StepHeader } from './StepHeader'
import { MfaChallengeStep } from './MfaChallengeStep'
import { ErrorAlert, formStagger, Rise, Shine, UnderlineLink } from './AuthFx'
import {
  authOptions, friendlyAuthError, maskEmail, retryAfterSeconds, useResendTimer,
} from './authUtils'

/**
 * Post-password verification for every account: the visitor picks how to
 * prove the second step — a 6-digit code emailed to them, or their
 * authenticator app when one is enrolled. Email codes cannot raise Supabase
 * AAL, so a passed email code marks the login satisfied at app level
 * (`satisfyMfa`) for this session only; a fresh load re-raises the challenge.
 */
export function VerifyMethodStep({ email, totpEnrolled, onBack, onDone }) {
  const { satisfyMfa } = useAuth()
  const [method, setMethod] = useState(null) // null | 'email' | 'totp'
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [shakeNonce, setShakeNonce] = useState(0)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useResendTimer(0)
  // Gated submission that fails open when Turnstile itself is unreachable.
  const captcha = useSecurityGate()
  const [captchaReset, setCaptchaReset] = useState(0)

  const sendCode = async () => {
    setSending(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: authOptions({ shouldCreateUser: false }, captcha.token),
      })
      if (err) throw err
      setMethod('email')
      setCooldown(60)
    } catch (err) {
      setError(friendlyAuthError(err))
      const wait = retryAfterSeconds(err)
      if (wait) setCooldown(wait)
    } finally {
      setSending(false)
      captcha.onToken(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  const verifyCode = async (token) => {
    setVerifying(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' })
      if (err) throw err
      // Email codes cannot raise Supabase AAL — record the app-level pass so
      // an enrolled account is not bounced back into the challenge.
      satisfyMfa()
      toast.success('Identity verified')
      onDone?.()
    } catch (err) {
      setError(friendlyAuthError(err))
      setShakeNonce((value) => value + 1)
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  if (method === 'totp') {
    return (
      <MfaChallengeStep
        switchLabel="Choose another method"
        onUseAnotherAccount={() => { setError(''); setMethod(null) }}
        onVerified={() => {
          // aal2 lands via AuthContext; satisfyMfa only papers over the gap.
          satisfyMfa()
          onDone?.()
        }}
      />
    )
  }

  const methods = [
    {
      key: 'email',
      icon: Mail,
      title: 'Email me a code',
      description: `Send a 6-digit code to ${maskEmail(email)}`,
      disabled: false,
    },
    {
      key: 'totp',
      icon: Fingerprint,
      title: 'Authenticator app',
      description: totpEnrolled
        ? 'Enter the rotating 6-digit code from your app'
        : 'Not set up on this account',
      disabled: !totpEnrolled,
    },
  ]

  return (
    <div>
      <StepHeader
        icon={ShieldCheck}
        title="Verify it's you"
        subtitle={
          method === 'email'
            ? (
              <>
                Enter the 6-digit code we sent to{' '}
                <span className="font-semibold">{maskEmail(email)}</span>.
              </>
            )
            : 'One more step — choose how you want to finish signing in.'
        }
        onBack={method === 'email' ? () => { setError(''); setCode(''); setMethod(null) } : onBack}
        backLabel={method === 'email' ? 'Choose another method' : 'Back to sign in'}
      />

      <motion.div
        key={method ?? 'picker'}
        variants={formStagger}
        initial="hidden"
        animate="show"
        className="mt-4 space-y-4"
      >
        {method === 'email' ? (
          <>
            <Rise>
              <OtpInput
                value={code}
                onChange={setCode}
                onComplete={verifyCode}
                disabled={verifying}
                error={!!error}
                shakeNonce={shakeNonce}
                ariaLabel="Email verification code"
              />
            </Rise>
            <Rise>
              <Button
                size="lg"
                loading={verifying}
                disabled={code.length !== 6}
                onClick={() => verifyCode(code)}
                className="group relative w-full overflow-hidden"
              >
                <Shine />
                Verify & continue
              </Button>
            </Rise>
          </>
        ) : (
          methods.map((m) => (
            <Rise key={m.key}>
              <motion.button
                type="button"
                whileHover={m.disabled ? undefined : { y: -2 }}
                whileTap={m.disabled ? undefined : { scale: 0.985 }}
                onClick={() => (m.key === 'email' ? sendCode() : setMethod('totp'))}
                disabled={m.disabled || sending || captcha.blocked}
                className={cn(
                  'group flex w-full items-center gap-3.5 rounded-2xl border bg-[var(--surface-1)] px-4 py-3.5 text-left',
                  'transition-[border-color,box-shadow,background-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
                  m.disabled
                    ? 'cursor-not-allowed border-[var(--border)] opacity-50'
                    : 'border-[var(--border)] hover:border-forest-500/50 hover:shadow-lg hover:shadow-forest-500/10',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-500/10 text-forest-700 transition-colors duration-300 dark:text-forest-300',
                    !m.disabled && 'group-hover:bg-forest-500 group-hover:text-white',
                  )}
                >
                  <m.icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{m.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">{m.description}</span>
                </span>
                {m.key === 'email' && sending ? (
                  <Loader2 size={16} className="shrink-0 animate-spin text-ink-faint" />
                ) : (
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-ink-faint transition-transform duration-300 group-hover:translate-x-1"
                  />
                )}
              </motion.button>
            </Rise>
          ))
        )}

        {error && (
          <ErrorAlert key={shakeNonce} className="bg-transparent px-0 py-0 text-center">
            {error}
          </ErrorAlert>
        )}

        {method === 'email' && (
          <Rise className="text-center text-xs text-ink-muted">
            Nothing arrived?{' '}
            {cooldown > 0 ? (
              <span className="font-semibold tabular-nums">Resend in {cooldown}s</span>
            ) : (
              <UnderlineLink
                onClick={sendCode}
                disabled={sending || captcha.blocked}
                className="text-forest-700 disabled:opacity-50 dark:text-gold-300"
              >
                {sending ? 'Sending…' : 'Resend code'}
              </UnderlineLink>
            )}
          </Rise>
        )}
      </motion.div>

      {/* Outside the keyed container so switching methods never remounts the
          widget (a remount would burn a fresh challenge for no reason). */}
      <SecurityCheck
        variant="inline"
        quiet
        action="login_verify"
        onToken={captcha.onToken}
        onStatusChange={captcha.onStatusChange}
        resetKey={captchaReset}
        className="mt-4"
      />
    </div>
  )
}
