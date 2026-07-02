import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { Check, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { cn } from '../../lib/utils'
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
      <div className="mb-7 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25">
          <ShieldCheck size={21} className="text-gold-300" />
        </div>
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
            Choose a new password
          </h1>
          <p className="mt-1 text-sm leading-relaxed opacity-60">
            You're securely signed in through the reset link — set a fresh password to finish.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Field label="New password" error={error} required>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
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
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 opacity-40 transition-opacity hover:opacity-90"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
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
                        <Check size={10} className={cn('transition-opacity', ok ? 'opacity-100' : 'opacity-30')} />
                        {rule.label}
                      </span>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Field>

        <Button type="submit" size="lg" loading={loading} className="w-full">
          Update password & continue
        </Button>
      </form>
    </div>
  )
}
