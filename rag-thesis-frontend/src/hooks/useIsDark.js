import { useEffect, useState } from 'react'

/**
 * Observes the `.dark` class on <html>. Unlike useTheme (per-instance state),
 * this reflects the real DOM theme no matter which component toggled it —
 * required by the 3D hero scene, which lives outside the nav's state tree.
 */
export function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => setDark(el.classList.contains('dark')))
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}
