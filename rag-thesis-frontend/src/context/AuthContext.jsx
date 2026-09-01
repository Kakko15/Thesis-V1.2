import { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { getFeaturePermissions } from '../api'
import { avatarPublicUrl } from '../lib/avatar'
import { canUseFeature } from '../lib/permissions'
import { onPrivilegedMfaRequired } from '../lib/privilegedMfa.js'
import {
  clearE2EAuthFixture,
  isE2ETestMode,
  readE2EAuthFixture,
} from '../testing/e2eSession'

const AuthContext = createContext({})

function getDisplayName(profile, user) {
  return profile?.full_name
    || user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'Guest'
}

export const AuthProvider = ({ children }) => {
  const initialE2EFixture = isE2ETestMode ? readE2EAuthFixture() : null
  const [user, setUser] = useState(() => initialE2EFixture?.user ?? null)
  const [profile, setProfile] = useState(() => initialE2EFixture?.profile ?? null)
  const [loading, setLoading] = useState(() => !isE2ETestMode)
  const [features, setFeatures] = useState(() => initialE2EFixture?.features ?? null)
  const [profileError, setProfileError] = useState(false)
  const broadcastChannelRef = useRef(null)
  // True when the account has a verified TOTP factor but this session is
  // still aal1 — i.e. the user must pass the 2FA challenge before the app.
  const [needsMfa, setNeedsMfa] = useState(() => Boolean(initialE2EFixture?.needsMfa))
  // App-level pass for logins that proved a second step Supabase cannot
  // express as aal2 (an emailed code). Never persisted: a fresh page load of
  // an aal1 session re-raises the challenge.
  const [mfaBypass, setMfaBypass] = useState(false)
  // Set when the API itself has refused this session for want of aal2. The
  // server is the only party that knows whether this deployment enforces it,
  // so its refusal — not a guess from the role — is what raises the prompt.
  const [privilegedMfaRequired, setPrivilegedMfaRequired] = useState(false)

  const checkMfa = useCallback(async (currentUser) => {
    if (!currentUser) {
      setNeedsMfa(false)
      setMfaBypass(false)
      setPrivilegedMfaRequired(false)
      return false
    }
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error || !data) {
        setNeedsMfa(false)
        setMfaBypass(false)
        return false
      }
      const needed = data.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel
      setNeedsMfa(needed)
      // A genuine aal2 session retires any app-level pass.
      if (!needed) setMfaBypass(false)
      // Reaching aal2 is the only thing that answers the server's refusal.
      if (data.currentLevel === 'aal2') setPrivilegedMfaRequired(false)
      return needed
    } catch {
      setNeedsMfa(false)
      setMfaBypass(false)
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
        setProfileError(false)
      } else {
        setProfile(null)
        setProfileError(true)
      }
    } catch {
      setProfile(null)
      setProfileError(true)
    }
  }, [])

  const loadFeatures = useCallback(async () => {
    try {
      setFeatures(await getFeaturePermissions())
    } catch {
      // Leave features null; canUseFeature falls back to the server defaults.
      setFeatures(null)
    }
  }, [])

  const syncSession = useCallback(async (session) => {
    const currentUser = session?.user ?? null
    await checkMfa(currentUser)
    setUser(currentUser)
    if (currentUser) {
      // Permissions must resolve BEFORE loading clears. They were previously
      // fetched without awaiting, so the first render after sign-in saw
      // features === null and every can* flag was false — long enough for
      // ProtectedRoute to bounce a student or faculty member off /chat,
      // /archive, /novelty, or /upload to /dashboard on any hard refresh.
      await Promise.all([fetchProfile(currentUser.id), loadFeatures()])
    } else {
      setProfile(null)
      setProfileError(false)
      setFeatures(null)
    }
    setLoading(false)
  }, [checkMfa, fetchProfile, loadFeatures])

  const reloadSession = useCallback(async () => {
    if (isE2ETestMode) {
      const fixture = readE2EAuthFixture()
      setUser(fixture?.user ?? null)
      setProfile(fixture?.profile ?? null)
      setFeatures(fixture?.features ?? null)
      setNeedsMfa(Boolean(fixture?.needsMfa))
      setMfaBypass(false)
      setProfileError(false)
      setLoading(false)
      return
    }
    const { data: { session } } = await supabase.auth.getSession()
    await syncSession(session)
  }, [syncSession])

  useEffect(() => {
    if (isE2ETestMode) return undefined

    let active = true

    supabase.auth.getSession()
      .then(({ data }) => active && syncSession(data.session))
      .catch(() => active && setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void syncSession(session)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [syncSession])

  // Realtime subscription for feature permissions via pure Broadcast (bypasses RLS blocks)
  useEffect(() => {
    if (!user || isE2ETestMode) return undefined
    const channel = supabase.channel('global_feature_updates')
      .on(
        'broadcast',
        { event: 'features_updated' },
        () => {
          // Instantly fetch the newest permissions when any admin broadcasts an update
          void loadFeatures()
        }
      )
      .subscribe()

    broadcastChannelRef.current = channel
    return () => {
      broadcastChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [user, loadFeatures])

  const role = profile?.role ?? null
  const department = profile?.department ?? 'CCSICT'
  const status = profile?.status ?? (user ? 'unavailable' : 'approved')

  // The API refuses every privileged endpoint of an aal1 session at once. When
  // it does, retire the app-level pass an emailed code left behind: with a
  // verified factor on the account that re-raises the ordinary sign-in
  // challenge, and without one the shell prompts for enrollment. Either way
  // the reader stops facing a UI that silently cannot work.
  useEffect(() => onPrivilegedMfaRequired(() => {
    setPrivilegedMfaRequired(true)
    setMfaBypass(false)
  }), [])

  const value = {
    user,
    profile,
    role,
    department,
    status,
    loading,
    needsMfa: needsMfa && !mfaBypass,
    profileError,
    isPending: status === 'pending',
    isRejected: status === 'rejected',
    privilegedMfaRequired,
    refreshMfa: () => checkMfa(user),
    // Mark the second step as passed for this login when it was proven in a
    // way Supabase cannot express as aal2 (an emailed code).
    satisfyMfa: () => setMfaBypass(true),
    refreshProfile: () => { if (user) fetchProfile(user.id) },
    reloadSession,
    isAdmin: role === 'admin' || role === 'superadmin',
    isSuperadmin: role === 'superadmin',
    isFaculty: role === 'faculty',
    isStudent: role === 'student',
    features,
    canChat: canUseFeature(role, features, 'chat'),
    canArchive: canUseFeature(role, features, 'archive'),
    canScan: canUseFeature(role, features, 'novelty'),
    canUpload: canUseFeature(role, features, 'upload'),
    displayName: getDisplayName(profile, user),
    avatarUrl: avatarPublicUrl(profile?.avatar_url),
    signOut: async () => {
      if (isE2ETestMode) {
        clearE2EAuthFixture()
        setUser(null)
        setProfile(null)
        setFeatures(null)
        return
      }
      await supabase.auth.signOut()
    },
    broadcastFeatureUpdate: () => {
      broadcastChannelRef.current?.send({ type: 'broadcast', event: 'features_updated', payload: {} })
    },
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
