import { createContext, useState, useEffect, useContext, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { getFeaturePermissions } from '../api'

const AuthContext = createContext({})

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [features, setFeatures] = useState(null)
  // True when the account has a verified TOTP factor but this session is
  // still aal1 — i.e. the user must pass the 2FA challenge before the app.
  const [needsMfa, setNeedsMfa] = useState(false)

  const checkMfa = useCallback(async (currentUser) => {
    if (!currentUser) {
      setNeedsMfa(false)
      return false
    }
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error || !data) {
        setNeedsMfa(false)
        return false
      }
      const needed = data.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel
      setNeedsMfa(needed)
      return needed
    } catch {
      setNeedsMfa(false)
      return false
    }
  }, [])

  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name, email, department, status, avatar_url')
        .eq('id', userId)
        .single()
      if (!error && data) {
        setProfile(data)
      } else {
        setProfile({ role: 'student', full_name: '', email: '', department: 'CCSICT', status: 'approved' })
      }
    } catch {
      setProfile({ role: 'student', full_name: '', email: '', department: 'CCSICT', status: 'approved' })
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const currentUser = session?.user ?? null
      await checkMfa(currentUser)
      setUser(currentUser)
      if (currentUser) {
        await fetchProfile(currentUser.id)
        getFeaturePermissions().then(setFeatures).catch(() => {})
      }
      else setProfile(null)
      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      await checkMfa(currentUser)
      setUser(currentUser)
      if (currentUser) {
        await fetchProfile(currentUser.id)
        getFeaturePermissions().then(setFeatures).catch(() => {})
      }
      else setProfile(null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile, checkMfa])

  const [broadcastChannel, setBroadcastChannel] = useState(null)

  // Realtime subscription for feature permissions via pure Broadcast (bypasses RLS blocks)
  useEffect(() => {
    if (!user) return
    const channel = supabase.channel('global_feature_updates')
      .on(
        'broadcast',
        { event: 'features_updated' },
        () => {
          // Instantly fetch the newest permissions when any admin broadcasts an update
          getFeaturePermissions().then(setFeatures).catch(() => {})
        }
      )
      .subscribe()
      
    setBroadcastChannel(channel)
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const role = profile?.role ?? null
  const department = profile?.department ?? 'CCSICT'
  const status = profile?.status ?? 'approved'

  const value = {
    user,
    profile,
    role,
    department,
    status,
    loading,
    needsMfa,
    isPending: status === 'pending',
    isRejected: status === 'rejected',
    refreshMfa: () => checkMfa(user),
    refreshProfile: () => { if (user) fetchProfile(user.id) },
    isAdmin: role === 'admin' || role === 'superadmin',
    isSuperadmin: role === 'superadmin',
    isFaculty: role === 'faculty',
    isStudent: role === 'student',
    features,
    canChat: role === 'admin' || role === 'superadmin' || (features && features[role]?.chat),
    canArchive: role === 'admin' || role === 'superadmin' || (features && features[role]?.archive),
    canScan: role === 'admin' || role === 'superadmin' || (features && features[role]?.novelty),
    canUpload: role === 'admin' || role === 'superadmin' || (features && features[role]?.upload),
    displayName:
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      user?.email?.split('@')[0] ||
      'Guest',
    avatarUrl: profile?.avatar_url || null,
    signOut: () => supabase.auth.signOut(),
    broadcastFeatureUpdate: () => {
      broadcastChannel?.send({ type: 'broadcast', event: 'features_updated', payload: {} })
    },
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
