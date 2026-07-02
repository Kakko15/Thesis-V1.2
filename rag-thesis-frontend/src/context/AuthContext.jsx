import { createContext, useState, useEffect, useContext, useCallback } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext({})

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', userId)
        .single()
      if (!error && data) {
        setProfile(data)
      } else {
        setProfile({ role: 'student', full_name: '', email: '' })
      }
    } catch {
      setProfile({ role: 'student', full_name: '', email: '' })
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) await fetchProfile(currentUser.id)
      else setProfile(null)
      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) await fetchProfile(currentUser.id)
      else setProfile(null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const role = profile?.role ?? null

  const value = {
    user,
    profile,
    role,
    loading,
    isAdmin: role === 'admin',
    isFaculty: role === 'faculty',
    isStudent: role === 'student',
    canScan: role === 'faculty' || role === 'admin',
    displayName:
      profile?.full_name ||
      user?.user_metadata?.full_name ||
      user?.email?.split('@')[0] ||
      'Guest',
    signOut: () => supabase.auth.signOut(),
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
