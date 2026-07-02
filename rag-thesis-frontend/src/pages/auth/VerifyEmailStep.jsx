import { useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { OtpInput } from '../../components/ui/OtpInput'
import { StepHeader } from './StepHeader'
import { friendlyAuthError, maskEmail, retryAfterSeconds, useResendTimer } from './authUtils'

/** Confirm a new account with the 6-digit signup code (link also works). */
export function VerifyEmailStep({ email, onBack }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [shakeNonce, setShakeNonce] = useState(0)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useResendTimer(60)

  const verify = async (token) => {
    setVerifying(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })
      if (err) throw err
      toast.success('Email verified — welcome aboard!')
      // Session lands in AuthContext → orchestrator redirects.
    } catch (err) {
      setError(friendlyAuthError(err))
      setShakeNonce((n) => n + 1)
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  const resend = async () => {
    setResending(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email })
      if (err) throw err
      toast.success('Verification email resent', { description: `Check ${maskEmail(email)}` })
      setCooldown(60)
    } catch (err) {
      setError(friendlyAuthError(err))
      const wait = retryAfterSeconds(err)
      if (wait) setCooldown(wait)
    } finally {
      setResending(false)
    }
  }

  return (
    <div>
      <StepHeader
        icon={ShieldCheck}
        title="Verify your email"
        subtitle={
          <>
            Enter the 6-digit code we sent to{' '}
            <span className="font-semibold">{maskEmail(email)}</span> — or click the
            confirmation link in the same email.
          </>
        }
        onBack={onBack}
        backLabel="Edit details"
      />

      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={verify}
        disabled={verifying}
        error={!!error}
        shakeNonce={shakeNonce}
        ariaLabel="Email verification code"
      />

      {error && (
        <p role="alert" aria-live="polite" className="mt-4 text-center text-xs font-medium text-flame-500">
          {error}
        </p>
      )}

      <Button
        size="lg"
        loading={verifying}
        disabled={code.length !== 6}
        onClick={() => verify(code)}
        className="mt-6 w-full"
      >
        Verify my email
      </Button>

      <div className="mt-5 text-center text-xs opacity-60">
        Nothing arrived?{' '}
        {cooldown > 0 ? (
          <span className="font-semibold tabular-nums">Resend in {cooldown}s</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="font-semibold text-forest-600 hover:underline disabled:opacity-50 dark:text-gold-300"
          >
            {resending ? 'Sending…' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  )
}
