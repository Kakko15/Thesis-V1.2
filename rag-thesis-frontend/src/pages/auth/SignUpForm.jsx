import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, Check, Lock, Mail, User } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Input'
import { cn } from '../../lib/utils'
import {
  friendlyAuthError, isValidEmail, passwordStrength,
  PASSWORD_RULES, STRENGTH_COLORS, STRENGTH_LABELS,
} from './authUtils'
import {
  ErrorAlert, FieldIcon, formStagger, PasswordEye, Rise, Shine, UnderlineLink, ValidTick,
} from './AuthFx'

/** Create-account form → email verification step (or straight in when
    confirmation is disabled on the project). */
export function SignUpForm({ email, setEmail, onVerifyNeeded, onSwitchToSignIn }) {
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [errorNonce, setErrorNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exists, setExists] = useState(false)

  const strength = useMemo(() => passwordStrength(password), [password])

  const failWith = (next) => {
    setErrors(next)
    setErrorNonce((n) => n + 1)
  }

  const validate = () => {
    const next = {}
    if (fullName.trim().length < 2) next.fullName = 'Please enter your full name'
    if (!isValidEmail(email)) next.email = 'Enter a valid email address'
    if (password.length < 8) next.password = 'Password must be at least 8 characters'
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
        failWith({ form: friendlyAuthError(err) })
      }
    } finally {
      setLoading(false)
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
        <Field label="Full name" error={errors.fullName} required>
          <div className="group relative">
            <FieldIcon icon={User} />
            <Input
              className="pl-11 pr-11"
              name="name"
              placeholder="Juan D. Dela Cruz"
              value={fullName}
              error={errors.fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              autoFocus
            />
            <ValidTick show={fullName.trim().length >= 2 && !errors.fullName} />
          </div>
        </Field>
      </Rise>

      <Rise>
        <Field label="Email" error={errors.email} required>
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
            />
            <ValidTick show={isValidEmail(email) && !errors.email} />
          </div>
        </Field>
      </Rise>

      <Rise>
        <Field label="Password" error={errors.password} required>
          <div className="group relative">
            <FieldIcon icon={Lock} />
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
            <PasswordEye show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
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
            className="font-bold text-forest-600 dark:text-gold-300"
          >
            Sign in instead →
          </UnderlineLink>
        </motion.div>
      )}

      {errors.form && <ErrorAlert key={errorNonce}>{errors.form}</ErrorAlert>}

      <Rise>
        <Button
          type="submit"
          size="lg"
          loading={loading}
          whileHover={{ scale: 1.015, y: -1 }}
          className="group relative w-full overflow-hidden"
        >
          <Shine />
          Create my account
          <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Button>
      </Rise>

      <Rise>
        <p className="text-center text-[0.68rem] leading-relaxed opacity-45">
          We'll send a 6-digit code to verify your email.
        </p>
      </Rise>
    </motion.form>
  )
}
