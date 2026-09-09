import { Toaster as SonnerToaster } from 'sonner'
import { Check, AlertCircle, AlertTriangle, Info, Loader2, X } from 'lucide-react'
import { usePreferences } from '../../context/PreferencesContext'

/**
 * Google Material 3 Toast System.
 * - Always expanded when 2+ toasts appear (no hidden/collapsed deck of cards)
 * - Material 3 tonal elevation and circular status badges
 * - Fully responsive on both desktop and mobile (with safe offsets around headers/navigation)
 * - Dismissible via swipe or close button
 */
export function Toaster() {
  const { isDark, reducedMotion } = usePreferences()

  return (
    <SonnerToaster
      position="top-right"
      theme={isDark ? 'dark' : 'light'}
      expand={true}
      visibleToasts={4}
      gap={10}
      closeButton
      duration={4000}
      offset={{ top: 20, right: 20, bottom: 24, left: 20 }}
      mobileOffset={{ top: 76, right: 16, bottom: 84, left: 16 }}
      icons={{
        success: (
          <span className="toast-icon-badge toast-icon-success">
            <Check size={12} strokeWidth={2.6} aria-hidden="true" />
          </span>
        ),
        error: (
          <span className="toast-icon-badge toast-icon-error">
            <AlertCircle size={13} strokeWidth={2.4} aria-hidden="true" />
          </span>
        ),
        warning: (
          <span className="toast-icon-badge toast-icon-warning">
            <AlertTriangle size={12} strokeWidth={2.4} aria-hidden="true" />
          </span>
        ),
        info: (
          <span className="toast-icon-badge toast-icon-info">
            <Info size={13} strokeWidth={2.4} aria-hidden="true" />
          </span>
        ),
        loading: (
          <span className="toast-icon-badge toast-icon-loading">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          </span>
        ),
        close: <X size={13} aria-hidden="true" />,
      }}
      toastOptions={{
        className: 'isu-google-toast',
        duration: reducedMotion ? 6000 : 4000,
      }}
    />
  )
}
