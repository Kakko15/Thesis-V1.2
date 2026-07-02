import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { LogIn, UserPlus, AlertCircle, CheckCircle } from 'lucide-react'

function Login() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [isSignUp, setIsSignUp] = useState(false)
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(false)

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (isSignUp) {
        // Sign up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })

        if (error) {
          setError(error.message)
        } else {
          // If auto-confirm is off, they might need to check email.
          // If auto-confirm is on, it will log them in automatically (handled by AuthContext)
          if (data.user && data.user.identities && data.user.identities.length === 0) {
             setError("This email is already registered. Please sign in instead.")
          } else {
             setSuccess('Account created successfully! If you are not redirected, you may need to check your email to verify.')
          }
        }
      } else {
        // Sign in
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          setError(error.message)
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="card" style={{ maxWidth: 400, width: '100%', padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="stat-icon blue" style={{ margin: '0 auto 1rem', width: 64, height: 64 }}>
            {isSignUp ? <UserPlus size={32} /> : <LogIn size={32} />}
          </div>
          <h2>{isSignUp ? 'Create an Account' : 'Welcome Back'}</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {isSignUp ? 'Sign up to access and save your chat history' : 'Sign in to access the Thesis Archive'}
          </p>
        </div>

        {error && (
          <div className="toast error" style={{ position: 'relative', transform: 'none', width: '100%', marginBottom: '1.5rem', opacity: 1, padding: '12px' }}>
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {success && (
          <div className="toast success" style={{ position: 'relative', transform: 'none', width: '100%', marginBottom: '1.5rem', opacity: 1, padding: '12px' }}>
            <CheckCircle size={18} />
            {success}
          </div>
        )}

        <form onSubmit={handleAuth}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? "Create a password (min 6 chars)" : "Enter your password"}
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: '2rem' }}
            disabled={loading}
          >
            {loading ? <span className="loading-spinner" /> : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}
            <button 
              type="button" 
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setSuccess(null); }}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 600, cursor: 'pointer', padding: '0 4px', fontSize: '0.9rem' }}
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
          
          <button 
            type="button" 
            onClick={() => navigate('/chat')}
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: '1rem' }}
          >
            Continue as Guest
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
