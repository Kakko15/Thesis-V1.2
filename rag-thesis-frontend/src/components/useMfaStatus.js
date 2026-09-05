import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

/**
 * Shared two-factor status. The 'mfa-factors' query key is used app-wide, so
 * the dashboard nudge, the settings row, and the admin gate all read the same
 * cached snapshot.
 */
export function useMfaStatus() {
  const { refreshMfa } = useAuth()
  const { data, refetch, isLoading, isError } = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      // The error used to be discarded and `.data` read as null, so a transient
      // lookup failure was indistinguishable from "2FA is off" — and every
      // surface urged the reader to enable protection they already had.
      const { data: factors, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      return factors
    },
  })
  const enabled = !!data?.totp?.some((f) => f.status === 'verified')
  const handleChanged = async () => {
    await refetch()
    await refreshMfa()
  }
  return { enabled, isLoading, isError, handleChanged }
}
