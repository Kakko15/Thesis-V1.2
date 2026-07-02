import { Suspense, lazy } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Spinner } from './components/ui/Spinner'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Archive = lazy(() => import('./pages/Archive'))
const Chat = lazy(() => import('./pages/Chat'))
const Upload = lazy(() => import('./pages/Upload'))
const Novelty = lazy(() => import('./pages/Novelty'))
const Admin = lazy(() => import('./pages/Admin'))
const NotFound = lazy(() => import('./pages/NotFound'))

function SuspenseFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner size={36} />
    </div>
  )
}

function ShellRoutes() {
  const location = useLocation()
  return (
    <AppShell>
      <Suspense fallback={<SuspenseFallback />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route
              path="/dashboard"
              element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
            />
            <Route
              path="/archive"
              element={<ProtectedRoute><Archive /></ProtectedRoute>}
            />
            <Route path="/chat" element={<Chat />} />
            <Route
              path="/novelty"
              element={<ProtectedRoute roles={['faculty', 'admin']}><Novelty /></ProtectedRoute>}
            />
            <Route
              path="/upload"
              element={<ProtectedRoute roles={['admin']}><Upload /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute roles={['admin']}><Admin /></ProtectedRoute>}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </AppShell>
  )
}

export default function App() {
  return (
    <Suspense fallback={<SuspenseFallback />}>
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
