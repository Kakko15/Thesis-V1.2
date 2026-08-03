import { Navigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui/Spinner'
import { AlertTriangle, XCircle } from 'lucide-react'

/**
 * Role-aware route guard.
 *   <ProtectedRoute>...</ProtectedRoute>                    — any signed-in user
 *   <ProtectedRoute roles={['admin']}>...</ProtectedRoute>  — admins only
 *   <ProtectedRoute roles={['faculty','admin']}>...         — faculty + admins
 */
export function ProtectedRoute({ children, roles, isAllowed, allowGuest = false }) {
  const { user, role, loading, needsMfa, profileError, isPending, isRejected, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size={36} />
      </div>
    )
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
        {/* Two different things land here now — a faculty request, or any address
            outside the institutional domain — so the copy no longer blames the role. */}
        <p className="mt-2 max-w-sm text-sm text-ink-muted">
          Your account request has been received. An administrator will review it before
          access is granted. Faculty requests and sign-ups from outside the ISU email
          domain both need approval.
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
