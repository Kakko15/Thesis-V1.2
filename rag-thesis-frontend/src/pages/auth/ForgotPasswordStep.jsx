import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Mail, Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { StepHeader } from './StepHeader'
import { EASE, FieldIcon, formStagger, Rise, Shine, UnderlineLink, ValidTick, ErrorAlert } from './AuthFx'
import { friendlyAuthError, isValidEmail, maskEmail, retryAfterSeconds, useResendTimer } from './authUtils'
import { OtpInput } from '../../components/ui/OtpInput'
import { toast } from 'sonner'

/** Request a password-reset OTP and verify it, then set new password. */
export function ForgotPasswordStep({ email, setEmail, onBack }) {
  const [sent, setSent] = useState(false)
  const [verified, setVerified] = useState(false)
  
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [shakeNonce, setShakeNonce] = useState(0)
  
  const [newPassword, setNewPassword] = useState('')
  const [updating, setUpdating] = useState(false)
  
  const [cooldown, setCooldown] = useResendTimer(0)

  const send = async (e) => {
    e?.preventDefault?.()
    if (!isValidEmail(email)) {
      setError('Enter a valid email address')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/login`,
      })
      if (err) throw err
      setSent(true)
      setCooldown(60)
    } catch (err) {
      setError(friendlyAuthError(err))
      const wait = retryAfterSeconds(err)
      if (wait) setCooldown(wait)
    } finally {
      setLoading(false)
    }
  }

  const verifyOtp = async (token) => {
    setVerifying(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' })
      if (err) throw err
      setVerified(true)
      toast.success('Identity verified', { description: 'You can now set a new password.' })
    } catch (err) {
      setError(friendlyAuthError(err))
      setShakeNonce(n => n + 1)
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  const updatePassword = async (e) => {
    e?.preventDefault?.()
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setUpdating(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword })
      if (err) throw err
      toast.success('Password updated successfully')
      // Successfully updated!
      // They are logged in, so if we call onBack() to go to signin, it'll auto-redirect to dashboard.
      onBack()
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div>
      <StepHeader
        icon={KeyRound}
        title="Reset your password"
        subtitle={
          verified
            ? "Enter your new password below."
            : sent 
              ? `Enter the 6-digit code we sent to ${maskEmail(email)}` 
              : "We'll email you a secure 6-digit code to verify your identity."
        }
        onBack={onBack}
        backLabel={sent && !verified ? "Cancel" : "Back to sign in"}
      />

      <AnimatePresence mode="wait">
        {verified ? (
          <motion.form
            key="password_form"
            onSubmit={updatePassword}
            variants={formStagger}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -10, transition: { duration: 0.3, ease: EASE } }}
            className="space-y-5 mt-4"
            noValidate
          >
            <Rise>
              <Field label="New Password" error={error} required>
                <div className="group relative">
                  <FieldIcon icon={Lock} />
                  <Input
                    className="pl-11"
                    type="password"
                    name="password"
                    placeholder="Min. 6 characters"
                    value={newPassword}
                    error={error}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoFocus
                  />
                </div>
              </Field>
            </Rise>
            <Rise>
              <Button
                type="submit"
                size="lg"
                loading={updating}
                disabled={newPassword.length < 6}
                whileHover={{ scale: 1.015, y: -1 }}
                className="group relative w-full overflow-hidden"
              >
                <Shine />
                Update password
              </Button>
            </Rise>
          </motion.form>
        ) : sent ? (
          <motion.div
            key="otp_form"
            variants={formStagger}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -10, transition: { duration: 0.3, ease: EASE } }}
            className="space-y-5"
          >
            <Rise>
              <OtpInput
                value={code}
                onChange={setCode}
                onComplete={verifyOtp}
                disabled={verifying}
                error={!!error}
                shakeNonce={shakeNonce}
                ariaLabel="Password reset code"
              />
            </Rise>
            {error && (
              <ErrorAlert key={shakeNonce} className="mt-4 bg-transparent px-0 py-0 text-center">
                {error}
              </ErrorAlert>
            )}
            <Rise>
              <Button
                size="lg"
                loading={verifying}
                disabled={code.length !== 6}
                onClick={() => verifyOtp(code)}
                whileHover={{ scale: 1.015, y: -1 }}
                className="group relative mt-6 w-full overflow-hidden"
              >
                <Shine />
                Verify Code
              </Button>
            </Rise>
            <Rise className="mt-5 text-center text-xs opacity-60">
              Nothing arrived?{' '}
              {cooldown > 0 ? (
                <span className="font-semibold tabular-nums">Resend in {cooldown}s</span>
              ) : (
                <UnderlineLink
                  onClick={send}
                  disabled={loading}
                  className="text-forest-600 disabled:opacity-50 dark:text-gold-300"
                >
                  {loading ? 'Sending…' : 'Resend code'}
                </UnderlineLink>
              )}
            </Rise>
          </motion.div>
        ) : (
          <motion.form
            key="email_form"
            onSubmit={send}
            variants={formStagger}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -10, transition: { duration: 0.3, ease: EASE } }}
            className="space-y-5"
            noValidate
          >
            <Rise>
              <Field label="Email" error={error} required>
                <div className="group relative">
                  <FieldIcon icon={Mail} />
                  <Input
                    className="pl-11 pr-11"
                    type="email"
                    name="email"
                    placeholder="you@isu.edu.ph"
                    value={email}
                    error={error}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                  />
                  <ValidTick show={isValidEmail(email) && !error} />
                </div>
              </Field>
            </Rise>
            <Rise>
              <Button
                type="submit"
                size="lg"
                loading={loading}
                whileHover={{ scale: 1.015, y: -1 }}
                className="group relative w-full overflow-hidden"
              >
                <Shine />
                Send verification code
              </Button>
            </Rise>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
