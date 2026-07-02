import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui/Spinner'

/**
 * Role-aware route guard.
 *   <ProtectedRoute>...</ProtectedRoute>                    — any signed-in user
 *   <ProtectedRoute roles={['admin']}>...</ProtectedRoute>  — admins only
 *   <ProtectedRoute roles={['faculty','admin']}>...         — faculty + admins
 */
export function ProtectedRoute({ children, roles }) {
  const { user, role, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size={36} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(role)) return <Navigate to="/dashboard" replace />

  return children
}
