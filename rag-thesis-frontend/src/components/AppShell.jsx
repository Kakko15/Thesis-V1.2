import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3, Command, LayoutDashboard, Library, LogIn, LogOut, Menu,
  MessageSquareText, MoreHorizontal, Palette, Search, ShieldCheck, UploadCloud, X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { healthCheck } from '../api'
import { BrandMark, Logo } from './ui/Logo'
import { RoleBadge } from './ui/Badge'
import { Button } from './ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/Tooltip'
import { Sheet } from './ui/Sheet'
import { ProfileSettingsModal } from './ProfileSettingsModal'
import { AppearanceDialog } from './AppearanceDialog'
import { CommandPalette } from './CommandPalette'
import { cn } from '../lib/utils'

function useNavItems() {
  const { user, canChat, canArchive, canScan, canUpload, isAdmin } = useAuth()
  return [
    { to: '/dashboard', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard, show: !!user },
    { to: '/chat', label: 'Ask IskAI', shortLabel: 'IskAI', icon: MessageSquareText, show: !user || canChat !== false },
    { to: '/archive', label: 'Thesis library', shortLabel: 'Library', icon: Library, show: !!user && canArchive !== false },
    { to: '/novelty', label: 'Novelty review', shortLabel: 'Novelty', icon: ShieldCheck, show: !!user && canScan !== false },
    { to: '/upload', label: 'Ingest thesis', shortLabel: 'Upload', icon: UploadCloud, show: !!user && canUpload !== false },
    { to: '/admin', label: 'Operations', shortLabel: 'Admin', icon: BarChart3, show: isAdmin },
  ].filter((item) => item.show)
}

function HealthStatus({ compact = false }) {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: healthCheck,
    refetchInterval: 30_000,
    retry: false,
  })
  const online = !isError && Boolean(data?.status)
  const healthy = online && data.status === 'ok'
  const label = healthy ? 'Online' : online ? 'Degraded' : 'Offline'
  return (
    <div className="flex items-center gap-2 text-xs opacity-65" aria-label={`System ${label.toLowerCase()}`}>
      <span className={cn('h-2 w-2 rounded-full', healthy ? 'bg-emerald-500' : online ? 'bg-amber-400' : 'bg-red-500')} />
      {!compact && <span>{label}</span>}
    </div>
  )
}

function NavIcon({ item, compact = false, onNavigate }) {
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      aria-label={compact ? item.label : undefined}
      className={({ isActive }) => cn(
        'group relative flex items-center rounded-2xl font-medium transition-colors',
        compact ? 'h-12 w-12 justify-center' : 'gap-3 px-4 py-3 text-sm',
        isActive
          ? 'bg-[var(--primary-container)] text-[var(--primary-container-foreground)]'
          : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]',
      )}
    >
      <Icon size={19} aria-hidden="true" />
      {!compact && <span>{item.label}</span>}
    </NavLink>
  )
  if (!compact) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

function AccountBlock({ compact, onOpenProfile, onLogout, user, displayName, avatarUrl, role }) {
  if (!user) {
    return compact ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={() => onLogout('login')} aria-label="Sign in"><LogIn size={18} /></Button>
        </TooltipTrigger>
        <TooltipContent side="right">Sign in</TooltipContent>
      </Tooltip>
    ) : (
      <Button className="w-full" onClick={() => onLogout('login')}><LogIn size={16} /> Sign in</Button>
    )
  }

  return compact ? (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onOpenProfile}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-[var(--primary-container)] font-bold text-[var(--primary-container-foreground)]"
        aria-label="Open profile and security settings"
      >
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : displayName.slice(0, 1).toUpperCase()}
      </button>
      <Button variant="ghost" size="icon-sm" onClick={() => onLogout('logout')} aria-label="Log out"><LogOut size={15} /></Button>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onOpenProfile} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--primary-container)] font-bold text-[var(--primary-container-foreground)]">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{displayName}</span>
          <RoleBadge role={role} />
        </span>
      </button>
      <Button variant="ghost" size="icon-sm" onClick={() => onLogout('logout')} aria-label="Log out"><LogOut size={15} /></Button>
    </div>
  )
}

export function AppShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const { user, role, displayName, avatarUrl, signOut } = useAuth()
  const items = useNavItems()
  const navigate = useNavigate()
  const location = useLocation()
  const activeItem = items.find((item) => location.pathname.startsWith(item.to))
  const mobilePrimary = items.slice(0, 4)

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleAccountAction = async (action) => {
    if (action === 'login') {
      navigate('/login')
      return
    }
    await signOut()
    navigate('/')
  }

  const openAppearance = () => {
    setCommandOpen(false)
    setAppearanceOpen(true)
  }
  const openProfile = () => {
    setCommandOpen(false)
    setSettingsOpen(true)
  }

  return (
    <div className="relative min-h-screen">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <aside className="surface-glass fixed inset-y-3 left-3 z-40 hidden w-72 flex-col rounded-[2rem] p-5 xl:flex">
        <button type="button" onClick={() => navigate('/')} className="mb-7 text-left"><BrandMark /></button>
        <nav className="flex-1 space-y-1.5" aria-label="Primary navigation">
          {items.map((item) => <NavIcon key={item.to} item={item} />)}
        </nav>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="mb-4 flex items-center gap-3 rounded-2xl border border-[var(--border)] px-3 py-2.5 text-left text-xs opacity-70 transition-colors hover:bg-[var(--accent)] hover:opacity-100"
        >
          <Search size={15} /> Quick access <kbd className="ml-auto rounded-md bg-[var(--muted)] px-1.5 py-0.5">Ctrl K</kbd>
        </button>
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <AccountBlock user={user} role={role} displayName={displayName} avatarUrl={avatarUrl} onOpenProfile={openProfile} onLogout={handleAccountAction} />
          <div className="flex items-center justify-between">
            <HealthStatus />
            <Button variant="ghost" size="icon-sm" onClick={() => setAppearanceOpen(true)} aria-label="Appearance and energy"><Palette size={16} /></Button>
          </div>
        </div>
      </aside>

      <aside className="surface-glass fixed inset-y-3 left-3 z-40 hidden w-20 flex-col items-center rounded-[2rem] px-2 py-4 md:flex xl:hidden">
        <button type="button" onClick={() => navigate('/')} aria-label="ISU Thesis Library home" className="mb-5"><Logo size={42} glow /></button>
        <nav className="flex flex-1 flex-col items-center gap-1" aria-label="Primary navigation">
          {items.map((item) => <NavIcon key={item.to} item={item} compact />)}
        </nav>
        <div className="flex flex-col items-center gap-3 border-t border-[var(--border)] pt-4">
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => setCommandOpen(true)} aria-label="Quick access"><Command size={18} /></Button></TooltipTrigger>
            <TooltipContent side="right">Quick access (Ctrl K)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => setAppearanceOpen(true)} aria-label="Appearance and energy"><Palette size={18} /></Button></TooltipTrigger>
            <TooltipContent side="right">Appearance and energy</TooltipContent>
          </Tooltip>
          <HealthStatus compact />
          <AccountBlock compact user={user} role={role} displayName={displayName} avatarUrl={avatarUrl} onOpenProfile={openProfile} onLogout={handleAccountAction} />
        </div>
      </aside>

      <header className="surface-glass fixed inset-x-3 top-3 z-40 flex h-14 items-center justify-between rounded-3xl px-3 md:hidden">
        <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-2 text-left">
          <Logo size={30} />
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-extrabold">ISU Thesis Library</span>
            <span className="block truncate text-[0.65rem] opacity-55">{activeItem?.label || 'Research discovery'}</span>
          </span>
        </button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setCommandOpen(true)} aria-label="Quick access"><Search size={18} /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></Button>
        </div>
      </header>

      <nav
        className="surface-glass safe-area-bottom fixed inset-x-3 bottom-3 z-40 grid gap-1 rounded-[1.75rem] p-1.5 md:hidden"
        style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))` }}
        aria-label="Mobile navigation"
      >
        {mobilePrimary.map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(
              'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[0.64rem] font-semibold',
              isActive ? 'bg-[var(--primary-container)] text-[var(--primary-container-foreground)]' : 'opacity-65',
            )}>
              <Icon size={18} aria-hidden="true" /><span className="truncate">{item.shortLabel}</span>
            </NavLink>
          )
        })}
        <button type="button" onClick={() => setMobileOpen(true)} className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[0.64rem] font-semibold opacity-65">
          <MoreHorizontal size={18} aria-hidden="true" /><span>More</span>
        </button>
      </nav>

      <Sheet open={mobileOpen} onClose={() => setMobileOpen(false)} title="Navigation menu">
              <div className="mb-5 flex items-center justify-between">
                <BrandMark />
                <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></Button>
              </div>
              <nav className="space-y-1" aria-label="All navigation">
                {items.map((item) => <NavIcon key={item.to} item={item} onNavigate={() => setMobileOpen(false)} />)}
              </nav>
              <div className="mt-5 space-y-3 border-t border-[var(--border)] pt-5">
                <Button variant="secondary" className="w-full justify-start" onClick={() => { setMobileOpen(false); setCommandOpen(true) }}><Search size={16} /> Quick access</Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => { setMobileOpen(false); setAppearanceOpen(true) }}><Palette size={16} /> Appearance and energy</Button>
                <AccountBlock user={user} role={role} displayName={displayName} avatarUrl={avatarUrl} onOpenProfile={() => { setMobileOpen(false); openProfile() }} onLogout={handleAccountAction} />
              </div>
      </Sheet>

      <main id="main-content" className="px-4 pb-28 pt-20 md:ml-[6.5rem] md:px-6 md:pb-8 md:pt-6 xl:ml-[19rem] xl:pr-6">
        {children}
      </main>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} items={items} onOpenAppearance={openAppearance} onOpenProfile={user ? openProfile : null} />
      <AppearanceDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <ProfileSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
