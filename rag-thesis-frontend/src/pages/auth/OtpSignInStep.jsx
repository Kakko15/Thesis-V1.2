import { useState } from 'react'
import { toast } from 'sonner'
import { MailCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { OtpInput } from '../../components/ui/OtpInput'
import { StepHeader } from './StepHeader'
import { friendlyAuthError, maskEmail, retryAfterSeconds, useResendTimer } from './authUtils'

/** Passwordless sign-in: verify the 6-digit code emailed by signInWithOtp. */
export function OtpSignInStep({ email, onBack }) {
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
      const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
      if (err) throw err
      toast.success('Welcome back!')
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
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
      if (err) throw err
      toast.success('New code sent', { description: `Check ${maskEmail(email)}` })
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
        icon={MailCheck}
        title="Check your inbox"
        subtitle={
          <>
            We sent a 6-digit code to <span className="font-semibold">{maskEmail(email)}</span>.
            Clicking the magic link in the email works too.
          </>
        }
        onBack={onBack}
        backLabel="Sign in another way"
      />

      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={verify}
        disabled={verifying}
        error={!!error}
        shakeNonce={shakeNonce}
        ariaLabel="Email sign-in code"
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
        Verify & sign in
      </Button>

      <div className="mt-5 text-center text-xs opacity-60">
        Didn't get it?{' '}
        {cooldown > 0 ? (
          <span className="font-semibold tabular-nums">Resend in {cooldown}s</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="font-semibold text-forest-600 hover:underline disabled:opacity-50 dark:text-gold-300"
          >
            {resending ? 'Sending…' : 'Resend code'}
          </button>
        )}
      </div>
    </div>
  )
}
