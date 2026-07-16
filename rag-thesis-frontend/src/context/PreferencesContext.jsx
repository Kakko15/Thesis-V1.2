import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { MotionConfig } from 'framer-motion'

const STORAGE_KEY = 'isu-thesis-preferences-v2'

const DEFAULTS = {
  theme: 'system',
  palette: 'isu',
  motion: 'system',
  effects: 'balanced',
}

const PreferencesContext = createContext(null)

function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULTS, ...stored }
  } catch {
    return DEFAULTS
  }
}

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

function systemPrefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const [systemReducedMotion, setSystemReducedMotion] = useState(systemPrefersReducedMotion)

  useEffect(() => {
    const color = window.matchMedia('(prefers-color-scheme: dark)')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onColor = (event) => setSystemDark(event.matches)
    const onMotion = (event) => setSystemReducedMotion(event.matches)
    color.addEventListener('change', onColor)
    motion.addEventListener('change', onMotion)
    return () => {
      color.removeEventListener('change', onColor)
      motion.removeEventListener('change', onMotion)
    }
  }, [])

  const resolvedTheme = preferences.theme === 'system'
    ? (systemDark ? 'dark' : 'light')
    : preferences.theme
  const reducedMotion = preferences.motion === 'reduced'
    || (preferences.motion === 'system' && systemReducedMotion)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.dataset.theme = resolvedTheme
    root.dataset.palette = preferences.palette
    root.dataset.motion = reducedMotion ? 'reduced' : 'full'
    root.dataset.effects = preferences.effects
    root.style.colorScheme = resolvedTheme
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences, reducedMotion, resolvedTheme])

  const updatePreference = useCallback((key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  const resetPreferences = useCallback(() => setPreferences(DEFAULTS), [])

  const value = useMemo(() => ({
    ...preferences,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    reducedMotion,
    updatePreference,
    resetPreferences,
  }), [preferences, reducedMotion, resolvedTheme, updatePreference, resetPreferences])

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences must be used within PreferencesProvider')
  return value
}

export function PreferenceMotion({ children }) {
  const { reducedMotion } = usePreferences()
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  )
}
