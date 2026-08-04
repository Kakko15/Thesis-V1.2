import { useCallback, useSyncExternalStore } from 'react'

/**
 * Subscribe to a CSS media query.
 *
 * useSyncExternalStore rather than useState + useEffect: a media query is
 * external state, so the store pattern reads the current value during render
 * instead of settling on it after a second pass. That also removes the
 * resync-on-query-change problem, where a component that swaps its query string
 * would otherwise keep the previous match until the next change event fired.
 *
 * Returns false during server rendering, where no media query can be evaluated.
 */
export function useMediaQuery(query) {
  const subscribe = useCallback((onStoreChange) => {
    const media = window.matchMedia(query)
    media.addEventListener('change', onStoreChange)
    return () => media.removeEventListener('change', onStoreChange)
  }, [query])

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
