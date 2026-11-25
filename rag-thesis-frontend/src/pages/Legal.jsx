import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, FileCheck2, FileText, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Aurora } from '../components/ui/Aurora'
import { BrandMark } from '../components/ui/Logo'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/utils'
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_TABS,
  resolveLegalDocument,
} from './legal/legalContent'

const DOC_ICONS = {
  agreement: FileCheck2,
  terms: FileText,
  privacy: ShieldCheck,
}

export default function Legal({ defaultDoc }) {
  const { doc } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const active = resolveLegalDocument(doc || defaultDoc)
  const ActiveIcon = DOC_ICONS[active.key] || FileText

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [active.key])

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[var(--background)] text-[var(--foreground)]">
      <Aurora />
      <div aria-hidden="true" className="bg-grid mask-fade-b pointer-events-none absolute inset-0 opacity-35" />

      {/* Top navigation bar */}
      <header className="sticky top-0 z-30 border-b border-forest-900/10 bg-[var(--background)]/80 backdrop-blur-xl dark:border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="shrink-0" aria-label="ISU Thesis AI Library home">
              <BrandMark />
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Back to home</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(user ? '/chat' : '/login')}
            >
              {user ? 'Open IskAI' : 'Sign in'}
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Document switcher */}
        <nav
          aria-label="Legal documents"
          className="mb-8 inline-flex flex-wrap gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)]/90 p-1.5 shadow-xs backdrop-blur-xl"
        >
          {LEGAL_TABS.map((tab) => {
            const Icon = DOC_ICONS[tab.key] || FileText
            const isActive = active.key === tab.key
            return (
              <Link
                key={tab.key}
                to={tab.path}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all sm:text-sm',
                  isActive
                    ? 'bg-[var(--primary-container)] text-[var(--primary-container-foreground)] shadow-2xs'
                    : 'text-ink-muted hover:bg-[var(--accent)] hover:text-ink',
                )}
              >
                <Icon size={15} aria-hidden="true" />
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
          {/* Desktop table of contents */}
          <aside className="hidden lg:sticky lg:top-24 lg:block">
            <div className="surface-glass rounded-[1.5rem] p-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                On this page
              </div>
              <ul className="mt-3 space-y-1.5">
                {active.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-xl px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-[var(--accent)] hover:text-ink"
                    >
                      {section.heading}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Main legal article */}
          <article className="surface-glass rounded-[2rem] p-6 sm:p-10">
            <div className="border-b border-forest-900/10 pb-6 dark:border-white/10">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--primary-container)] px-3 py-1 text-xs font-semibold text-[var(--primary-container-foreground)]">
                <ActiveIcon size={14} aria-hidden="true" />
                ISU CCSICT Institutional Policy
              </div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                {active.title}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:text-base">
                {active.subtitle}
              </p>
              <p className="mt-3 text-xs font-medium text-ink-faint">
                Effective date: {LEGAL_EFFECTIVE_DATE} · College of Computing Studies, Information and Communication Technology, Isabela State University – Echague Campus
              </p>
            </div>

            {/* Plain-language summary banner */}
            <div className="mt-6 rounded-2xl border border-forest-500/20 bg-forest-500/[0.06] px-5 py-4 text-sm leading-relaxed text-ink">
              <span className="font-semibold text-forest-700 dark:text-forest-300">Summary: </span>
              {active.summary}
            </div>

            {/* Sections */}
            <div className="mt-8 space-y-8">
              {active.sections.map((section) => (
                <section key={section.id} id={section.id} className="scroll-mt-24">
                  <h2 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
                    {section.heading}
                  </h2>
                  <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted sm:text-[15px]">
                    {section.paragraphs.map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                  {section.bullets && (
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted sm:text-[15px]">
                      {section.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>

            {/* Cross-links footer */}
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-forest-900/10 pt-6 text-xs text-ink-faint dark:border-white/10">
              <span>© {new Date().getFullYear()} Isabela State University · CCSICT</span>
              <div className="flex flex-wrap items-center gap-4">
                {LEGAL_TABS.map((tab) => (
                  <Link
                    key={tab.key}
                    to={tab.path}
                    className={cn(
                      'font-semibold transition-colors hover:text-forest-700 dark:hover:text-gold-300',
                      active.key === tab.key ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {tab.label}
                  </Link>
                ))}
              </div>
            </div>
          </article>
        </div>
      </main>
    </div>
  )
}
