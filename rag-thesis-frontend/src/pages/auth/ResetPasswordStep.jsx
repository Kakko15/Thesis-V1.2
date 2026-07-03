import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { Check, Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { cn } from '../../lib/utils'
import { StepHeader } from './StepHeader'
import { FieldIcon, formStagger, PasswordEye, Rise, Shine } from './AuthFx'
import {
  friendlyAuthError, passwordStrength,
  PASSWORD_RULES, STRENGTH_COLORS, STRENGTH_LABELS,
} from './authUtils'

/** Final step of the recovery flow — the user arrived via the emailed link. */
export function ResetPasswordStep({ onDone }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const strength = useMemo(() => passwordStrength(password), [password])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      toast.success('Password updated', { description: 'You are signed in with your new password.' })
      onDone?.()
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <StepHeader
        icon={ShieldCheck}
        title="Choose a new password"
        subtitle="You're securely signed in through the reset link — set a fresh password to finish."
      />

      <motion.form
        variants={formStagger}
        initial="hidden"
        animate="show"
        onSubmit={handleSubmit}
        className="space-y-5"
        noValidate
      >
        <Rise>
          <Field label="New password" error={error} required>
            <div className="group relative">
              <FieldIcon icon={Lock} />
              <Input
                className="pl-11 pr-11"
                type={showPassword ? 'text' : 'password'}
                name="new-password"
                placeholder="At least 8 characters"
                value={password}
                error={error}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
              <PasswordEye show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
            </div>

            <AnimatePresence>
              {password && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 flex gap-1.5">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        style={{ transitionDelay: `${i * 45}ms` }}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-colors duration-300',
                          i < strength ? STRENGTH_COLORS[strength] : 'bg-forest-900/10 dark:bg-white/10',
                        )}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[0.68rem] font-semibold opacity-55">{STRENGTH_LABELS[strength]}</span>
                    {PASSWORD_RULES.map((rule) => {
                      const ok = rule.test(password)
                      return (
                        <span
                          key={rule.key}
                          className={cn(
                            'inline-flex items-center gap-1 text-[0.65rem] font-medium transition-colors duration-300',
                            ok ? 'text-forest-600 dark:text-forest-300' : 'opacity-40',
                          )}
                        >
                          <motion.span
                            animate={ok ? { scale: [1, 1.35, 1] } : {}}
                            transition={{ duration: 0.3 }}
                            className="inline-flex"
                          >
                            <Check size={10} className={cn('transition-opacity', ok ? 'opacity-100' : 'opacity-30')} />
                          </motion.span>
                          {rule.label}
                        </span>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
            Update password & continue
          </Button>
        </Rise>
      </motion.form>
    </div>
  )
}
