import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Upload, Search, BookOpen, Sparkles } from 'lucide-react'
import { useState, useEffect } from 'react'
import { healthCheck } from './api'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/Upload'
import SearchPage from './pages/Search'
import './App.css'

function App() {
  const location = useLocation()
  const [backendOnline, setBackendOnline] = useState(false)

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
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/upload', label: 'Upload', icon: Upload },
    { path: '/search', label: 'Search', icon: Search },
  ]

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
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
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <item.icon className="nav-icon" size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className={`status-dot ${backendOnline ? '' : 'offline'}`} />
            <span>{backendOnline ? 'Backend Connected' : 'Backend Offline'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/search" element={<SearchPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
