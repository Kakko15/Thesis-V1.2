import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Palette } from 'lucide-react'
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

/** Fixed navbar that glassifies once the page scrolls. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        scrolled ? 'px-3 pt-3 sm:px-6' : 'px-0 pt-0',
      )}
    >
      <div
        className={cn(
          'mx-auto flex h-16 max-w-6xl items-center justify-between px-5 transition-all duration-500',
          scrolled ? 'glass-strong rounded-3xl' : 'bg-transparent',
        )}
      >
        <Link to="/" className="flex items-center gap-3">
          <Logo size={38} glow />
          <div className="leading-tight">
            <div className="font-display text-sm font-extrabold tracking-tight sm:text-base">
              ISU Thesis <span className="text-gradient-gold">AI</span> Library
            </div>
            <div className="hidden text-[0.6rem] font-semibold uppercase tracking-[0.16em] opacity-55 sm:block">
              Isabela State University · CCSICT
            </div>
          </div>
        </Link>

        <nav aria-label="Landing sections" className="hidden items-center gap-1 md:flex">
          {ANCHORS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="rounded-xl px-3 py-1.5 text-sm font-semibold opacity-65 transition hover:bg-forest-900/8 hover:opacity-100 dark:hover:bg-white/8"
            >
              {a.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
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
            className="hidden sm:inline-flex"
            onClick={() => navigate('/chat')}
          >
            Try as guest
          </Button>
          <Magnetic strength={0.25}>
            {user ? (
              <Button variant="gold" size="sm" onClick={() => navigate('/dashboard')}>
                Open dashboard <ArrowRight size={14} />
              </Button>
            ) : (
              <Button variant="gold" size="sm" onClick={() => navigate('/login')}>
                Sign in <ArrowRight size={14} />
              </Button>
            )}
          </Magnetic>
        </div>
      </div>
      <AppearanceDialog open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </motion.header>
  )
}
