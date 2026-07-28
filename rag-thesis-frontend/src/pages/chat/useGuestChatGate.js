import { useState } from 'react'
import { toast } from 'sonner'
import { turnstileEnabled } from '../../components/security/turnstileConfig'

const STORAGE_KEY = 'iskai_guest_gate_ok'

/**
 * One-time guest verification for the backend Turnstile chat guard.
 * Inactive for signed-in users and whenever no Turnstile site key is set.
 */
export function useGuestChatGate(user) {
  const [token, setToken] = useState(null)
  const [needed, setNeeded] = useState(
    () => turnstileEnabled && window.sessionStorage.getItem(STORAGE_KEY) !== '1',
  )
  const [resetKey, setResetKey] = useState(0)
  const active = !user && needed

  return {
    active,
    setToken,
    resetKey,
    // Sending stays blocked until the guest solves the one-time check.
    ensureReady() {
      if (!active || token) return true
      toast.info('Complete the security check first', {
        description: 'One quick check unlocks guest chat for this session.',
      })
      return false
    },
    tokenForRequest() {
      return active ? token : null
    },
    markPassed() {
      if (!active) return
      window.sessionStorage.setItem(STORAGE_KEY, '1')
      setNeeded(false)
      setToken(null)
    },
    // The backend guard asks for a (re)verification — reopen the widget.
    handleChatError(error) {
      if (user || !error?.response?.headers?.['x-guest-verification']) return
      window.sessionStorage.removeItem(STORAGE_KEY)
      setNeeded(true)
      setToken(null)
      setResetKey((key) => key + 1)
    },
  }
}
