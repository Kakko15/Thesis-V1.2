import { Suspense, lazy } from 'react'
import { Routes, Route, useLocation } from 'react-router'
import { AppShell } from './components/AppShell'
import { IdleSessionGuard } from './components/IdleSessionGuard'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RouteSkeleton } from './components/ui/PageSkeleton'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Archive = lazy(() => import('./pages/Archive'))
const Chat = lazy(() => import('./pages/Chat'))
const Upload = lazy(() => import('./pages/Upload'))
const Novelty = lazy(() => import('./pages/Novelty'))
const Admin = lazy(() => import('./pages/Admin'))
const Settings = lazy(() => import('./pages/Settings'))
const NotFound = lazy(() => import('./pages/NotFound'))

// Each route gets its OWN Suspense boundary so a chunk load only ever shows
// the entering page's skeleton — never the whole shell. AnimatePresence used
// to wrap the keyed Routes here, but re-rendering the exiting tree made its
// Suspense boundary collapse to the fallback for a frame on every navigation
// (the skeleton flash on tab switches). Pages still animate in on mount via
// their own PageTransition; only the exit animation was dropped, and instant
// tab swaps are the better trade.
function RouteSuspense({ children }) {
  // RouteSkeleton shapes itself after the page being loaded.
  return <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>
}

import { useAuth } from './context/AuthContext'

function ShellRoutes() {
  const location = useLocation()
  const { canChat, canArchive, canScan, canUpload } = useAuth()
  return (
    <AppShell>
      <Routes location={location} key={location.pathname}>
        <Route
          path="/dashboard"
          element={<RouteSuspense><ProtectedRoute><Dashboard /></ProtectedRoute></RouteSuspense>}
        />
        <Route
          path="/archive"
          element={<RouteSuspense><ProtectedRoute isAllowed={canArchive}><Archive /></ProtectedRoute></RouteSuspense>}
        />
        <Route path="/chat" element={<RouteSuspense><ProtectedRoute isAllowed={canChat} allowGuest={true}><Chat /></ProtectedRoute></RouteSuspense>} />
        <Route
          path="/novelty"
          element={<RouteSuspense><ProtectedRoute isAllowed={canScan}><Novelty /></ProtectedRoute></RouteSuspense>}
        />
        <Route
          path="/upload"
          element={<RouteSuspense><ProtectedRoute isAllowed={canUpload}><Upload /></ProtectedRoute></RouteSuspense>}
        />
        <Route
          path="/admin"
          element={<RouteSuspense><ProtectedRoute roles={['admin', 'superadmin']}><Admin /></ProtectedRoute></RouteSuspense>}
        />
        <Route
          path="/settings"
          element={<RouteSuspense><ProtectedRoute><Settings /></ProtectedRoute></RouteSuspense>}
        />
        <Route path="*" element={<RouteSuspense><NotFound /></RouteSuspense>} />
      </Routes>
    </AppShell>
  )
}

// Landing/Login are full-bleed pages without the shell — a dashboard-shaped
// skeleton would look wrong there, so fall back to a blank themed screen
// instead of a spinner flash.
function BootFallback() {
  return <div className="min-h-screen bg-[var(--background)]" />
}

export default function App() {
  return (
    <Suspense fallback={<BootFallback />}>
      {/* Tiered idle logout — active only while a session exists. */}
      <IdleSessionGuard />
      <Routes>
        {/* Full-bleed surfaces (no shell) */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        {/* Everything else lives inside the app shell */}
        <Route path="*" element={<ShellRoutes />} />
      </Routes>
    </Suspense>
  )
}
