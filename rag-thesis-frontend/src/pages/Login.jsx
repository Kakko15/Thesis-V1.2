import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Mail, Lock, User, Eye, EyeOff, ArrowRight, ArrowLeft,
  Sparkles, ShieldCheck, Quote, MessageSquareText,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { Aurora } from '../components/ui/Aurora'
import { Logo } from '../components/ui/Logo'
import { Button } from '../components/ui/Button'
import { Input, Field } from '../components/ui/Input'
import { cn } from '../lib/utils'

const HIGHLIGHTS = [
  { icon: MessageSquareText, text: 'Ask the archive in plain language' },
  { icon: Quote, text: 'Every answer cites real CCSICT theses' },
  { icon: ShieldCheck, text: 'Topic duplication flagged at 85% similarity' },
]

function passwordStrength(pw) {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score // 0-4
}

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
const STRENGTH_COLORS = ['bg-flame-500', 'bg-flame-500', 'bg-gold-400', 'bg-forest-500', 'bg-forest-500']

export default function Login() {
  const [mode, setMode] = useState('signin') // signin | signup
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  const strength = useMemo(() => passwordStrength(password), [password])

  const validate = () => {
    const next = {}
    if (mode === 'signup' && fullName.trim().length < 2) next.fullName = 'Please enter your full name'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid email address'
    if (password.length < 8) next.password = 'Password must be at least 8 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (error) throw error
        toast.success('Account created!', {
          description: 'Check your inbox if email confirmation is required, then sign in.',
        })
        setMode('signin')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        toast.success('Welcome back!')
        navigate('/dashboard')
      }
    } catch (err) {
      toast.error(mode === 'signup' ? 'Sign up failed' : 'Sign in failed', {
        description: err.message,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-stretch overflow-hidden">
      <Aurora />

      {/* Left showcase panel (desktop) */}
      <div className="relative hidden flex-1 items-center justify-center p-12 lg:flex">
        <div className="relative z-10 max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
          >
            <div className="animate-float inline-block">
              <div className="glass-strong rounded-full p-4 shadow-[0_0_60px_rgba(242,169,0,0.2)]">
                <Logo size={88} glow />
              </div>
            </div>
            <h1 className="font-display mt-8 text-4xl font-extrabold leading-tight tracking-tight">
              Research at the
              <br />
              <span className="text-gradient-isu">speed of thought</span>
            </h1>
            <p className="mt-4 text-sm leading-relaxed opacity-65">
              The Centralized AI-Powered Thesis Library of CCSICT, Isabela State University —
              semantic search, grounded synthesis, and novelty validation in one place.
            </p>
            <div className="mt-8 space-y-3">
              {HIGHLIGHTS.map((h, i) => (
                <motion.div
                  key={h.text}
                  initial={{ opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.15, duration: 0.6, ease: [0.2, 0, 0, 1] }}
                  className="glass flex items-center gap-3 rounded-2xl px-4 py-3"
                >
                  <h.icon size={17} className="shrink-0 text-gold-400" />
                  <span className="text-sm font-medium opacity-85">{h.text}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Auth panel */}
      <div className="relative flex flex-1 items-center justify-center px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: 28, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
          className="glass-strong w-full max-w-md rounded-[2rem] p-8 sm:p-10"
        >
          <Link to="/" className="mb-8 inline-flex items-center gap-1.5 text-xs font-semibold opacity-50 transition-opacity hover:opacity-100">
            <ArrowLeft size={13} /> Back to home
          </Link>

          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo size={44} glow />
            <div className="font-display text-lg font-extrabold">ISU Thesis AI Library</div>
          </div>

          {/* Mode switch */}
          <div className="glass relative mb-8 grid grid-cols-2 rounded-2xl p-1">
            {['signin', 'signup'].map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setErrors({}) }}
                className={cn(
                  'relative z-10 rounded-xl py-2.5 text-sm font-semibold transition-colors duration-300',
                  mode === m ? 'text-white' : 'opacity-60 hover:opacity-100',
                )}
              >
                {mode === m && (
                  <motion.div
                    layoutId="auth-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-md"
                  />
                )}
                <span className="relative">{m === 'signin' ? 'Sign in' : 'Create account'}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.form
              key={mode}
              initial={{ opacity: 0, x: mode === 'signup' ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === 'signup' ? -24 : 24 }}
              transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
              onSubmit={handleSubmit}
              className="space-y-5"
            >
              {mode === 'signup' && (
                <Field label="Full name" error={errors.fullName} required>
                  <div className="relative">
                    <User size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
                    <Input
                      className="pl-11"
                      placeholder="Juan D. Dela Cruz"
                      value={fullName}
                      error={errors.fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </Field>
              )}

              <Field label="Email" error={errors.email} required>
                <div className="relative">
                  <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
                  <Input
                    className="pl-11"
                    type="email"
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
                    placeholder="At least 8 characters"
                    value={password}
                    error={errors.password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
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
                {mode === 'signup' && password && (
                  <div className="mt-2.5">
                    <div className="flex gap-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <motion.div
                          key={i}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          className={cn(
                            'h-1 flex-1 origin-left rounded-full transition-colors duration-300',
                            i < strength ? STRENGTH_COLORS[strength] : 'bg-forest-900/10 dark:bg-white/10',
                          )}
                        />
                      ))}
                    </div>
                    <span className="mt-1.5 block text-[0.68rem] font-medium opacity-55">
                      {STRENGTH_LABELS[strength]}
                    </span>
                  </div>
                )}
              </Field>

              <Button type="submit" size="lg" loading={loading} className="group w-full">
                {mode === 'signup' ? 'Create my account' : 'Sign in'}
                <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </motion.form>
          </AnimatePresence>

          <div className="mt-8 border-t border-forest-900/10 pt-6 text-center dark:border-white/10">
            <button
              onClick={() => navigate('/chat')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-forest-600 transition-colors hover:text-forest-500 dark:text-gold-300 dark:hover:text-gold-200"
            >
              <Sparkles size={14} />
              Continue as guest — no account needed
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
