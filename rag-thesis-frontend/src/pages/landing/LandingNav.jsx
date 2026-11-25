import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, Menu, Palette, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { AppearanceDialog } from '../../components/AppearanceDialog'
import { Logo } from '../../components/ui/Logo'
import { Button } from '../../components/ui/Button'
import { Magnetic } from '../../components/ui/Motion'
import { cn } from '../../lib/utils'

const ANCHORS = [
  { label: 'Pipeline', href: '#pipeline' },
  { label: 'Demo', href: '#demo' },
  { label: 'Features', href: '#features' },
  { label: 'Tracks', href: '#tracks' },
]

const MOBILE_MENU_ID = 'landing-mobile-menu'

/** Fixed navbar that glassifies once the page scrolls. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const openGuestChat = () => {
    setMenuOpen(false)
    navigate('/chat')
  }

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        scrolled || menuOpen ? 'px-3 pt-3 sm:px-6' : 'px-0 pt-0',
      )}
    >
      <div
        className={cn(
          'mx-auto max-w-6xl transition-all duration-500',
          scrolled || menuOpen ? 'glass-strong rounded-3xl' : 'bg-transparent',
        )}
      >
        <div className="flex h-16 items-center justify-between gap-3 px-5">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Logo size={38} glow />
            <div className="min-w-0 leading-tight">
              {/* Wraps rather than truncating: at 390px an ellipsis cut the name to "ISU Thesis AI …". */}
              <div className="font-display text-sm font-extrabold tracking-tight sm:text-base">
                ISU Thesis <span className="text-gradient-gold">AI</span> Library
              </div>
              <div className="hidden text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted sm:block">
                Isabela State University · CCSICT
              </div>
            </div>
          </Link>

          {/* Links appear at lg, not md: at 800px "Tracks" ran into the
              palette button (2026-11-26). Below lg they live in the menu. */}
          <nav aria-label="Landing sections" className="hidden items-center gap-1 lg:flex">
            {ANCHORS.map((a) => (
              <a
                key={a.href}
                href={a.href}
                className="whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-semibold text-ink-muted transition hover:bg-forest-900/8 hover:text-ink dark:hover:bg-white/8"
              >
                {a.label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAppearanceOpen(true)}
              aria-label="Appearance and energy settings"
            >
              <Palette size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden whitespace-nowrap md:inline-flex"
              onClick={openGuestChat}
            >
              Try as Guest Researcher
            </Button>
            <Magnetic strength={0.25}>
              {user ? (
                <Button variant="gold" size="sm" className="whitespace-nowrap" onClick={() => navigate('/dashboard')}>
                  Open dashboard <ArrowRight size={14} />
                </Button>
              ) : (
                <Button variant="gold" size="sm" className="whitespace-nowrap" onClick={() => navigate('/login')}>
                  Sign in <ArrowRight size={14} />
                </Button>
              )}
            </Magnetic>
            {/* At 390px the section links and guest entry used to vanish with no
                way to reach them (2026-11-26). */}
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls={MOBILE_MENU_ID}
            >
              {menuOpen ? <X size={16} /> : <Menu size={16} />}
            </Button>
          </div>
        </div>

        {menuOpen && (
          <nav id={MOBILE_MENU_ID} aria-label="Landing menu" className="border-t border-forest-900/10 px-3 pb-3 pt-2 dark:border-white/10 lg:hidden">
            <ul className="grid gap-1">
              {ANCHORS.map((a) => (
                <li key={a.href}>
                  <a
                    href={a.href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-muted transition hover:bg-forest-900/8 hover:text-ink dark:hover:bg-white/8"
                  >
                    {a.label}
                  </a>
                </li>
              ))}
              <li className="md:hidden">
                <button
                  type="button"
                  onClick={openGuestChat}
                  className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-forest-700 transition hover:bg-forest-900/8 dark:text-forest-300 dark:hover:bg-white/8"
                >
                  Try as Guest Researcher
                </button>
              </li>
            </ul>
          </nav>
        )}
      </div>
      <AppearanceDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </motion.header>
  )
}
