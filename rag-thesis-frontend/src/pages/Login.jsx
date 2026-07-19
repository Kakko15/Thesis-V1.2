import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AnimatePresence, motion, useSpring, useTransform,
} from 'framer-motion'
import { ArrowLeft, LogIn, Sparkles, UserPlus } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePreferences } from '../context/PreferencesContext'
import { Aurora } from '../components/ui/Aurora'
import { Logo } from '../components/ui/Logo'
import { cn } from '../lib/utils'
import { AuthShowcase } from './auth/AuthShowcase'
import { EASE } from './auth/AuthFx'
import { SignInForm } from './auth/SignInForm'
import { SignUpForm } from './auth/SignUpForm'
import { OtpSignInStep } from './auth/OtpSignInStep'
import { VerifyEmailStep } from './auth/VerifyEmailStep'
import { MfaChallengeStep } from './auth/MfaChallengeStep'
import { ForgotPasswordStep } from './auth/ForgotPasswordStep'
import { ResetPasswordStep } from './auth/ResetPasswordStep'
import { SuccessStep } from './auth/SuccessStep'

const AuthScene = lazy(() => import('../components/three/AuthScene'))

/* Steps: signin · signup · otp · verifyEmail · mfa · forgot · reset · success.
   Transitions between auth state and steps are DERIVED at render time
   (never set in effects):
   - session needs 2FA          → mfa challenge
   - session fully established  → success ceremony → dashboard
   - PASSWORD_RECOVERY          → reset (event/URL driven)                 */

const isRecoveryUrl = () =>
  /type=recovery/.test(window.location.hash + window.location.search)

/* Depth per step — direction of travel drives the slide axis: deeper steps
   enter from the right, returning steps from the left, tab switches slide
   along the tab order. */
const STEP_DEPTH = { signin: 0, signup: 0, otp: 1, verifyEmail: 1, forgot: 1, mfa: 1, reset: 1, success: 2 }
const TABS = ['signin', 'signup']
const TAB_META = {
  signin: { label: 'Sign in', icon: LogIn },
  signup: { label: 'Create account', icon: UserPlus },
}

const stepVariants = {
  enter: (dir) =>
    dir === 0
      ? { opacity: 0, y: 18, filter: 'blur(6px)' }
      : { opacity: 0, x: 44 * dir, filter: 'blur(6px)' },
  center: { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' },
  exit: (dir) =>
    dir === 0
      ? { opacity: 0, y: -14, filter: 'blur(6px)' }
      : { opacity: 0, x: -44 * dir, filter: 'blur(6px)' },
}

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.97, filter: 'blur(10px)' },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: EASE, staggerChildren: 0.09, delayChildren: 0.12 },
  },
}
const cardItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
}

/* Mount the 3D constellation only where it earns its keep: desktop viewports,
   WebGL available, reduced motion off. */
function useAuthScene() {
  const { reducedMotion, effects } = usePreferences()
  const [webgl] = useState(() => {
    try {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
    } catch {
      return false
    }
  })
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e) => setDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return !reducedMotion && effects !== 'low' && webgl && desktop
}

export default function Login() {
  const [step, setStep] = useState(() => (isRecoveryUrl() ? 'reset' : 'signin'))
  const [email, setEmail] = useState('')
  const { user, needsMfa, displayName } = useAuth()
  const navigate = useNavigate()
  const show3D = useAuthScene()
  const cardRef = useRef(null)

  // Soft pointer parallax for the glow orbs behind the card.
  const mx = useSpring(0, { stiffness: 40, damping: 18 })
  const my = useSpring(0, { stiffness: 40, damping: 18 })
  const orbAX = useTransform(mx, (v) => v * 26)
  const orbAY = useTransform(my, (v) => v * 18)
  const orbBX = useTransform(mx, (v) => v * -20)
  const orbBY = useTransform(my, (v) => v * -14)

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

  // Direction of travel for the step slide — state adjusted during render
  // (React's "adjusting state when props change" pattern), so state-derived
  // jumps like mfa/success get a direction too.
  const [nav, setNav] = useState({ step: effectiveStep, dir: 0 })
  if (nav.step !== effectiveStep) {
    const depthDelta = STEP_DEPTH[effectiveStep] - STEP_DEPTH[nav.step]
    let nextDir = 0
    if (depthDelta !== 0) nextDir = Math.sign(depthDelta)
    else if (TABS.includes(nav.step) && TABS.includes(effectiveStep))
      nextDir = TABS.indexOf(effectiveStep) > TABS.indexOf(nav.step) ? 1 : -1
    setNav({ step: effectiveStep, dir: nextDir })
  }
  const dir = nav.dir

  const showTabs = effectiveStep === 'signin' || effectiveStep === 'signup'

  const onRootPointerMove = (e) => {
    mx.set((e.clientX / window.innerWidth) * 2 - 1)
    my.set((e.clientY / window.innerHeight) * 2 - 1)
  }

  // Cursor-tracked spotlight on the card (drives .spotlight-overlay).
  const onCardPointerMove = (e) => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
  }

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
    <div
      onPointerMove={onRootPointerMove}
      className="relative flex min-h-screen items-stretch overflow-hidden"
    >
      <Aurora />
      <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 opacity-40" />

      {/* Left showcase panel (desktop) */}
      <div className="relative hidden flex-1 items-center justify-center p-12 lg:flex">
        {show3D && (
          <div aria-hidden="true" className="effects-decorative pointer-events-none absolute inset-0">
            <Suspense fallback={null}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.8, delay: 0.4, ease: 'easeOut' }}
                className="h-full w-full"
              >
                <AuthScene />
              </motion.div>
            </Suspense>
          </div>
        )}
        <AuthShowcase />
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="absolute bottom-7 left-12 text-[0.68rem] font-medium tracking-wide opacity-30"
        >
          © {new Date().getFullYear()} Isabela State University · CCSICT
        </motion.p>
      </div>

      {/* Auth panel */}
      <div className="relative flex flex-1 items-center justify-center px-5 py-10">
        {/* Soft glow orbs behind the card — pointer-parallax for depth */}
        <div aria-hidden="true" className="effects-decorative pointer-events-none absolute inset-0 overflow-hidden">
          <motion.div
            style={{ x: orbAX, y: orbAY }}
            className="absolute right-[8%] top-[12%] h-56 w-56 rounded-full bg-forest-500/10 blur-3xl"
          />
          <motion.div
            style={{ x: orbBX, y: orbBY }}
            className="absolute bottom-[10%] left-[6%] h-64 w-64 rounded-full bg-gold-400/10 blur-3xl"
          />
        </div>

        <motion.div
          ref={cardRef}
          layout
          variants={cardVariants}
          initial="hidden"
          animate="show"
          onPointerMove={onCardPointerMove}
          className={cn(
            'gradient-border gradient-border-glass relative w-full max-w-md rounded-[2rem] p-8 sm:p-10',
            // Deeper fill than the .gradient-border-glass default so the gold
            // aurora blob can't wash out copy behind the card.
            '[--gb-fill:rgba(255,255,255,0.8)] dark:[--gb-fill:rgba(7,31,18,0.8)]',
            'shadow-[0_16px_48px_rgba(4,42,24,0.12)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.5)]',
          )}
        >
          <div aria-hidden="true" className="spotlight-overlay rounded-[2rem]" />

          {showTabs && (
            <motion.div variants={cardItem}>
              <Link
                to="/"
                className="group mb-8 inline-flex items-center gap-1.5 text-xs font-semibold opacity-50 transition-opacity hover:opacity-100"
              >
                <ArrowLeft size={13} className="transition-transform duration-300 group-hover:-translate-x-0.5" />
                Back to home
              </Link>
            </motion.div>
          )}

          <motion.div
            variants={cardItem}
            className={cn('mb-8 flex items-center gap-3 lg:hidden', !showTabs && 'mt-2')}
          >
            <Logo size={44} glow />
            <div className="font-display text-lg font-extrabold">ISU Thesis AI Library</div>
          </motion.div>

          {/* Mode switch */}
          {showTabs && (
            <motion.div variants={cardItem} className="glass relative mb-8 grid grid-cols-2 rounded-2xl p-1">
              {TABS.map((m) => {
                const { label, icon: Icon } = TAB_META[m]
                return (
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
                    <span className="relative inline-flex items-center justify-center gap-1.5">
                      <Icon
                        size={14}
                        className={cn(
                          'transition-colors duration-300',
                          effectiveStep === m && 'text-gold-300',
                        )}
                      />
                      {label}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          )}

          <motion.div variants={cardItem}>
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={effectiveStep}
                custom={dir}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.4, ease: EASE }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {showTabs && (
            <motion.div
              variants={cardItem}
              className="mt-8 border-t border-forest-900/10 pt-6 text-center dark:border-white/10"
            >
              <button
                onClick={() => navigate('/chat')}
                className={cn(
                  'group relative inline-flex items-center gap-2 text-sm font-semibold text-forest-600 transition-colors hover:text-forest-500 dark:text-gold-300 dark:hover:text-gold-200',
                  'after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-current after:transition-transform after:duration-300 hover:after:scale-x-100',
                )}
              >
                <Sparkles size={14} className="transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
                Continue as Guest Researcher — no account needed
              </button>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
