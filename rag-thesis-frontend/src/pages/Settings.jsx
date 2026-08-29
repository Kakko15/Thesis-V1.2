import { useRef } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Fingerprint, Info, MessageSquareText, Palette, ShieldCheck, UserRound,
} from 'lucide-react'
import { GlassCard } from '../components/ui/GlassCard'
import { PageTransition, staggerContainer } from '../components/ui/Motion'
import { cn } from '../lib/utils'
import { ProfileSection } from './settings/ProfileSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { ChatSection } from './settings/ChatSection'
import { SecuritySection } from './settings/SecuritySection'
import { PrivacySection } from './settings/PrivacySection'
import { AboutSection } from './settings/AboutSection'

const SECTIONS = [
  { id: 'profile', label: 'Profile', description: 'Avatar, name, and identity', icon: UserRound, component: ProfileSection },
  { id: 'appearance', label: 'Appearance', description: 'Theme, palette, and motion', icon: Palette, component: AppearanceSection },
  { id: 'chat', label: 'Chat & AI', description: 'IskAI defaults and history', icon: MessageSquareText, component: ChatSection },
  { id: 'security', label: 'Security', description: '2FA, email, password, sessions', icon: ShieldCheck, component: SecuritySection },
  { id: 'privacy', label: 'Data & privacy', description: 'How your data is handled', icon: Fingerprint, component: PrivacySection },
  { id: 'about', label: 'About', description: 'Version and system info', icon: Info, component: AboutSection },
]

const DEFAULT_SECTION = SECTIONS[0].id

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabRefs = useRef([])
  // The active section is derived from the URL, so deep links like
  // /settings?section=security, back/forward navigation, and shared links all
  // stay in sync without any local state.
  const requested = searchParams.get('section')
  const active = SECTIONS.some((section) => section.id === requested) ? requested : DEFAULT_SECTION

  const select = (id) => {
    setSearchParams(id === DEFAULT_SECTION ? {} : { section: id }, { replace: true })
  }

  const handleTabKeyDown = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? SECTIONS.length - 1
        : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length
    select(SECTIONS[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }

  const ActiveSection = SECTIONS.find((section) => section.id === active)?.component || ProfileSection

  return (
    <PageTransition className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your account, your interface, your data — all in one place.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[16rem_1fr]">
        {/* Section rail */}
        <GlassCard className="flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible" role="tablist" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, description, icon: Icon }, index) => {
            const selected = active === id
            return (
              <button
                key={id}
                id={`settings-tab-${id}`}
                ref={(element) => { tabRefs.current[index] = element }}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`settings-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={cn(
                  'group relative flex min-w-44 items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-all duration-200 lg:min-w-0',
                  selected
                    ? 'bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-lg shadow-forest-900/25'
                    : 'text-ink-muted hover:bg-forest-900/6 hover:text-ink dark:hover:bg-white/6',
                )}
              >
                <Icon size={17} className={cn('shrink-0', selected ? 'text-gold-300' : 'opacity-60')} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{label}</span>
                  <span className={cn('block truncate text-[11px]', selected ? 'text-white/70' : 'text-ink-faint')}>
                    {description}
                  </span>
                </span>
              </button>
            )
          })}
        </GlassCard>

        {/* Active section */}
        <div
          id={`settings-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${active}`}
          tabIndex={0}
          className="min-w-0"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            >
              <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-5">
                <ActiveSection />
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  )
}
