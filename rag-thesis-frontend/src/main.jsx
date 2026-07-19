import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { PreferenceMotion, PreferencesProvider } from './context/PreferencesContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TooltipProvider } from './components/ui/Tooltip'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
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
