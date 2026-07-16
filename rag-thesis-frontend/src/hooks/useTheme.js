import { useCallback } from 'react'
import { usePreferences } from '../context/PreferencesContext'

export function useTheme() {
  const { theme, isDark, updatePreference } = usePreferences()

  const toggle = useCallback(() => {
    updatePreference('theme', isDark ? 'light' : 'dark')
  }, [isDark, updatePreference])

  return {
    theme,
    setTheme: (value) => updatePreference('theme', value),
    toggle,
    isDark,
  }
}
