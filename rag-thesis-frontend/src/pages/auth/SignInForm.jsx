import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, KeyRound, TriangleAlert } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { SecurityCheck } from '../../components/security/SecurityCheck'
import { useSecurityGate } from '../../components/security/useSecurityGate'
import {
  authOptions, friendlyAuthError, isRateLimitError, isValidEmail, retryAfterSeconds, useResendTimer,
} from './authUtils'
import {
  ErrorAlert, FloatingField, formStagger, PasswordEye, RateLimitAlert, Rise, Shine, UnderlineLink, ValidTick,
} from './AuthFx'

/**
 * Email + password sign-in, with a passwordless "email me a code" path.
 * A successful password login always continues to the post-login
 * verification picker (email code / authenticator app) — `onPasswordSuccess`
 * arms it before the session reload lands.
 */
export function SignInForm({ email, setEmail, onForgot, onOtpSent, onNeedsVerify, onPasswordSuccess }) {
  const { reloadSession } = useAuth()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [touched, setTouched] = useState({})
  const [errors, setErrors] = useState({})
  const [errorNonce, setErrorNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  // Gated submission that fails open when Turnstile itself is unreachable.
  const captcha = useSecurityGate()
  const [captchaReset, setCaptchaReset] = useState(0)
  // Rate-limit cooldown: while `cooldown > 0` both submit paths stay disabled
  // behind the RateLimitAlert countdown. Supabase's limit is per-IP, so the
  // timer intentionally survives edits to the email field.
  const [cooldown, setCooldown] = useResendTimer(0)
  const [cooldownTotal, setCooldownTotal] = useState(0)

  const startCooldown = (err) => {
    const seconds = retryAfterSeconds(err) || 60
    setCooldownTotal(seconds)
    setCooldown(seconds)
    setErrors({})
  }

  const failWith = (next) => {
    setErrors(next)
    setErrorNonce((n) => n + 1)
  }

  const fieldError = (name, values) => {
    if (name === 'email') return isValidEmail(values.email) ? '' : 'Enter a valid email address'
    return values.password.length >= 8 ? '' : 'Password must be at least 8 characters'
  }

  // Revalidate a single field (optionally with its in-flight value), merging
  // the result into the error map so the other field is left alone.
  const checkField = (name, overrides = {}) => {
    const message = fieldError(name, { email, password, ...overrides })
    setErrors((prev) => {
      const next = { ...prev }
      if (message) next[name] = message
      else delete next[name]
      return next
    })
  }

  // Blur validation: leaving a field with a bad (or empty) value flags it.
  const blurField = (name) => () => {
    setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }))
    checkField(name)
  }

  // Live validation only kicks in after the first blur, so typing into a
  // fresh field never flashes red prematurely.
  const changeField = (name, setter) => (e) => {
    const { value } = e.target
    setter(value)
    if (touched[name]) checkField(name, { [name]: value })
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
        email: email.trim(), password, options: authOptions({}, captcha.token),
      })
      if (error) throw error
      // The verification picker comes next for every account.
      onPasswordSuccess?.()
      // Success: force a reload of the session state so AuthContext updates immediately.
      await reloadSession()
    } catch (err) {
      if (isRateLimitError(err)) {
        startCooldown(err)
      } else if ((err?.message || '').toLowerCase().includes('email not confirmed')) {
        onNeedsVerify?.(email.trim())
        toast.info('Almost there', { description: 'Verify your email to finish setting up.' })
      } else {
        failWith({ form: friendlyAuthError(err) })
      }
    } finally {
      setLoading(false)
      captcha.onToken(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  const handleOtpRequest = async () => {
    if (!validate(false)) return
    setOtpLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: authOptions({ shouldCreateUser: false }, captcha.token),
      })
      if (error) throw error
      onOtpSent?.(email.trim())
    } catch (err) {
      if (isRateLimitError(err)) startCooldown(err)
      else failWith({ form: friendlyAuthError(err) })
    } finally {
      setOtpLoading(false)
      captcha.onToken(null)
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
        <FloatingField
          label="Email"
          required
          type="email"
          name="email"
          value={email}
          error={errors.email}
          onChange={changeField('email', setEmail)}
          onBlur={blurField('email')}
          autoComplete="email"
          endAdornment={<ValidTick show={isValidEmail(email) && !errors.email} />}
        />
      </Rise>

      <Rise>
        <div className="mb-1.5 flex justify-end">
          <UnderlineLink
            onClick={onForgot}
            className="text-xs text-forest-700 hover:text-forest-500 dark:text-gold-300 dark:hover:text-gold-200"
          >
            Forgot password?
          </UnderlineLink>
        </div>
        <FloatingField
          label="Password"
          required
          type={showPassword ? 'text' : 'password'}
          name="password"
          value={password}
          error={errors.password}
          onChange={changeField('password', setPassword)}
          onBlur={blurField('password')}
          onKeyDown={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
          onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
          autoComplete="current-password"
          endAdornment={<PasswordEye show={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
        />
        {capsLock && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-gold-400/15 px-2 py-1 text-xs font-semibold text-gold-text dark:text-gold-300"
          >
            <TriangleAlert size={11} /> Caps Lock is on
          </motion.span>
        )}
      </Rise>

      <AnimatePresence initial={false}>
        {cooldown > 0 && (
          <RateLimitAlert key="rate-limit" seconds={cooldown} total={cooldownTotal} />
        )}
      </AnimatePresence>
      {cooldown <= 0 && errors.form && <ErrorAlert key={errorNonce}>{errors.form}</ErrorAlert>}

      <Rise>
        <SecurityCheck variant="inline" quiet action="signin" onToken={captcha.onToken} onStatusChange={captcha.onStatusChange} resetKey={captchaReset} />
      </Rise>

      <Rise>
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={captcha.blocked || cooldown > 0}
          className="group relative w-full overflow-hidden"
        >
          <Shine />
          {cooldown > 0 ? `Try again in ${cooldown}s` : 'Sign in'}
          {cooldown <= 0 && (
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
          )}
        </Button>
      </Rise>

      <Rise className="flex items-center gap-3 py-1" aria-hidden="true">
        <span className="h-px flex-1 bg-forest-900/10 dark:bg-white/10" />
        <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">or</span>
        <span className="h-px flex-1 bg-forest-900/10 dark:bg-white/10" />
      </Rise>

      <Rise>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          loading={otpLoading}
          disabled={captcha.blocked || cooldown > 0}
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
