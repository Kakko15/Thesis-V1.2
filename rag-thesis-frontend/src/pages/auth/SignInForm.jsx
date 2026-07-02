import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail, TriangleAlert } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { friendlyAuthError, isValidEmail } from './authUtils'

/**
 * Email + password sign-in, with a passwordless "email me a code" path.
 * MFA-enrolled accounts continue automatically to the 2FA step — the
 * orchestrator reacts to `needsMfa` from AuthContext after this succeeds.
 */
export function SignInForm({ email, setEmail, onForgot, onOtpSent, onNeedsVerify }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)

  const validate = (needPassword = true) => {
    const next = {}
    if (!isValidEmail(email)) next.email = 'Enter a valid email address'
    if (needPassword && password.length < 8) next.password = 'Password must be at least 8 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      // Success: AuthContext picks up the session; the orchestrator either
      // routes to the dashboard or into the 2FA challenge (needsMfa).
    } catch (err) {
      const friendly = friendlyAuthError(err)
      if ((err?.message || '').toLowerCase().includes('email not confirmed')) {
        onNeedsVerify?.(email.trim())
        toast.info('Almost there', { description: 'Verify your email to finish setting up.' })
      } else {
        setErrors({ form: friendly })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleOtpRequest = async () => {
    if (!validate(false)) return
    setOtpLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      })
      if (error) throw error
      onOtpSent?.(email.trim())
    } catch (err) {
      setErrors({ form: friendlyAuthError(err) })
    } finally {
      setOtpLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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
            autoFocus
          />
        </div>
      </Field>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider opacity-70">
            Password <span className="text-flame-500">*</span>
          </span>
          <button
            type="button"
            onClick={onForgot}
            className="text-xs font-semibold text-forest-600 transition-colors hover:text-forest-500 dark:text-gold-300 dark:hover:text-gold-200"
          >
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <Input
            className="pl-11 pr-11"
            type={showPassword ? 'text' : 'password'}
            name="password"
            placeholder="Your password"
            value={password}
            error={errors.password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
            onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
            autoComplete="current-password"
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
        {errors.password && (
          <span className="mt-1.5 block text-xs font-medium text-flame-500">{errors.password}</span>
        )}
        {capsLock && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-gold-400/15 px-2 py-1 text-[0.7rem] font-semibold text-gold-600 dark:text-gold-300"
          >
            <TriangleAlert size={11} /> Caps Lock is on
          </motion.span>
        )}
      </div>

      {errors.form && (
        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          aria-live="polite"
          className="rounded-xl bg-flame-500/10 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-flame-600 dark:text-flame-400"
        >
          {errors.form}
        </motion.p>
      )}

      <Button type="submit" size="lg" loading={loading} className="group w-full">
        Sign in
        <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
      </Button>

      <div className="flex items-center gap-3 py-1" aria-hidden="true">
        <span className="h-px flex-1 bg-forest-900/10 dark:bg-white/10" />
        <span className="text-[0.65rem] font-bold uppercase tracking-widest opacity-40">or</span>
        <span className="h-px flex-1 bg-forest-900/10 dark:bg-white/10" />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        loading={otpLoading}
        onClick={handleOtpRequest}
        className="w-full"
      >
        <KeyRound size={16} />
        Email me a one-time code
      </Button>
    </form>
  )
}
