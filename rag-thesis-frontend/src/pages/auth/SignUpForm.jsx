import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, Check, Eye, EyeOff, Lock, Mail, User } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { cn } from '../../lib/utils'
import {
  friendlyAuthError, isValidEmail, passwordStrength,
  PASSWORD_RULES, STRENGTH_COLORS, STRENGTH_LABELS,
} from './authUtils'

/** Create-account form → email verification step (or straight in when
    confirmation is disabled on the project). */
export function SignUpForm({ email, setEmail, onVerifyNeeded, onSwitchToSignIn }) {
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [exists, setExists] = useState(false)

  const strength = useMemo(() => passwordStrength(password), [password])

  const validate = () => {
    const next = {}
    if (fullName.trim().length < 2) next.fullName = 'Please enter your full name'
    if (!isValidEmail(email)) next.email = 'Enter a valid email address'
    if (password.length < 8) next.password = 'Password must be at least 8 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setExists(false)
    if (!validate()) return
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      })
      if (error) throw error
      if (data.session) {
        // Email confirmation disabled on the project — signed straight in.
        toast.success('Welcome to the archive!')
      } else {
        onVerifyNeeded?.(email.trim())
      }
    } catch (err) {
      if ((err?.message || '').toLowerCase().includes('already registered')) {
        setExists(true)
        setErrors({})
      } else {
        setErrors({ form: friendlyAuthError(err) })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <Field label="Full name" error={errors.fullName} required>
        <div className="relative">
          <User size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <Input
            className="pl-11"
            name="name"
            placeholder="Juan D. Dela Cruz"
            value={fullName}
            error={errors.fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            autoFocus
          />
        </div>
      </Field>

      <Field label="Email" error={errors.email} required>
        <div className="relative">
          <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <Input
            className="pl-11"
            type="email"
            name="email"
            placeholder="you@isu.edu.ph"
            value={email}
            error={errors.email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
      </Field>

      <Field label="Password" error={errors.password} required>
        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <Input
            className="pl-11 pr-11"
            type={showPassword ? 'text' : 'password'}
            name="new-password"
            placeholder="At least 8 characters"
            value={password}
            error={errors.password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
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

        {/* Strength meter + live requirement ticks */}
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

      {exists && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gold-400/12 px-3.5 py-2.5 text-xs font-medium"
        >
          <span>An account with this email already exists.</span>
          <button
            type="button"
            onClick={onSwitchToSignIn}
            className="font-bold text-forest-600 hover:underline dark:text-gold-300"
          >
            Sign in instead →
          </button>
        </motion.div>
      )}

      {errors.form && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-xl bg-flame-500/10 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-flame-600 dark:text-flame-400"
        >
          {errors.form}
        </p>
      )}

      <Button type="submit" size="lg" loading={loading} className="group w-full">
        Create my account
        <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
      </Button>

      <p className="text-center text-[0.68rem] leading-relaxed opacity-45">
        We'll send a 6-digit code to verify your email.
      </p>
    </form>
  )
}
