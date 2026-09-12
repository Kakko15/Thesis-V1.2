import { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
  // How many times the API has refused this session for want of aal2. The
  // server is the only party that knows whether this deployment enforces it,
  // so its refusal — not a guess from the role — is what raises the prompt.
  // A count rather than a flag, so a prompt the reader dismissed can be
  // raised again by the next refusal instead of staying silent for good.
  const [privilegedMfaRefusals, setPrivilegedMfaRefusals] = useState(0)

  const queryClient = useQueryClient()
  // Which account the cached data below currently belongs to. `undefined` means
  // "not yet resolved", which is why it is distinct from `null` (signed out).
  const identityRef = useRef(
    initialE2EFixture ? (initialE2EFixture.user?.id ?? null) : undefined,
  )

  /**
   * Drop every cached response before a different account is published.
   *
   * The QueryClient is created in src/main.jsx ABOVE this provider, so its
   * cache is not tied to a session and nothing here used to clear it. The
   * private keys are unscoped — ['sessions'], ['scan-history'], ['users'],
   * ['papers'], ['analytics-overview'], ['operations-*'] — and the defaults are
   * staleTime 30s with gcTime 30min. Signing out and signing in as someone else
   * in the same tab is a client-side navigation (AppShell calls navigate('/'),
   * IdleSessionGuard calls navigate(loginPath), neither reloads the document),
   * so the second reader saw the first reader's saved conversations, novelty
   * reports and department user list — served straight from cache with no
   * request, for the first 30 seconds, and as stale-while-revalidate for half
   * an hour. Reproduced by source review on 2026-09-12.
   *
   * `clear()` rather than per-key removal on purpose: it also cancels requests
   * already in flight, which would otherwise resolve into the new identity's
   * cache, and it cannot be defeated by a future query key that nobody
   * remembered to add to an allow-list.
   */
  const forgetPreviousAccount = useCallback((nextUserId) => {
    const previous = identityRef.current
    if (previous === nextUserId) return
    identityRef.current = nextUserId
    // First resolution of a fresh tab: there is no earlier account's data to
    // drop, and clearing here would cancel the landing page's own prefetches.
    if (previous === undefined) return
    queryClient.clear()
  }, [queryClient])

  const checkMfa = useCallback(async (currentUser) => {
    if (!currentUser) {
      setNeedsMfa(false)
      setMfaBypass(false)
      setPrivilegedMfaRefusals(0)
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
      if (data.currentLevel === 'aal2') setPrivilegedMfaRefusals(0)
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
    // Before anything observes the new identity, so no component can render the
    // previous account's cached rows under it.
    forgetPreviousAccount(currentUser?.id ?? null)
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
  }, [checkMfa, fetchProfile, loadFeatures, forgetPreviousAccount])

  const reloadSession = useCallback(async () => {
    if (isE2ETestMode) {
      const fixture = readE2EAuthFixture()
      forgetPreviousAccount(fixture?.user?.id ?? null)
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
  }, [syncSession, forgetPreviousAccount])

  useEffect(() => {
    if (isE2ETestMode) return undefined

    let active = true

    supabase.auth.getSession()
      .then(({ data }) => active && syncSession(data.session))
      .catch(() => active && setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // `getSession()` above already syncs the initial state, and supabase-js
      // emits INITIAL_SESSION for that same state — so every page load ran the
      // profile read and the feature fetch twice before settling.
      if (event === 'INITIAL_SESSION') return
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

  // The API refuses every privileged endpoint of an aal1 session at once. Note
  // what this deliberately does NOT do: it leaves `mfaBypass` alone. Clearing
  // it re-raises `needsMfa`, which sends ProtectedRoute to /login — where the
  // emailed code is offered again, produces another aal1 session, and walks
  // the reader straight back into the same refusal. The second factor is
  // collected in place instead, by PrivilegedMfaGate, so the reader keeps the
  // page they were on and the loop cannot form.
  useEffect(
    () => onPrivilegedMfaRequired(() => setPrivilegedMfaRefusals((count) => count + 1)),
    [],
  )

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
    privilegedMfaRequired: privilegedMfaRefusals > 0,
    privilegedMfaRefusals,
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
        forgetPreviousAccount(null)
        setUser(null)
        setProfile(null)
        setFeatures(null)
        return
      }
      // Dropped here as well as in syncSession: onAuthStateChange is what
      // normally carries the sign-out through, and clearing before the network
      // round trip shortens the window in which a screen still mounted over the
      // old identity keeps showing it.
      forgetPreviousAccount(null)
      await supabase.auth.signOut()
      // Again once the token is actually dead. A query observer still mounted
      // during the round trip above refetches as soon as its data is removed,
      // and that refetch still carried the old access token, so it would land
      // back in the cache after the first clear. The sign-in of the next
      // account clears again and is what ultimately closes the hole, but there
      // is no reason to leave the data sitting there until then.
      queryClient.clear()
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
