import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Mail, MailCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { StepHeader } from './StepHeader'
import { friendlyAuthError, isValidEmail, maskEmail, retryAfterSeconds, useResendTimer } from './authUtils'

/** Request a password-reset email. Copy avoids account enumeration. */
export function ForgotPasswordStep({ email, setEmail, onBack }) {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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

  return (
    <div>
      <StepHeader
        icon={KeyRound}
        title="Reset your password"
        subtitle="We'll email you a secure link to choose a new one."
        onBack={onBack}
        backLabel="Back to sign in"
      />

      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 20 }}
              className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-forest-500/12"
            >
              <MailCheck size={26} className="text-forest-600 dark:text-forest-300" />
            </motion.div>
            <h2 className="font-display text-lg font-bold">Check your inbox</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed opacity-60">
              If an account exists for <span className="font-semibold">{maskEmail(email)}</span>,
              a reset link is on its way. It expires in about an hour.
            </p>
            <div className="mt-6 text-xs opacity-60">
              {cooldown > 0 ? (
                <span className="font-semibold tabular-nums">Resend available in {cooldown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={send}
                  className="font-semibold text-forest-600 hover:underline dark:text-gold-300"
                >
                  Send it again
                </button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={send}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
            className="space-y-5"
            noValidate
          >
            <Field label="Email" error={error} required>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
                <Input
                  className="pl-11"
                  type="email"
                  name="email"
                  placeholder="you@isu.edu.ph"
                  value={email}
                  error={error}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </Field>
            <Button type="submit" size="lg" loading={loading} className="w-full">
              Email me a reset link
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
