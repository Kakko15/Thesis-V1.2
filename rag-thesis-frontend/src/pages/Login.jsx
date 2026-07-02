import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { Aurora } from '../components/ui/Aurora'
import { Logo } from '../components/ui/Logo'
import { cn } from '../lib/utils'
import { AuthShowcase } from './auth/AuthShowcase'
import { SignInForm } from './auth/SignInForm'
import { SignUpForm } from './auth/SignUpForm'
import { OtpSignInStep } from './auth/OtpSignInStep'
import { VerifyEmailStep } from './auth/VerifyEmailStep'
import { MfaChallengeStep } from './auth/MfaChallengeStep'
import { ForgotPasswordStep } from './auth/ForgotPasswordStep'
import { ResetPasswordStep } from './auth/ResetPasswordStep'
import { SuccessStep } from './auth/SuccessStep'

/* Steps: signin · signup · otp · verifyEmail · mfa · forgot · reset · success.
   Transitions between auth state and steps are DERIVED at render time
   (never set in effects):
   - session needs 2FA          → mfa challenge
   - session fully established  → success ceremony → dashboard
   - PASSWORD_RECOVERY          → reset (event/URL driven)                 */

const isRecoveryUrl = () =>
  /type=recovery/.test(window.location.hash + window.location.search)

export default function Login() {
  const [step, setStep] = useState(() => (isRecoveryUrl() ? 'reset' : 'signin'))
  const [email, setEmail] = useState('')
  const { user, needsMfa, displayName } = useAuth()
  const navigate = useNavigate()

  // The emailed reset link fires PASSWORD_RECOVERY once supabase-js
  // exchanges the token — route straight into the new-password step.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStep('reset')
    })
    return () => subscription.unsubscribe()
  }, [])

  // Render-time step resolution against the live auth state.
  let effectiveStep = step
  if (user && needsMfa && step !== 'reset' && step !== 'success') {
    effectiveStep = 'mfa'
  } else if (user && !needsMfa && !['reset', 'forgot'].includes(step)) {
    effectiveStep = 'success'
  }

  const showTabs = effectiveStep === 'signin' || effectiveStep === 'signup'

  const renderStep = () => {
    switch (effectiveStep) {
      case 'signup':
        return (
          <SignUpForm
            email={email}
            setEmail={setEmail}
            onVerifyNeeded={() => setStep('verifyEmail')}
            onSwitchToSignIn={() => setStep('signin')}
          />
        )
      case 'otp':
        return <OtpSignInStep email={email} onBack={() => setStep('signin')} />
      case 'verifyEmail':
        return <VerifyEmailStep email={email} onBack={() => setStep('signup')} />
      case 'mfa':
        return (
          <MfaChallengeStep
            onUseAnotherAccount={async () => {
              await supabase.auth.signOut()
              setStep('signin')
            }}
          />
        )
      case 'forgot':
        return <ForgotPasswordStep email={email} setEmail={setEmail} onBack={() => setStep('signin')} />
      case 'reset':
        return <ResetPasswordStep onDone={() => setStep('success')} />
      case 'success':
        return (
          <SuccessStep
            title={`Welcome, ${displayName}!`}
            subtitle="Taking you to your dashboard…"
            onDone={() => navigate('/dashboard', { replace: true })}
          />
        )
      default:
        return (
          <SignInForm
            email={email}
            setEmail={setEmail}
            onForgot={() => setStep('forgot')}
            onOtpSent={(addr) => {
              setEmail(addr)
              setStep('otp')
            }}
            onNeedsVerify={(addr) => {
              setEmail(addr)
              setStep('verifyEmail')
            }}
          />
        )
    }
  }

  return (
    <div className="relative flex min-h-screen items-stretch overflow-hidden">
      <Aurora />
      <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 opacity-40" />

      {/* Left showcase panel (desktop) */}
      <div className="relative hidden flex-1 items-center justify-center p-12 lg:flex">
        <AuthShowcase />
      </div>

      {/* Auth panel */}
      <div className="relative flex flex-1 items-center justify-center px-5 py-10">
        {/* Soft glow orbs behind the card */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute right-[8%] top-[12%] h-56 w-56 rounded-full bg-forest-500/10 blur-3xl" />
          <div className="absolute bottom-[10%] left-[6%] h-64 w-64 rounded-full bg-gold-400/10 blur-3xl" />
        </div>

        <motion.div
          layout
          initial={{ opacity: 0, y: 28, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
          className="glass-strong relative w-full max-w-md rounded-[2rem] p-8 sm:p-10"
        >
          {showTabs && (
            <Link
              to="/"
              className="mb-8 inline-flex items-center gap-1.5 text-xs font-semibold opacity-50 transition-opacity hover:opacity-100"
            >
              <ArrowLeft size={13} /> Back to home
            </Link>
          )}

          <div className={cn('mb-8 flex items-center gap-3 lg:hidden', !showTabs && 'mt-2')}>
            <Logo size={44} glow />
            <div className="font-display text-lg font-extrabold">ISU Thesis AI Library</div>
          </div>

          {/* Mode switch */}
          {showTabs && (
            <div className="glass relative mb-8 grid grid-cols-2 rounded-2xl p-1">
              {['signin', 'signup'].map((m) => (
                <button
                  key={m}
                  onClick={() => setStep(m)}
                  className={cn(
                    'relative z-10 rounded-xl py-2.5 text-sm font-semibold transition-colors duration-300',
                    effectiveStep === m ? 'text-white' : 'opacity-60 hover:opacity-100',
                  )}
                >
                  {effectiveStep === m && (
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
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={effectiveStep}
              initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
              transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>

          {showTabs && (
            <div className="mt-8 border-t border-forest-900/10 pt-6 text-center dark:border-white/10">
              <button
                onClick={() => navigate('/chat')}
                className="inline-flex items-center gap-2 text-sm font-semibold text-forest-600 transition-colors hover:text-forest-500 dark:text-gold-300 dark:hover:text-gold-200"
              >
                <Sparkles size={14} />
                Continue as guest — no account needed
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
