import { useEffect, useState } from 'react'

/** Latches true once the browser has an idle window after all caller gates pass. */
export function useIdleReady(enabled, timeout = 1200) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled || ready) return undefined
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => setReady(true), { timeout })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => setReady(true), Math.min(timeout, 400))
    return () => window.clearTimeout(id)
  }, [enabled, ready, timeout])

  return ready
}
