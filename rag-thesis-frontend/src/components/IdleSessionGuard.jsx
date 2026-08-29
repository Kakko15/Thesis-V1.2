import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { LogOut, TimerReset } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { isE2ETestMode } from '../testing/e2eSession'
import {
  ABSOLUTE_SESSION_MS,
  formatCountdown,
  IDLE_LAST_ACTIVITY_KEY,
  IDLE_SESSION_START_KEY,
  IDLE_WARNING_MS,
  idleLimitForRole,
} from '../lib/idleSession'

/* Real activity only — keystrokes, clicks, scrolls, touches. Mousemove is
   deliberately excluded: a cursor parked over the page is not presence. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

/** Depleting countdown ring for the warning modal (forest tone, 48px viewbox). */
function CountdownRing({ secondsLeft, totalSeconds }) {
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const progress = totalSeconds > 0 ? secondsLeft / totalSeconds : 0
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-14 w-14 -rotate-90">
        <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="4" className="stroke-forest-500/15" />
        <motion.circle
          cx="24" cy="24" r={radius} fill="none" strokeWidth="4" strokeLinecap="round"
          className="stroke-forest-500"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - progress) }}
          transition={{ duration: 0.9, ease: 'linear' }}
        />
      </svg>
      <span className="absolute font-mono text-sm font-bold tabular-nums text-forest-700 dark:text-forest-300">
        {secondsLeft}
      </span>
    </span>
  )
}

/**
 * Tiered idle logout, mounted once for the whole app (App.jsx).
 *
 *  - admin/superadmin idle out at 15 min, everyone else at 30 min
 *  - 60 s before the deadline a warning modal offers "Stay signed in"
 *  - a 12 h absolute cap signs out regardless of activity
 *  - one session = one idle clock: the last-activity stamp lives in
 *    localStorage so every open tab shares it, and signing out anywhere
 *    propagates through Supabase's own auth listener
 *  - on expiry the current route is preserved as ?next= so a successful
 *    re-login lands right back here
 */
export function IdleSessionGuard() {
  const { user, isAdmin, needsMfa, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [secondsLeft, setSecondsLeft] = useState(null) // null → no warning
  const expiringRef = useRef(false)
  const lastActivityRef = useRef(0)

  const active = Boolean(user) && !needsMfa && !isE2ETestMode

  const expire = useCallback(
    async (reason) => {
      if (expiringRef.current) return
      expiringRef.current = true
      window.localStorage.removeItem(IDLE_LAST_ACTIVITY_KEY)
      window.localStorage.removeItem(IDLE_SESSION_START_KEY)
      setSecondsLeft(null)
      await signOut()
      const here = location.pathname + location.search
      const keepContext = here !== '/' && !here.startsWith('/login')
      navigate(
        keepContext ? `/login?next=${encodeURIComponent(here)}` : '/login',
        { replace: true },
      )
      if (reason === 'absolute') {
        toast.info('Session expired', {
          description: 'For security, sessions last 12 hours. Sign in again to continue.',
        })
      } else if (reason === 'idle') {
        toast.info('Signed out for inactivity', {
          description: 'Your session was closed to keep this account secure on shared devices.',
        })
      }
    },
    [signOut, navigate, location],
  )

  // Record activity — shared across tabs via localStorage, throttled so a
  // held key or scroll storm writes at most once per second. Any real
  // activity also dismisses the warning: the user is clearly back.
  const recordActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastActivityRef.current < 1000) return
    lastActivityRef.current = now
    window.localStorage.setItem(IDLE_LAST_ACTIVITY_KEY, String(now))
    setSecondsLeft(null) // any real activity dismisses the warning
  }, [])

  useEffect(() => {
    if (!active) {
      // Signed out (or mid-MFA): drop the shared clocks so the next login
      // starts a fresh session window. Rendering is gated on `active`, so a
      // stale secondsLeft can never show the warning while signed out.
      window.localStorage.removeItem(IDLE_LAST_ACTIVITY_KEY)
      window.localStorage.removeItem(IDLE_SESSION_START_KEY)
      expiringRef.current = false
      return undefined
    }

    // A session start survives reloads (12 h cap is measured from the first
    // login, not from this tab's mount).
    if (!window.localStorage.getItem(IDLE_SESSION_START_KEY)) {
      window.localStorage.setItem(IDLE_SESSION_START_KEY, String(Date.now()))
    }
    recordActivity()

    const limitMs = idleLimitForRole(isAdmin)

    const tick = () => {
      const now = Date.now()
      // Another tab may be the active one — always trust the freshest stamp.
      const shared = Number(window.localStorage.getItem(IDLE_LAST_ACTIVITY_KEY)) || 0
      const lastActivity = Math.max(lastActivityRef.current, shared)

      const sessionStart = Number(window.localStorage.getItem(IDLE_SESSION_START_KEY)) || now
      if (now - sessionStart >= ABSOLUTE_SESSION_MS) {
        void expire('absolute')
        return
      }

      const remaining = lastActivity + limitMs - now
      if (remaining <= 0) {
        void expire('idle')
      } else if (remaining <= IDLE_WARNING_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000))
      } else {
        setSecondsLeft(null)
      }
    }

    const interval = setInterval(tick, 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, recordActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, recordActivity))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, isAdmin, expire, recordActivity])

  const warningSeconds = secondsLeft ?? 0

  return (
    <Modal
      open={active && secondsLeft !== null}
      onClose={recordActivity} // overlay/Escape = "I'm still here"
      title="Still there?"
      size="sm"
    >
      <div className="flex items-center gap-4">
        <CountdownRing secondsLeft={warningSeconds} totalSeconds={IDLE_WARNING_MS / 1000} />
        <p className="text-sm leading-relaxed text-ink-muted">
          For your security, you'll be signed out in{' '}
          <span className="font-mono font-bold tabular-nums text-ink">
            {formatCountdown(warningSeconds * 1000)}
          </span>{' '}
          of inactivity. Anything you typed stays on this page.
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="ghost"
          onClick={() => expire('manual')}
        >
          <LogOut size={15} /> Sign out now
        </Button>
        <Button autoFocus onClick={recordActivity}>
          <TimerReset size={15} /> Stay signed in
        </Button>
      </div>
    </Modal>
  )
}
