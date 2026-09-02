import { lazy, Suspense, useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, BookMarked, Layers,
  MessageSquareText, ShieldCheck, UserCog, Users,
} from 'lucide-react'
import { apiErrorMessage, getAnalyticsOverview, getRecentActivity, listUsers, updateUserRole } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { GlassCard } from '../../components/ui/GlassCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { slotKeys } from '../../lib/keys'
import { Badge, RoleBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'
import { AnimatedCounter, staggerContainer, staggerItem } from '../../components/ui/Motion'
import { timeAgo } from '../../lib/utils'

const OverviewCharts = lazy(() => import('./OverviewCharts'))
const CHART_PANEL_HEIGHT = 'h-[21rem]'
const STAT_SKELETONS = slotKeys(4, 'overview-stat')
const USER_SKELETONS = slotKeys(4, 'overview-user')
const CHART_SKELETONS = slotKeys(2, 'overview-chart')

const ACTION_LABELS = {
  chat_query: { label: 'AI query', icon: MessageSquareText, tone: 'text-forest-500' },
  paper_upload: { label: 'Thesis uploaded', icon: BookMarked, tone: 'text-gold-500' },
  paper_delete: { label: 'Thesis deleted', icon: BookMarked, tone: 'text-flame-500' },
  novelty_scan: { label: 'Novelty scan', icon: ShieldCheck, tone: 'text-gold-500' },
  role_change: { label: 'Role changed', icon: UserCog, tone: 'text-forest-500' },
}

function activityDetail(action, detail) {
  if (!detail || typeof detail !== 'object') return detail || ''

  if (action === 'chat_query') {
    const parts = []
    if (detail.fast_path) parts.push(detail.fast_path.replaceAll('_', ' '))
    if (typeof detail.sources_cited === 'number') {
      parts.push(`${detail.sources_cited} ${detail.sources_cited === 1 ? 'source' : 'sources'}`)
    }
    if (detail.duplication_flagged) parts.push('similarity flagged')
    return parts.join(' | ') || 'Completed'
  }

  if (detail.title || detail.filename) return detail.title || detail.filename
  if (detail.target_email) return `${detail.target_email}${detail.new_role ? `: ${detail.new_role}` : ''}`
  if (detail.reason) return detail.reason
  return 'Details available in system logs'
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <motion.div variants={staggerItem}>
      <GlassCard hover className="p-5">
        <Icon size={18} className="mb-2.5 text-gold-400" />
        <div className="font-display text-2xl font-extrabold"><AnimatedCounter value={value} /></div>
        <div className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      </GlassCard>
    </motion.div>
  )
}

// Chart and table variants remain colocated to preserve their shared query snapshot.
// eslint-disable-next-line complexity
export default function AdminOverview() {
  const { user: me, isSuperadmin } = useAuth()
  const queryClient = useQueryClient()
  const [changing, setChanging] = useState(null)

  const {
    data: overview, isLoading, isError: overviewError, refetch: refetchOverview,
  } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: getAnalyticsOverview,
  })
  const {
    data: activity = [], isError: activityError, refetch: refetchActivity,
  } = useQuery({
    queryKey: ['analytics-activity'],
    queryFn: () => getRecentActivity(20),
  })
  const {
    data: users = [], isLoading: loadingUsers, isError: usersError, refetch: refetchUsers,
  } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  // Retry only what actually failed, so a working panel is not thrown away to
  // recover a broken one.
  const retryFailed = () => {
    if (overviewError) refetchOverview()
    if (activityError) refetchActivity()
    if (usersError) refetchUsers()
  }

  const trackData = Object.entries(overview?.papers?.per_track || {}).map(([name, value]) => ({ name, value }))
  const yearData = Object.entries(overview?.papers?.per_year || {}).map(([name, value]) => ({ name, value }))

  const changeRole = async (userId, role) => {
    setChanging(userId)
    try {
      await updateUserRole(userId, role)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-overview'] })
      toast.success('Role updated')
    } catch (err) {
      toast.error('Role change failed', { description: apiErrorMessage(err) })
    } finally {
      setChanging(null)
    }
  }

  return (
    <>
      {(overviewError || activityError || usersError) && (
        <GlassCard className="flex flex-wrap items-center gap-3 border border-flame-500/25 p-4 text-sm">
          <AlertTriangle size={17} className="shrink-0 text-flame-500" aria-hidden="true" />
          <span className="flex-1">
            Some administration data could not be loaded. No missing values are being treated as measured zeros.
          </span>
          <Button variant="secondary" size="sm" onClick={retryFailed}>Retry</Button>
        </GlassCard>
      )}
        <div className="space-y-6">
          {/* Stat grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STAT_SKELETONS.map((slotId) => <Skeleton key={slotId} className="h-28" />)}
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={BookMarked} label="Theses indexed" value={overview?.papers?.total ?? 0} />
          <StatCard icon={Layers} label="Vector chunks" value={overview?.papers?.total_chunks ?? 0} />
          <StatCard icon={MessageSquareText} label="AI queries" value={overview?.usage?.chat_queries ?? 0} />
          <StatCard icon={Users} label="Registered users" value={overview?.users?.total ?? 0} />
        </motion.div>
      )}

      {/* Category breakdown — hidden until the thesis category migration is
          applied, when the backend starts reporting per_category counts. */}
      {Object.keys(overview?.papers?.per_category || {}).length > 0 && (
        <GlassCard className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Archive by category
          </span>
          <Badge tone="forest">Student theses: {overview.papers.per_category.student ?? 0}</Badge>
          <Badge tone="gold">Faculty research: {overview.papers.per_category.faculty ?? 0}</Badge>
        </GlassCard>
      )}

      {/* Charts. Recharts is ~109 kB gzipped and lives in its own chunk, so the
          statistics above paint without waiting for a charting library. The
          fallback reserves the panels' height to avoid a layout shift. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={CHART_SKELETONS.map((slotId) => (
          <Skeleton key={slotId} className={CHART_PANEL_HEIGHT} />
        ))}
        >
          <OverviewCharts trackData={trackData} yearData={yearData} />
        </Suspense>
      </div>

      <GlassCard className="border border-gold-400/25 p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-gold-500" />
          <div>
            <div className="font-semibold">Ragas comparison pending faculty validation</div>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              No baseline-versus-RAG scores are displayed until the Golden Dataset is completed,
              faculty-validated, and evaluated. This prevents placeholder values from being mistaken
              for measured thesis findings.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Usage + activity + users */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Usage summary */}
        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
            <ShieldCheck size={13} /> Novelty scanning
          </div>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-muted">Total scans</span>
              <span className="font-display text-xl font-extrabold">{overview?.usage?.novelty_scans ?? 0}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-muted">Avg duplication</span>
              <span className="font-display text-xl font-extrabold text-gold-text dark:text-gold-300">
                {overview?.usage?.avg_duplication_percentage ?? 0}%
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-muted">High overlap (coverage ≥50%)</span>
              <span className="font-display text-xl font-extrabold text-flame-500">
                {overview?.usage?.flagged_scans ?? 0}
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-forest-900/10 pt-4 dark:border-white/10">
              <span className="text-sm text-ink-muted">Chat sessions</span>
              <span className="font-display text-xl font-extrabold">{overview?.usage?.chat_sessions ?? 0}</span>
            </div>
          </div>
        </GlassCard>

        {/* Recent activity */}
        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
            <Activity size={13} /> Recent activity
          </div>
          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {activity.length === 0 && <p className="py-8 text-center text-sm text-ink-faint">No activity recorded yet</p>}
            {activity.map((a) => {
              const meta = ACTION_LABELS[a.action] || { label: a.action, icon: Activity, tone: 'opacity-60' }
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <div className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <meta.icon size={13} className={meta.tone} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{meta.label}</div>
                    <div className="truncate text-xs text-ink-faint">
                      {activityDetail(a.action, a.detail)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-faint">{timeAgo(a.created_at)}</span>
                </div>
              )
            })}
          </div>
        </GlassCard>

        {/* User management */}
        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
            <UserCog size={13} /> User roles
          </div>
          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {loadingUsers && USER_SKELETONS.map((slotId) => <Skeleton key={slotId} className="h-14" />)}
            {users.map((u) => (
              <div key={u.id} className="glass flex items-center gap-3 rounded-2xl p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 text-xs font-bold text-white">
                  {(u.full_name || u.email || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{u.full_name || u.email}</div>
                  <div className="mt-0.5"><RoleBadge role={u.role} /></div>
                </div>
                {u.id !== me?.id && (isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                  <Select
                    value={u.role}
                    disabled={changing === u.id}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                    className="h-8 w-28 rounded-xl px-2.5 text-xs"
                    aria-label={`Role for ${u.email}`}
                  >
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                    {isSuperadmin && <option value="admin">Admin</option>}
                    {isSuperadmin && <option value="superadmin">Superadmin</option>}
                  </Select>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
        </div>
    </>
  )
}
