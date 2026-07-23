import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, KeyRound, Lock, Mail, TriangleAlert } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { TurnstileWidget } from '../../components/security/TurnstileWidget'
import { turnstileEnabled } from '../../components/security/turnstileConfig'
import { authOptions, friendlyAuthError, isValidEmail } from './authUtils'
import {
  ErrorAlert, FieldIcon, formStagger, PasswordEye, Rise, Shine, UnderlineLink, ValidTick,
} from './AuthFx'

/**
 * Email + password sign-in, with a passwordless "email me a code" path.
 * MFA-enrolled accounts continue automatically to the 2FA step — the
 * orchestrator reacts to `needsMfa` from AuthContext after this succeeds.
 */
export function SignInForm({ email, setEmail, onForgot, onOtpSent, onNeedsVerify }) {
  const { reloadSession } = useAuth()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [errors, setErrors] = useState({})
  const [errorNonce, setErrorNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaReset, setCaptchaReset] = useState(0)

  const failWith = (next) => {
    setErrors(next)
    setErrorNonce((n) => n + 1)
  }

  const validate = (needPassword = true) => {
    const next = {}
    if (!isValidEmail(email)) next.email = 'Enter a valid email address'
    if (needPassword && password.length < 8) next.password = 'Password must be at least 8 characters'
    failWith(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(), password, options: authOptions({}, captchaToken),
      })
      if (error) throw error
      // Success: force a reload of the session state so AuthContext updates immediately.
      await reloadSession()
    } catch (err) {
      const friendly = friendlyAuthError(err)
      if ((err?.message || '').toLowerCase().includes('email not confirmed')) {
        onNeedsVerify?.(email.trim())
        toast.info('Almost there', { description: 'Verify your email to finish setting up.' })
      } else {
        failWith({ form: friendly })
      }
    } finally {
      setLoading(false)
      setCaptchaToken(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  const handleOtpRequest = async () => {
    if (!validate(false)) return
    setOtpLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: authOptions({ shouldCreateUser: false }, captchaToken),
      })
      if (error) throw error
      onOtpSent?.(email.trim())
    } catch (err) {
      failWith({ form: friendlyAuthError(err) })
    } finally {
      setOtpLoading(false)
      setCaptchaToken(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  return (
    <motion.form
      variants={formStagger}
      initial="hidden"
      animate="show"
      onSubmit={handleSubmit}
      className="space-y-5"
      noValidate
    >
      <Rise>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider opacity-70">
            Email <span className="text-flame-500">*</span>
          </span>
          <div className="group relative">
            <FieldIcon icon={Mail} />
            <Input
              className="pl-11 pr-11"
              type="email"
              name="email"
              placeholder="you@isu.edu.ph"
              value={email}
              error={errors.email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
            <ValidTick show={isValidEmail(email) && !errors.email} />
          </div>
          {errors.email && (
            <span className="mt-1.5 block text-xs font-medium text-flame-500">{errors.email}</span>
          )}
        </label>
      </Rise>

      <Rise>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider opacity-70">
            Password <span className="text-flame-500">*</span>
          </span>
          <UnderlineLink
            onClick={onForgot}
            className="text-xs text-forest-600 hover:text-forest-500 dark:text-gold-300 dark:hover:text-gold-200"
          >
            Forgot password?
          </UnderlineLink>
        </div>
        <div className="group relative">
          <FieldIcon icon={Lock} />
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
          <PasswordEye show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
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
      </Rise>

      {errors.form && <ErrorAlert key={errorNonce}>{errors.form}</ErrorAlert>}

      <Rise>
        <TurnstileWidget action="signin" onToken={setCaptchaToken} resetKey={captchaReset} />
      </Rise>

      <Rise>
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={turnstileEnabled && !captchaToken}
          className="group relative w-full overflow-hidden"
        >
          <Shine />
          Sign in
          <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Button>
      </Rise>

      <Rise className="flex items-center gap-3 py-1" aria-hidden="true">
        <span className="h-px flex-1 bg-forest-900/10 dark:bg-white/10" />
        <span className="text-[0.65rem] font-bold uppercase tracking-widest opacity-40">or</span>
        <span className="h-px flex-1 bg-forest-900/10 dark:bg-white/10" />
      </Rise>

      <Rise>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          loading={otpLoading}
          disabled={turnstileEnabled && !captchaToken}
          onClick={handleOtpRequest}
          className="group relative w-full overflow-hidden"
        >
          <Shine />
          <KeyRound size={16} className="transition-transform duration-300 group-hover:-rotate-12" />
          Email me a login link
        </Button>
      </Rise>
    </motion.form>
  )
}
