import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, MessageSquareText, Library, UploadCloud,
  ShieldCheck, BarChart3, LogOut, LogIn, Menu, X, Moon, Sun,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../hooks/useTheme'
import { healthCheck } from '../api'
import { BrandMark, Logo } from './ui/Logo'
import { RoleBadge } from './ui/Badge'
import { Button } from './ui/Button'
import { cn } from '../lib/utils'

function useNavItems() {
  const { user, canScan, isAdmin } = useAuth()
  return [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: !!user },
    { to: '/chat', label: 'AI Chat', icon: MessageSquareText, show: true },
    { to: '/archive', label: 'Archive', icon: Library, show: !!user },
    { to: '/novelty', label: 'Novelty Check', icon: ShieldCheck, show: canScan },
    { to: '/upload', label: 'Upload Thesis', icon: UploadCloud, show: isAdmin },
    { to: '/admin', label: 'Analytics', icon: BarChart3, show: isAdmin },
  ].filter((i) => i.show)
}

function NavItem({ to, label, icon: Icon, onNavigate }) {
  return (
    <NavLink to={to} onClick={onNavigate} className="relative block">
      {({ isActive }) => (
        <div
          className={cn(
            'state-layer relative flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors duration-300',
            isActive
              ? 'text-white'
              : 'opacity-70 hover:opacity-100',
          )}
        >
          {isActive && (
            <motion.div
              layoutId="nav-pill"
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="absolute inset-0 rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/30"
            />
          )}
          <Icon size={18} className="relative z-10" />
          <span className="relative z-10">{label}</span>
        </div>
      )}
    </NavLink>
  )
}

function HealthDot() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: healthCheck,
    refetchInterval: 30000,
    retry: false,
  })
  const online = !isError && data?.status
  const healthy = online && data.status === 'ok'
  return (
    <div className="flex items-center gap-2 text-xs opacity-60">
      <span className="relative flex h-2 w-2">
        {healthy && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forest-400 opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            healthy ? 'bg-forest-500' : online ? 'bg-gold-400' : 'bg-flame-500',
          )}
        />
      </span>
      {healthy ? 'System online' : online ? 'Degraded' : 'Backend offline'}
    </div>
  )
}

function SidebarContent({ onNavigate }) {
  const { user, role, displayName, signOut } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()
  const items = useNavItems()

  const handleLogout = async () => {
    await signOut()
    onNavigate?.()
    navigate('/')
  }

  return (
    <div className="flex h-full flex-col p-5">
      <button onClick={() => { onNavigate?.(); navigate('/') }} className="mb-8 text-left">
        <BrandMark />
      </button>

      <nav className="flex-1 space-y-1.5">
        {items.map((item) => (
          <NavItem key={item.to} {...item} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="space-y-4 border-t border-forest-900/10 pt-5 dark:border-white/10">
        {user ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 font-display text-sm font-bold text-white">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{displayName}</div>
              <RoleBadge role={role} />
            </div>
            <Button variant="ghost" size="icon-sm" onClick={handleLogout} aria-label="Log out">
              <LogOut size={16} />
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={() => { onNavigate?.(); navigate('/login') }}>
            <LogIn size={16} /> Sign in
          </Button>
        )}

        <div className="flex items-center justify-between">
          <HealthDot />
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="relative flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="glass-strong fixed inset-y-3 left-3 z-40 hidden w-64 rounded-[1.75rem] lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <header className="glass-strong fixed inset-x-3 top-3 z-40 flex h-14 items-center justify-between rounded-3xl px-4 lg:hidden">
        <NavLink to="/" className="flex items-center gap-2">
          <Logo size={30} />
          <span className="font-display text-sm font-extrabold">ISU Thesis AI</span>
        </NavLink>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="state-layer flex h-9 w-9 items-center justify-center rounded-xl"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-50 bg-canvas-950/60 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="glass-strong fixed inset-y-3 left-3 z-50 w-72 rounded-[1.75rem] lg:hidden"
            >
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-xl opacity-60 hover:opacity-100"
              >
                <X size={18} />
              </button>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Content */}
      <main className="flex-1 px-4 pb-8 pt-20 lg:ml-[17.5rem] lg:pt-6 lg:pr-6">
        {children}
      </main>
    </div>
  )
}
