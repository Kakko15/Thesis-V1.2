import { useNavigate } from 'react-router-dom'
import { BookOpen, Search, LogIn, UserPlus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useEffect } from 'react'

function Landing() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  // If already logged in, skip the landing page and go straight to dashboard
  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard')
    }
  }, [user, loading, navigate])

  if (loading || user) return null

  return (
    <div className="page" style={{ 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      background: 'radial-gradient(circle at top right, rgba(99, 102, 241, 0.15), transparent 40%), radial-gradient(circle at bottom left, rgba(139, 92, 246, 0.1), transparent 40%)'
    }}>
      <div className="card" style={{ maxWidth: 800, width: '100%', padding: '4rem 2rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
        
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <div className="logo-icon" style={{ width: 80, height: 80, borderRadius: 20 }}>
            <BookOpen size={40} color="#fff" />
          </div>
        </div>

        <h1 style={{ fontSize: '3rem', marginBottom: '1rem', background: 'linear-gradient(to right, #fff, #a5b4fc)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
          Thesis AI Library
        </h1>
        
        <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto 3rem', lineHeight: 1.6 }}>
          A centralized, AI-powered archive using Retrieval-Augmented Generation. 
          Upload thesis papers, search intelligently, and let the AI instantly synthesize answers directly from the source material.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button 
            onClick={() => navigate('/login')} 
            className="btn btn-primary btn-lg"
            style={{ padding: '0 2rem' }}
          >
            <LogIn size={20} style={{ marginRight: 8 }} />
            Sign In
          </button>
          
          <button 
            onClick={() => navigate('/login')} 
            className="btn btn-primary btn-lg"
            style={{ padding: '0 2rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <UserPlus size={20} style={{ marginRight: 8 }} />
            Create Account
          </button>
          
          <button 
            onClick={() => navigate('/chat')} 
            className="btn btn-secondary btn-lg"
            style={{ padding: '0 2rem' }}
          >
            <Search size={20} style={{ marginRight: 8 }} />
            Continue as Guest
          </button>
        </div>

        <div style={{ marginTop: '4rem', display: 'flex', justifyContent: 'center', gap: '3rem', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '3rem' }}>
           <div style={{ textAlign: 'center', maxWidth: 200 }}>
             <div style={{ background: 'var(--primary-transparent)', width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <Search size={24} color="var(--primary)" />
             </div>
             <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Intelligent Search</h3>
             <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>Find exactly what you need without reading hundreds of pages.</p>
           </div>
           
           <div style={{ textAlign: 'center', maxWidth: 200 }}>
             <div style={{ background: 'var(--accent-transparent)', width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <BookOpen size={24} color="var(--accent)" />
             </div>
             <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Full Citations</h3>
             <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>Every AI answer is backed by exact sources from the uploaded papers.</p>
           </div>
        </div>

      </div>
    </div>
  )
}

export default Landing
