import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, Lock } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Field, Select } from '../../components/ui/Input'
import { SecurityCheck } from '../../components/security/SecurityCheck'
import { useSecurityGate } from '../../components/security/useSecurityGate'
import {
  authOptions, friendlyAuthError, isStrongPassword, isValidEmail,
} from './authUtils'
import {
  ErrorAlert, FloatingField, formStagger, PasswordEye, PasswordGuide, Rise, Shine, UnderlineLink,
  ValidTick,
} from './AuthFx'

/** Create-account form → email verification step (or straight in when
    confirmation is disabled on the project). */
export function SignUpForm({ email, setEmail, onVerifyNeeded, onSwitchToSignIn }) {
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('student')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [touched, setTouched] = useState({})
  const [errors, setErrors] = useState({})
  const [errorNonce, setErrorNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exists, setExists] = useState(false)
  // Gated submission that fails open when Turnstile itself is unreachable.
  const captcha = useSecurityGate()
  const [captchaReset, setCaptchaReset] = useState(0)

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword

  const failWith = (next) => {
    setErrors(next)
    setErrorNonce((n) => n + 1)
  }

  const fieldError = (name, values) => {
    switch (name) {
      case 'fullName':
        return values.fullName.trim().length < 2 ? 'Please enter your full name' : ''
      case 'email':
        return isValidEmail(values.email) ? '' : 'Enter a valid email address'
      case 'password':
        if (!values.password) return 'Please enter a password'
        return isStrongPassword(values.password)
          ? ''
          : 'Use 8+ characters with uppercase, number, and symbol'
      case 'confirmPassword':
        if (!values.confirmPassword) return 'Please confirm your password'
        return values.confirmPassword === values.password ? '' : 'Passwords do not match'
      default:
        return ''
    }
  }

  // Revalidate a single field (optionally with its in-flight value), merging
  // the result into the error map so other fields are left alone.
  const checkField = (name, overrides = {}) => {
    const message = fieldError(name, { fullName, email, password, confirmPassword, ...overrides })
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
    // Confirm password follows edits to the password it must match.
    if (name === 'password' && touched.confirmPassword) {
      checkField('confirmPassword', { password: value })
    }
  }

  const validate = () => {
    const values = { fullName, email, password, confirmPassword }
    const next = {}
    for (const name of ['fullName', 'email', 'password', 'confirmPassword']) {
      const message = fieldError(name, values)
      if (message) next[name] = message
    }
    setTouched({ fullName: true, email: true, password: true, confirmPassword: true })
    failWith(next)
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
        options: authOptions({
          data: { 
            full_name: fullName.trim(),
            requested_role: role
          },
          emailRedirectTo: `${window.location.origin}/login`,
        }, captcha.token),
      })
      if (error) throw error
      if (data.session) {
        // Email confirmation disabled on the project — signed straight in.
        toast.success('Welcome to the archive!')
      } else {
        onVerifyNeeded?.(email.trim())
      }
    } catch (err) {
      failWith({ form: friendlyAuthError(err) })
    } finally {
      setLoading(false)
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
          label="Full name"
          required
          name="name"
          value={fullName}
          error={errors.fullName}
          onChange={changeField('fullName', setFullName)}
          onBlur={blurField('fullName')}
          autoComplete="name"
          endAdornment={<ValidTick show={fullName.trim().length >= 2 && !errors.fullName} />}
        />
      </Rise>

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
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Department" required>
            <div className="flex h-10 items-center gap-2 rounded-xl border border-forest-900/10 bg-forest-900/[0.035] px-3 text-sm font-semibold dark:border-white/10 dark:bg-white/[0.04]">
              <Lock size={14} aria-hidden="true" />
              CCSICT
              <span className="ml-auto text-xs font-medium uppercase tracking-wider text-ink-faint">Assigned</span>
            </div>
          </Field>
          <Field label="Account Type" required>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-10"
              aria-label="Account type"
            >
              <option value="student">Student</option>
              <option value="faculty">Faculty (needs approval)</option>
            </Select>
          </Field>
        </div>
      </Rise>

      <Rise>
        <FloatingField
          label="Password"
          required
          type={showPassword ? 'text' : 'password'}
          name="new-password"
          value={password}
          error={errors.password}
          onChange={changeField('password', setPassword)}
          onBlur={blurField('password')}
          autoComplete="new-password"
          endAdornment={(
            <>
              <ValidTick show={passwordsMatch} className="right-11" />
              <PasswordEye show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
            </>
          )}
        />

        <PasswordGuide password={password} />
      </Rise>

      <Rise>
        <FloatingField
          label="Confirm password"
          required
          type={showConfirmPassword ? 'text' : 'password'}
          name="confirm-password"
          value={confirmPassword}
          error={errors.confirmPassword}
          onChange={changeField('confirmPassword', setConfirmPassword)}
          onBlur={blurField('confirmPassword')}
          autoComplete="new-password"
          endAdornment={(
            <>
              <ValidTick show={passwordsMatch} className="right-11" />
              <PasswordEye show={showConfirmPassword} onToggle={() => setShowConfirmPassword((s) => !s)} />
            </>
          )}
        />
      </Rise>

      {exists && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gold-400/12 px-3.5 py-2.5 text-xs font-medium"
        >
          <span>An account with this email already exists.</span>
          <UnderlineLink
            onClick={onSwitchToSignIn}
            className="font-bold text-forest-700 dark:text-gold-300"
          >
            Sign in instead →
          </UnderlineLink>
        </motion.div>
      )}

      {errors.form && <ErrorAlert key={errorNonce}>{errors.form}</ErrorAlert>}

      <Rise>
        <SecurityCheck variant="inline" quiet action="signup" onToken={captcha.onToken} onStatusChange={captcha.onStatusChange} resetKey={captchaReset} />
      </Rise>

      <Rise>
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={captcha.blocked}
          className="group relative w-full overflow-hidden"
        >
          <Shine />
          Create my account
          <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Button>
      </Rise>

      <Rise>
        <p className="text-center text-xs leading-relaxed text-ink-faint">
          We'll send a 6-digit code to verify your email.
        </p>
      </Rise>
    </motion.form>
  )
}
