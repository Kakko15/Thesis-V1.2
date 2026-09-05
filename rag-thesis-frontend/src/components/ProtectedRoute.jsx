import { Navigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { RouteSkeleton } from './ui/PageSkeleton'
import { AlertTriangle, XCircle } from 'lucide-react'

/**
 * Role-aware route guard.
 *   <ProtectedRoute>...</ProtectedRoute>                    — any signed-in user
 *   <ProtectedRoute roles={['admin']}>...</ProtectedRoute>  — admins only
 *   <ProtectedRoute roles={['faculty','admin']}>...         — faculty + admins
 */
export function ProtectedRoute({ children, roles, isAllowed, allowGuest = false }) {
  const { user, role, loading, needsMfa, profileError, isPending, isRejected, signOut } = useAuth()

  // Session check resolves quickly, but never show a bare spinner — render the
  // route-shaped skeleton so the loading state already looks like the page.
  if (loading) {
    return <RouteSkeleton />
  }

  if (!user) {
    if (allowGuest) return children
    return <Navigate to="/login" replace />
  }
  // 2FA-enrolled accounts must complete the TOTP challenge (aal2) first —
  // /login detects needsMfa and presents the challenge step.
  if (needsMfa) return <Navigate to="/login" replace />

  if (profileError) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="glass mb-4 flex h-16 w-16 items-center justify-center rounded-3xl">
          <AlertTriangle size={28} className="text-gold-500" />
        </div>
        <h2 className="font-display text-2xl font-bold">Profile temporarily unavailable</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">
          Access is paused because your authoritative role and department could not be verified.
          Please reload or try again shortly.
        </p>
        <button onClick={() => window.location.reload()} className="mt-6 text-sm font-semibold text-forest-700 hover:text-forest-500">
          Reload
        </button>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="glass mb-4 flex h-16 w-16 items-center justify-center rounded-3xl">
          <AlertTriangle size={28} className="text-gold-500" />
        </div>
        <h2 className="font-display text-2xl font-bold">Pending Approval</h2>
        {/* The institutional-domain hold was removed by
            20260828_allow_any_email_signup.sql: student sign-ups are approved on
            creation, so the domain half of this copy described a rule the
            database no longer applies. An administrator can still place any
            account under review, which is the other way to land here. */}
        <p className="mt-2 max-w-sm text-sm text-ink-muted">
          Your account request has been received. An administrator will review it before
          access is granted. Faculty accounts always need approval, and an administrator
          can place any account under review.
        </p>
        <button onClick={signOut} className="mt-6 text-sm font-semibold text-forest-700 hover:text-forest-500">
          Sign out
        </button>
      </div>
    )
  }

  if (isRejected) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="glass mb-4 flex h-16 w-16 items-center justify-center rounded-3xl">
          <XCircle size={28} className="text-flame-500" />
        </div>
        <h2 className="font-display text-2xl font-bold">Application Rejected</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">
          Your application for the {role} role was rejected by an administrator. Please contact your department if you believe this was a mistake.
        </p>
        <button onClick={signOut} className="mt-6 text-sm font-semibold text-forest-700 hover:text-forest-500">
          Sign out
        </button>
      </div>
    )
  }

  if (roles && !roles.includes(role)) return <Navigate to="/dashboard" replace />
  if (isAllowed === false) return <Navigate to="/dashboard" replace />

  return children
}
