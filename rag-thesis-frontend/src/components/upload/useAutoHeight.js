import { useCallback, useEffect, useRef, useState } from 'react'
import { usePreferences } from '../../context/PreferencesContext'

/**
 * Measure a subtree so its container can animate between heights.
 *
 * The wizard's metadata step is roughly twice the height of its manuscript
 * step. `AnimatePresence` collapses the card to the outgoing step's height and
 * then snaps to the incoming one, so every advance showed a visible jump — the
 * single biggest reason the flow read as unpolished. Feeding this height into a
 * spring makes the card glide instead.
 *
 * Returns `'auto'` under reduced motion, and until the first measurement lands,
 * so the layout is never pinned to a stale number.
 */
export function useAutoHeight() {
  const { reducedMotion } = usePreferences()
  const [measured, setMeasured] = useState(null)
  const observerRef = useRef(null)

  const ref = useCallback((node) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    // jsdom-free environments and very old browsers have no ResizeObserver;
    // falling back to 'auto' loses the glide but never the layout.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMeasured(entry.contentRect.height)
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return [ref, reducedMotion || measured == null ? 'auto' : measured]
}
