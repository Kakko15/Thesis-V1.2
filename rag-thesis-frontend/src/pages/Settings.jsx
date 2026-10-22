import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Fingerprint, Info, MessageSquareText, Palette, ShieldCheck, UserRound,
} from 'lucide-react'
import { PageTransition, staggerContainer } from '../components/ui/Motion'
import { cn } from '../lib/utils'
import { ProfileSection } from './settings/ProfileSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { ChatSection } from './settings/ChatSection'
import { SecuritySection } from './settings/SecuritySection'
import { PrivacySection } from './settings/PrivacySection'
import { AboutSection } from './settings/AboutSection'

const SECTIONS = [
  { id: 'profile', label: 'Profile', description: 'Your photo, name, and how you appear across the library.', icon: UserRound, component: ProfileSection },
  { id: 'appearance', label: 'Appearance', description: 'Theme, colour, and motion for this device.', icon: Palette, component: AppearanceSection },
  { id: 'chat', label: 'Chat & AI', description: 'Defaults for new conversations, and the history IskAI keeps.', icon: MessageSquareText, component: ChatSection },
  { id: 'security', label: 'Security', description: 'Two-factor authentication, sign-in details, and devices.', icon: ShieldCheck, component: SecuritySection },
  { id: 'privacy', label: 'Data & privacy', description: 'What the library stores about you, and how to leave.', icon: Fingerprint, component: PrivacySection },
  { id: 'about', label: 'About', description: 'What you are using and who built it.', icon: Info, component: AboutSection },
]

const DEFAULT_SECTION = SECTIONS[0].id

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  // The active section is derived from the URL, so deep links like
  // /settings?section=security, back/forward navigation, and shared links all
  // stay in sync without any local state.
  const requested = searchParams.get('section')
  const active = SECTIONS.some((section) => section.id === requested) ? requested : DEFAULT_SECTION

  const select = (id) => {
    setSearchParams(id === DEFAULT_SECTION ? {} : { section: id }, { replace: true })
  }

  const current = SECTIONS.find((section) => section.id === active) || SECTIONS[0]
  const ActiveSection = current.component

  return (
    <PageTransition className="mx-auto max-w-6xl">
      <div className="mb-6 lg:mb-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your account, your interface, your data.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        {/* Section rail, as a Material 3 navigation drawer: a plain list with
            a tonal pill for the current section. The earlier rail was a card
            of its own with a gradient-filled active item and a description
            under every label, so the navigation outweighed the content it
            navigated. The descriptions now head the section itself. Below lg
            it scrolls sideways as a row of pills. */}
        <nav
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          role="tablist"
          aria-label="Settings sections"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const selected = active === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={selected}
                aria-controls="settings-panel"
                onClick={() => select(id)}
                className={cn(
                  'state-layer flex h-11 shrink-0 items-center gap-3 rounded-full px-4 text-left text-sm transition-colors duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  selected
                    ? 'bg-[var(--primary-container)] font-semibold text-[var(--primary-container-foreground)]'
                    : 'font-medium text-ink-muted hover:text-ink',
                )}
              >
                <Icon size={18} className="shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            )
          })}
        </nav>

        {/* Active section */}
        <div className="min-w-0 max-w-3xl" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${active}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            >
              <div className="mb-5">
                <h2 className="font-display text-2xl font-bold tracking-tight">{current.label}</h2>
                <p className="mt-1 text-sm text-ink-muted">{current.description}</p>
              </div>
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
