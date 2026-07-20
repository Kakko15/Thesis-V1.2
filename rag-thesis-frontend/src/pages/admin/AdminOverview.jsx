import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, BarChart3, BookMarked, Layers,
  MessageSquareText, ShieldCheck, UserCog, Users,
} from 'lucide-react'
import { apiErrorMessage, getAnalyticsOverview, getRecentActivity, listUsers, updateUserRole } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { GlassCard } from '../../components/ui/GlassCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { RoleBadge } from '../../components/ui/Badge'
import { Select } from '../../components/ui/Input'
import { AnimatedCounter, staggerContainer, staggerItem } from '../../components/ui/Motion'
import { timeAgo } from '../../lib/utils'

const CHART_COLORS = ['#046a38', '#f2a900', '#10b96c', '#d22630', '#059656']

const ACTION_LABELS = {
  chat_query: { label: 'AI query', icon: MessageSquareText, tone: 'text-forest-500' },
  paper_upload: { label: 'Thesis uploaded', icon: BookMarked, tone: 'text-gold-500' },
  paper_delete: { label: 'Thesis deleted', icon: BookMarked, tone: 'text-flame-500' },
  novelty_scan: { label: 'Novelty scan', icon: ShieldCheck, tone: 'text-gold-500' },
  role_change: { label: 'Role changed', icon: UserCog, tone: 'text-forest-500' },
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong rounded-xl px-3.5 py-2 text-xs">
      <div className="font-bold">{label ?? payload[0].name}</div>
      <div className="opacity-70">{payload[0].value} theses</div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <motion.div variants={staggerItem}>
      <GlassCard hover className="p-5">
        <Icon size={18} className="mb-2.5 text-gold-400" />
        <div className="font-display text-2xl font-extrabold"><AnimatedCounter value={value} /></div>
        <div className="mt-0.5 text-[0.68rem] font-semibold uppercase tracking-wider opacity-55">{label}</div>
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

  const { data: overview, isLoading, isError: overviewError } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: getAnalyticsOverview,
  })
  const { data: activity = [], isError: activityError } = useQuery({
    queryKey: ['analytics-activity'],
    queryFn: () => getRecentActivity(20),
  })
  const { data: users = [], isLoading: loadingUsers, isError: usersError } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

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
        <GlassCard className="flex items-center gap-3 border border-flame-500/25 p-4 text-sm">
          <AlertTriangle size={17} className="shrink-0 text-flame-500" />
          Some administration data could not be loaded. No missing values are being treated as measured zeros.
        </GlassCard>
      )}
        <div className="space-y-6">
          {/* Stat grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={BookMarked} label="Theses indexed" value={overview?.papers?.total ?? 0} />
          <StatCard icon={Layers} label="Vector chunks" value={overview?.papers?.total_chunks ?? 0} />
          <StatCard icon={MessageSquareText} label="AI queries" value={overview?.usage?.chat_queries ?? 0} />
          <StatCard icon={Users} label="Registered users" value={overview?.users?.total ?? 0} />
        </motion.div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
            <BarChart3 size={13} /> Theses per track
          </div>
          {trackData.length === 0 ? (
            <p className="py-14 text-center text-sm opacity-45">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={trackData} dataKey="value" nameKey="name"
                  innerRadius={58} outerRadius={92} paddingAngle={4} strokeWidth={0}
                >
                  {trackData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {trackData.map((t, i) => (
              <div key={t.name} className="flex items-center gap-1.5 text-xs opacity-70">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                {t.name} ({t.value})
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
            <BarChart3 size={13} /> Theses per year
          </div>
          {yearData.length === 0 ? (
            <p className="py-14 text-center text-sm opacity-45">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={yearData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, opacity: 0.6 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, opacity: 0.6 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(4,106,56,0.06)' }} />
                <Bar dataKey="value" fill="#046a38" radius={[8, 8, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </div>

      <GlassCard className="border border-gold-400/25 p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-gold-500" />
          <div>
            <div className="font-semibold">Ragas comparison pending faculty validation</div>
            <p className="mt-1 text-sm leading-relaxed opacity-60">
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
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
            <ShieldCheck size={13} /> Novelty scanning
          </div>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm opacity-65">Total scans</span>
              <span className="font-display text-xl font-extrabold">{overview?.usage?.novelty_scans ?? 0}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm opacity-65">Avg duplication</span>
              <span className="font-display text-xl font-extrabold text-gold-500 dark:text-gold-300">
                {overview?.usage?.avg_duplication_percentage ?? 0}%
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm opacity-65">Flagged (â‰¥50%)</span>
              <span className="font-display text-xl font-extrabold text-flame-500">
                {overview?.usage?.flagged_scans ?? 0}
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-forest-900/10 pt-4 dark:border-white/10">
              <span className="text-sm opacity-65">Chat sessions</span>
              <span className="font-display text-xl font-extrabold">{overview?.usage?.chat_sessions ?? 0}</span>
            </div>
          </div>
        </GlassCard>

        {/* Recent activity */}
        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
            <Activity size={13} /> Recent activity
          </div>
          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {activity.length === 0 && <p className="py-8 text-center text-sm opacity-45">No activity recorded yet</p>}
            {activity.map((a) => {
              const meta = ACTION_LABELS[a.action] || { label: a.action, icon: Activity, tone: 'opacity-60' }
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <div className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                    <meta.icon size={13} className={meta.tone} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{meta.label}</div>
                    <div className="truncate text-[0.65rem] opacity-45">
                      {typeof a.detail === 'object' ? JSON.stringify(a.detail) : (a.detail?.title || a.detail?.filename || a.detail?.target_email || a.detail || '')}
                    </div>
                  </div>
                  <span className="shrink-0 text-[0.65rem] opacity-40">{timeAgo(a.created_at)}</span>
                </div>
              )
            })}
          </div>
        </GlassCard>

        {/* User management */}
        <GlassCard className="p-6">
          <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
            <UserCog size={13} /> User roles
          </div>
          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {loadingUsers && [...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
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
