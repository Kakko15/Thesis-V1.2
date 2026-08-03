import { useCallback, useEffect, useRef, useState } from 'react'
import { turnstileEnabled } from '../../components/security/turnstileConfig'

const STORAGE_KEY = 'iskai_guest_gate_ok'

/**
 * One-time guest verification for the backend Turnstile chat guard.
 * Inactive for signed-in users and whenever no Turnstile site key is set.
 *
 * The challenge is armed lazily — the first time a guest engages with the
 * composer — so a visitor who only reads the page never loads it, and by the
 * time they finish typing the token is usually already in hand.
 *
 * `onVerified` fires from Turnstile's own callback, letting the caller release
 * an action that was parked while the check ran.
 */
export function useGuestChatGate(user, { onVerified } = {}) {
  const [token, setToken] = useState(null)
  const [needed, setNeeded] = useState(
    () => turnstileEnabled && window.sessionStorage.getItem(STORAGE_KEY) !== '1',
  )
  const [armed, setArmed] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  // The token is mirrored in a ref because a parked send is released from inside
  // the Turnstile callback, before the token state has committed.
  const tokenRef = useRef(null)
  const onVerifiedRef = useRef(onVerified)
  const active = !user && needed

  useEffect(() => {
    onVerifiedRef.current = onVerified
  })

  const acceptToken = useCallback((next) => {
    tokenRef.current = next
    setToken(next)
    if (next) onVerifiedRef.current?.()
  }, [])

  const arm = useCallback(() => setArmed(true), [])

  return {
    active,
    // Mount the widget only once the guest has shown intent to send.
    armed: active && armed,
    hasToken: Boolean(token),
    resetKey,
    acceptToken,
    arm,
    isReady() {
      return !active || Boolean(tokenRef.current)
    },
    tokenForRequest() {
      return active ? tokenRef.current : null
    },
    markPassed() {
      if (!active) return
      window.sessionStorage.setItem(STORAGE_KEY, '1')
      tokenRef.current = null
      setNeeded(false)
      setToken(null)
      setArmed(false)
    },
    // The backend guard asks for a (re)verification — reopen the widget. This
    // can arrive after a pass, so it checks `user` rather than `active`.
    handleChatError(error) {
      if (user || !error?.response?.headers?.['x-guest-verification']) return
      window.sessionStorage.removeItem(STORAGE_KEY)
      tokenRef.current = null
      setNeeded(true)
      setToken(null)
      setArmed(true)
      setResetKey((key) => key + 1)
    },
  }
}
