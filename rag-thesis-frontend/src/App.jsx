import { Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Upload, Search, BookOpen, LogOut, Home, FileSearch } from 'lucide-react'
import { useState, useEffect } from 'react'
import { healthCheck } from './api'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/Upload'
import ChatPage from './pages/Chat'
import DuplicationCheck from './pages/DuplicationCheck'
import Login from './pages/Login'
import Landing from './pages/Landing'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import './App.css'

function AppLayout() {
  const [backendOnline, setBackendOnline] = useState(false)
  const { user, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await healthCheck()
        setBackendOnline(true)
      } catch {
        setBackendOnline(false)
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { path: '/upload', label: 'Upload', icon: Upload, show: isAdmin },
    { path: '/chat', label: 'Chat', icon: Search, show: true },
    { path: '/duplication', label: 'Duplication Check', icon: FileSearch, show: isAdmin },
  ]

  const handleLogout = async () => {
    await signOut()
    navigate('/')
  }

  const isLandingOrLogin = location.pathname === '/' || location.pathname === '/login'

  return (
    <div className="app-layout">
      {/* Sidebar - Only show if not on landing/login, or if user is logged in but on search */}
      {!isLandingOrLogin && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
              <div className="logo-icon">
                <BookOpen size={22} color="#fff" />
              </div>
              <div>
                <h1>Thesis Archive</h1>
                <div className="logo-subtitle">RAG-Powered</div>
              </div>
            </div>
          </div>

          <nav className="sidebar-nav">
            {!user && (
              <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
                <Home className="nav-icon" size={20} />
                <span>Home</span>
              </NavLink>
            )}
            
            {navItems.filter(item => item.show).map(item => {
              // Hide dashboard link for guests
              if (item.path === '/dashboard' && !user) return null;
              
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <item.icon className="nav-icon" size={20} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>

          <div className="sidebar-footer" style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            {user ? (
              <button 
                className="btn btn-secondary" 
                onClick={handleLogout}
                style={{ width: '100%', justifyContent: 'flex-start', border: 'none', background: 'transparent' }}
              >
                <LogOut size={18} style={{ marginRight: 8 }} />
                Log Out
              </button>
            ) : (
              <button 
                className="btn btn-primary" 
                onClick={() => navigate('/login')}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Sign In / Sign Up
              </button>
            )}
            
            <div className="sidebar-status" style={{ marginTop: 16 }}>
              <span className={`status-dot ${backendOnline ? '' : 'offline'}`} />
              <span>{backendOnline ? 'Backend Connected' : 'Backend Offline'}</span>
            </div>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <main className="main-content" style={{ padding: isLandingOrLogin ? 0 : '2rem', height: isLandingOrLogin ? '100vh' : 'auto' }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/upload" 
            element={
              <ProtectedRoute requireAdmin={true}>
                <UploadPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/duplication" 
            element={
              <ProtectedRoute requireAdmin={true}>
                <DuplicationCheck />
              </ProtectedRoute>
            } 
          />
          {/* Chat is public, but components inside handle guest vs logged in */}
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  )
}

export default App
