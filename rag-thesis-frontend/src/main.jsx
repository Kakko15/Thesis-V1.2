import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionGlobalConfig } from 'framer-motion'
import { Toaster } from 'sonner'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { PreferenceMotion, PreferencesProvider } from './context/PreferencesContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TooltipProvider } from './components/ui/Tooltip'
import { isE2ETestMode } from './testing/e2eSession'
import { normalizeDepartments } from './lib/catalog'
import './index.css'

// Framer's reduced-motion setting deliberately keeps animating opacity, so
// staggered fade-ins still run during an automated pass and the accessibility
// scan can sample a half-faded element — text measured 1.24:1 that way, a ratio
// its own classes cannot produce. Jumping animations to their final frame makes
// that scan judge the settled UI.
//
// Opt-in per spec rather than for every e2e run: skipping animations wholesale
// also collapses AnimatePresence enter/exit, which closes the appearance dialog
// mid-flow and breaks the critical-flows suite. Only the accessibility matrix
// wants it. Gated on the build mode too, so production never reaches this line.
MotionGlobalConfig.skipAnimations = isE2ETestMode
  && window.localStorage.getItem('isu_e2e_skip_animations') === '1'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        const status = error?.response?.status
        // Authentication, authorization, validation, and readiness failures
        // require user/configuration action; repeating them only floods logs.
        if (status && (status < 500 || status === 503)) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
    },
  },
})

// Keep already-cached catalog data safe across development hot reloads and
// accept both the one-release legacy array and the versioned response shape.
queryClient.setQueryDefaults(['departments'], { select: normalizeDepartments })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <PreferenceMotion>
            <AuthProvider>
              <BrowserRouter>
                <TooltipProvider delayDuration={350}>
                  <App />
                  <Toaster
                    position="top-right"
                    richColors
                    toastOptions={{
                      className: 'isu-toast',
                    }}
                  />
                </TooltipProvider>
              </BrowserRouter>
            </AuthProvider>
          </PreferenceMotion>
        </PreferencesProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
