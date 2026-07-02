import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Fingerprint } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { OtpInput } from '../../components/ui/OtpInput'
import { Spinner } from '../../components/ui/Spinner'
import { StepHeader } from './StepHeader'
import { friendlyAuthError } from './authUtils'

/**
 * Second factor: verify a rotating TOTP code from the user's authenticator
 * app. Success upgrades the session to aal2 — AuthContext clears `needsMfa`
 * and the orchestrator proceeds.
 */
export function MfaChallengeStep({ onUseAnotherAccount }) {
  const [factorId, setFactorId] = useState(null)
  const [factorError, setFactorError] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [shakeNonce, setShakeNonce] = useState(0)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.auth.mfa.listFactors().then(({ data, error: err }) => {
      if (cancelled) return
      const totp = data?.totp?.find((f) => f.status === 'verified') ?? data?.totp?.[0]
      if (err || !totp) setFactorError('No authenticator found on this account. Sign in again or contact an admin.')
      else setFactorId(totp.id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const verify = async (token) => {
    if (!factorId) return
    setVerifying(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: token })
      if (err) throw err
      toast.success('Identity verified')
      // Session is now aal2 → AuthContext flips needsMfa → orchestrator redirects.
    } catch (err) {
      setError(friendlyAuthError(err))
      setShakeNonce((n) => n + 1)
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div>
      <StepHeader
        icon={Fingerprint}
        title="Two-factor authentication"
        subtitle="Enter the 6-digit code from your authenticator app to finish signing in."
      />

      {!factorId && !factorError ? (
        <div className="flex justify-center py-8">
          <Spinner size={28} />
        </div>
      ) : factorError ? (
        <p role="alert" className="rounded-xl bg-flame-500/10 px-3.5 py-3 text-center text-xs font-medium text-flame-600 dark:text-flame-400">
          {factorError}
        </p>
      ) : (
        <>
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={verify}
            disabled={verifying}
            error={!!error}
            shakeNonce={shakeNonce}
            ariaLabel="Authenticator code"
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
            Verify & continue
          </Button>

          <p className="mt-4 text-center text-[0.68rem] leading-relaxed opacity-45">
            Codes rotate every 30 seconds — use the current one.
          </p>
        </>
      )}

      <div className="mt-5 border-t border-forest-900/10 pt-4 text-center dark:border-white/10">
        <button
          type="button"
          onClick={onUseAnotherAccount}
          className="text-xs font-semibold opacity-50 transition-opacity hover:opacity-100"
        >
          Use a different account
        </button>
      </div>
    </div>
  )
}
