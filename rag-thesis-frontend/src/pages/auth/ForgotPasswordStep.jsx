import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Mail, MailCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { StepHeader } from './StepHeader'
import { EASE, FieldIcon, formStagger, Rise, Shine, UnderlineLink, ValidTick } from './AuthFx'
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
            transition={{ duration: 0.4, ease: EASE }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 20 }}
              className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-forest-500/12"
            >
              <motion.span
                aria-hidden="true"
                initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: 1.6, opacity: [0, 0.6, 0] }}
                transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full border-2 border-forest-500/50"
              />
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
                <UnderlineLink onClick={send} className="text-forest-600 dark:text-gold-300">
                  Send it again
                </UnderlineLink>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
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
                Email me a reset link
              </Button>
            </Rise>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
