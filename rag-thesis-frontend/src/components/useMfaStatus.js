import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

/**
 * Shared two-factor status. The 'mfa-factors' query key is used app-wide, so
 * the dashboard nudge, the settings row, and the admin gate all read the same
 * cached snapshot.
 */
export function useMfaStatus(queryEnabled = true) {
  const { refreshMfa } = useAuth()
  const { data, refetch, isLoading, isError, error } = useQuery({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError) throw factorsError
      return factors
    },
    enabled: queryEnabled,
  })
  const enabled = !!data?.totp?.some((f) => f.status === 'verified')
  const handleChanged = async () => {
    await refetch()
    await refreshMfa()
  }
  return { enabled, isLoading, isError, error, handleChanged }
}
