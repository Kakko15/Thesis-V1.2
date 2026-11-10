import { useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  BookMarked, GitBranch, CalendarRange, Layers, MessageSquareText,
  ShieldCheck, UploadCloud, ArrowRight, Library, Sparkles, Fingerprint,
  AlertTriangle, History, Search, X,
} from 'lucide-react'
import { getSessions, listPapers } from '../api'
import { useAuth } from '../context/AuthContext'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton } from '../components/ui/Skeleton'
import { PageSkeleton } from '../components/ui/PageSkeleton'
import { Badge } from '../components/ui/Badge'
import { PageTransition, AnimatedCounter, staggerContainer, staggerItem } from '../components/ui/Motion'
import { Button } from '../components/ui/Button'
import { MfaEnrollDialog } from '../components/MfaEnrollDialog'
import { useMfaStatus } from '../components/useMfaStatus'
import { formatDate } from '../lib/utils'
import { slotKeys } from '../lib/keys'
import {
  STUDENT_STARTER_PROMPTS,
  buildPaperChatPrompt,
  computeDashboardStats,
  formatRoleSubtitle,
  groupPapersByTrack,
  mfaNudgeStorageKey,
} from './dashboard/dashboardState'
import {
  buildComparisonPrompt,
  getReadingListSnapshot,
  parseSavedPaperIds,
  subscribeReadingList,
} from './archive/researchTools'

const STAT_SKELETONS = slotKeys(4, 'dashboard-stat')

function StatTile({ icon: Icon, label, value, suffix = '' }) {
  return (
    <motion.div variants={staggerItem}>
      <GlassCard className="relative overflow-hidden p-6">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gold-400/10 blur-2xl" />
        <Icon size={20} className="mb-3 text-gold-400" aria-hidden="true" />
        <div className="font-display text-3xl font-extrabold tabular-nums">
          <AnimatedCounter value={value} suffix={suffix} />
        </div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      </GlassCard>
    </motion.div>
  )
}

function QuickAction({ icon: Icon, title, text, to, tone = 'forest' }) {
  return (
    <GlassCard
      hover
      className="group relative p-6 transition-all duration-200 focus-within:ring-2 focus-within:ring-gold-400 active:scale-[0.98]"
    >
      <div className="flex items-start justify-between">
        <div
          className={
            tone === 'gold'
              ? 'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/25'
              : 'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25'
          }
        >
          <Icon size={20} className={tone === 'gold' ? 'text-forest-950' : 'text-gold-300'} aria-hidden="true" />
        </div>
        <ArrowRight
          size={17}
          aria-hidden="true"
          className="opacity-30 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-80"
        />
      </div>
      <h2 className="font-display mt-4 text-base font-bold">
        <Link to={to} className="after:absolute after:inset-0 focus-visible:outline-none">
          {title}
        </Link>
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{text}</p>
    </GlassCard>
  )
}

// 2FA management lives in Settings → Security. Admins need 2FA for Operations,
// while non-admin users can dismiss the reminder if they prefer not to enroll now.
function SecurityNudge() {
  const { user, isAdmin } = useAuth()
  const { enabled, isLoading: checking, isError, handleChanged } = useMfaStatus()
  const [open, setOpen] = useState(false)
  const storageKey = mfaNudgeStorageKey(user?.id)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !isAdmin && window.localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })

  if (checking || isError || enabled || (!isAdmin && dismissed)) return null

  const dismissNudge = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      // Ignore storage quota errors in private browsing.
    }
  }

  return (
    <GlassCard className="flex flex-wrap items-center gap-3 border border-gold-400/25 p-4 text-sm">
      <Fingerprint size={17} className="shrink-0 text-gold-500" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-bold">Secure your account with two-factor authentication</div>
        <div className="mt-0.5 text-xs text-ink-muted">
          {isAdmin
            ? 'Operations and administration data require a verified 2FA session.'
            : 'Add an authenticator app so a stolen password alone can never open your account.'}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>Enable 2FA</Button>
        {!isAdmin && (
          <button
            type="button"
            onClick={dismissNudge}
            aria-label="Dismiss two-factor authentication reminder"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-muted transition hover:bg-forest-900/8 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:hover:bg-white/10"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <MfaEnrollDialog open={open} onClose={() => setOpen(false)} onChanged={handleChanged} />
    </GlassCard>
  )
}

function ResearchLaunchpad({ stats, canArchive, trackGroups, savedPapers }) {
  const navigate = useNavigate()
  const [promptInput, setPromptInput] = useState('')

  const submitPrompt = (event) => {
    event.preventDefault()
    const trimmed = promptInput.trim()
    navigate(trimmed ? `/chat?q=${encodeURIComponent(trimmed)}` : '/chat')
  }

  return (
    <GlassCard className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Start a research inquiry</h2>
        {stats.yearRangeLabel !== '—' && (
          <span className="text-xs font-medium text-ink-muted">
            Archive span: <span className="font-semibold text-ink">{stats.yearRangeLabel}</span>
          </span>
        )}
      </div>
      <form onSubmit={submitPrompt} className="flex flex-col gap-2.5 sm:flex-row">
        <div className="glass flex flex-1 items-center gap-2.5 rounded-2xl px-3.5 py-2 focus-within:ring-2 focus-within:ring-gold-400">
          <Search size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            type="text"
            value={promptInput}
            onChange={(event) => setPromptInput(event.target.value)}
            aria-label="Ask IskAI a research question"
            placeholder="Ask about thesis topics, methodologies, or related studies in CCSICT..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </div>
        <Button type="submit" variant="primary" className="shrink-0">
          <Sparkles size={15} aria-hidden="true" /> Search with IskAI
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-muted">Try asking:</span>
        {STUDENT_STARTER_PROMPTS.map((item) => (
          <Link
            key={item.label}
            to={`/chat?q=${encodeURIComponent(item.prompt)}`}
            className="rounded-full border border-forest-900/12 bg-forest-600/6 px-3 py-1 text-xs font-medium text-forest-800 transition hover:bg-forest-600/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:border-white/12 dark:bg-white/6 dark:text-forest-200 dark:hover:bg-white/12"
          >
            {item.label}
          </Link>
        ))}
      </div>

      {canArchive && trackGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-forest-900/8 pt-3.5 dark:border-white/8">
          <span className="text-xs font-semibold text-ink-muted">Browse by track:</span>
          {trackGroups.map(({ track, count }) => (
            <Link
              key={track}
              to={`/archive?track=${encodeURIComponent(track)}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gold-400/12 px-3 py-1 text-xs font-semibold text-gold-text transition hover:bg-gold-400/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:text-gold-300"
            >
              <span>{track}</span>
              <span className="rounded-full bg-forest-900/10 px-1.5 py-0.2 text-[11px] tabular-nums dark:bg-white/10">
                {count}
              </span>
            </Link>
          ))}
        </div>
      )}

      {canArchive && savedPapers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-forest-900/8 pt-3.5 dark:border-white/8">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
            <BookMarked size={14} className="text-gold-500" aria-hidden="true" />
            <span>Saved reading list: <span className="font-bold text-ink">{savedPapers.length}</span> {savedPapers.length === 1 ? 'study' : 'studies'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/archive?saved=1"
              className="inline-flex items-center gap-1 rounded-xl border border-forest-900/12 bg-forest-600/8 px-3 py-1 text-xs font-semibold text-forest-800 transition hover:bg-forest-600/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:border-white/12 dark:bg-white/8 dark:text-forest-200"
            >
              View saved ({savedPapers.length})
            </Link>
            {savedPapers.length >= 2 && (
              <Link
                to={`/chat?q=${encodeURIComponent(buildComparisonPrompt(savedPapers.slice(0, 3)))}`}
                className="inline-flex items-center gap-1 rounded-xl bg-gold-400/18 px-3 py-1 text-xs font-semibold text-gold-text transition hover:bg-gold-400/28 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:text-gold-300"
              >
                <Sparkles size={12} aria-hidden="true" /> Compare in IskAI
              </Link>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  )
}

export default function Dashboard() {
  const { user, displayName, role, department, canArchive, canScan, canUpload, isAdmin } = useAuth()
  const navigate = useNavigate()
  const {
    data: papers, isLoading, isError: papersError, refetch: retryPapers,
  } = useQuery({ queryKey: ['papers'], queryFn: () => listPapers() })
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
    enabled: !!user,
  })

  const stats = useMemo(() => computeDashboardStats(papers), [papers])
  const trackGroups = useMemo(() => groupPapersByTrack(papers), [papers])
  const rawSavedSnapshot = useSyncExternalStore(
    subscribeReadingList,
    () => getReadingListSnapshot(user?.id),
    () => '[]',
  )
  const savedPapers = useMemo(() => {
    const savedSet = new Set(parseSavedPaperIds(rawSavedSnapshot).map(String))
    return (papers || []).filter((p) => savedSet.has(String(p.id)))
  }, [papers, rawSavedSnapshot])
  const recent = (papers || []).slice(0, 5)
  const recentSessions = sessions.slice(0, 3)
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'

  if (isLoading) {
    return <PageSkeleton />
  }

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gold-text dark:text-gold-300">{greeting},</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {displayName}
          </h1>
          <p className="mt-1 text-sm font-semibold text-forest-700 dark:text-gold-400">
            {formatRoleSubtitle(role, department)}
          </p>
          <p className="mt-1.5 text-sm text-ink-muted">
            {role === 'admin'
              ? 'Manage the archive, monitor usage, and validate research novelty.'
              : role === 'faculty'
                ? 'Validate topic novelty and explore accumulated research.'
                : 'Explore the thesis archive with AI-powered semantic search.'}
          </p>
        </div>
        <Button variant="gold" onClick={() => navigate('/chat')}>
          <Sparkles size={16} aria-hidden="true" /> Ask IskAI
        </Button>
      </div>

      <SecurityNudge />

      {papersError && (
        <GlassCard role="alert" className="flex flex-wrap items-center gap-3 border border-flame-500/25 p-4 text-sm">
          <AlertTriangle size={17} className="shrink-0 text-flame-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">Archive metrics are temporarily unavailable</div>
            <div className="mt-0.5 text-xs text-ink-muted">No unavailable values are being presented as measured zeros.</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => retryPapers()}>Retry</Button>
        </GlassCard>
      )}

      {/* Stats bento */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {papersError ? (
          STAT_SKELETONS.map((slotId) => <Skeleton key={slotId} className="h-32" />)
        ) : (
          <>
            <StatTile icon={BookMarked} label="Theses indexed" value={stats.total} />
            <StatTile icon={GitBranch} label="Academic tracks" value={stats.tracks} />
            <StatTile icon={CalendarRange} label="Years covered" value={stats.distinctYears} />
            {isAdmin ? (
              <StatTile icon={Layers} label="Semantic chunks" value={stats.chunks} />
            ) : (
              <StatTile icon={Sparkles} label="Last 5 years" value={stats.recentWindowCount} />
            )}
          </>
        )}
      </motion.div>

      <ResearchLaunchpad
        stats={stats}
        canArchive={canArchive}
        trackGroups={trackGroups}
        savedPapers={savedPapers}
      />

      {/* Quick actions + recent conversations + recent papers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className=" flex flex-col gap-4">
          <QuickAction
            icon={MessageSquareText}
            title="AI Chat"
            text="Ask natural-language questions and receive citation-backed answers."
            to="/chat"
          />
          {canArchive && (
            <QuickAction
              icon={Library}
              title="Browse archive"
              text="Explore thesis metadata by program, specialization, year, and author."
              to="/archive"
            />
          )}
          {canScan && (
            <QuickAction
              icon={ShieldCheck}
              title="Novelty check"
              text="Scan a proposal against the archive at the 85% duplication threshold."
              tone="gold"
              to="/novelty"
            />
          )}
          {canUpload && (
            <QuickAction
              icon={UploadCloud}
              title="Upload thesis"
              text="Digitize and index a new manuscript into the vector archive."
              tone="gold"
              to="/upload"
            />
          )}

          {/* Recent research conversations fill the lower-left column for students */}
          <GlassCard className="flex-1 p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display flex items-center gap-2 text-base font-bold">
                <History size={16} className="text-gold-500" aria-hidden="true" />
                Recent conversations
              </h2>
              <Link
                to="/chat"
                className="text-xs font-semibold text-forest-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:text-gold-300"
              >
                New chat
              </Link>
            </div>
            {recentSessions.length === 0 ? (
              <p className="py-4 text-xs leading-relaxed text-ink-muted">
                Your saved IskAI literature review threads will appear here so you can pick up where you left off.
              </p>
            ) : (
              <div className="space-y-2">
                {recentSessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/chat?session=${encodeURIComponent(session.id)}`}
                    className="glass group flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs transition hover:border-gold-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                  >
                    <span className="truncate font-semibold">{session.title || 'Untitled inquiry'}</span>
                    <ArrowRight
                      size={14}
                      aria-hidden="true"
                      className="shrink-0 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-90"
                    />
                  </Link>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        {/* Recent additions */}
        <GlassCard className="p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">{isAdmin ? 'Recently indexed' : 'Recent theses'}</h2>
            {canArchive && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/archive')}>
                View all <ArrowRight size={14} aria-hidden="true" />
              </Button>
            )}
          </div>
          {papersError ? (
            <div className="py-10 text-center">
              <p className="text-sm text-ink-muted">Recent additions could not be loaded.</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => retryPapers()}>Retry archive</Button>
            </div>
          ) : recent.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-faint">
              The archive is empty. {isAdmin ? 'Upload the first thesis to begin.' : 'Check back soon.'}
            </p>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-2.5">
              {recent.map((p) => (
                <motion.div
                  key={p.id}
                  variants={staggerItem}
                  className="glass group flex flex-col gap-3 rounded-2xl p-4 transition hover:border-gold-400/35 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3.5">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-600/12 dark:bg-forest-400/12">
                      <BookMarked size={16} className="text-forest-700 dark:text-forest-300" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {canArchive ? (
                        <Link
                          to={`/archive?paper=${encodeURIComponent(p.id)}`}
                          className="line-clamp-2 text-sm font-semibold leading-snug transition group-hover:text-forest-700 focus-visible:outline-none focus-visible:underline dark:group-hover:text-gold-300"
                        >
                          {p.title}
                        </Link>
                      ) : (
                        <div className="line-clamp-2 text-sm font-semibold leading-snug">{p.title}</div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        {p.track && <Badge tone="forest">{p.track}</Badge>}
                        <span className="truncate">{p.authors || 'Unknown authors'}</span>
                        {p.year && <span>· {p.year}</span>}
                        {isAdmin && p.created_at && (
                          <span className="text-ink-faint">· Added {formatDate(p.created_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end">
                    <Link
                      to={`/chat?q=${encodeURIComponent(buildPaperChatPrompt(p))}`}
                      aria-label={`Ask IskAI about ${p.title}`}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-forest-900/12 bg-forest-600/8 px-3 py-1.5 text-xs font-semibold text-forest-800 transition hover:bg-forest-600/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 dark:border-white/12 dark:bg-white/8 dark:text-gold-300 dark:hover:bg-white/14"
                    >
                      <Sparkles size={12} aria-hidden="true" /> Ask IskAI
                    </Link>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </GlassCard>
      </div>
    </PageTransition>
  )
}
