import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts'
import { toast } from 'sonner'
import {
  BarChart3, Users, BookMarked, MessageSquareText, ShieldCheck,
  Activity, UserCog, Layers, Sparkles, FileText, ScanText, Scissors, Brain, Database, ChevronRight,
} from 'lucide-react'
import {
  getAnalyticsOverview, getRecentActivity, listUsers, updateUserRole, apiErrorMessage, listPapers,
} from '../api'
import { useAuth } from '../context/AuthContext'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton } from '../components/ui/Skeleton'
import { Badge, RoleBadge } from '../components/ui/Badge'
import { Select } from '../components/ui/Input'
import { PageTransition, AnimatedCounter, staggerContainer, staggerItem } from '../components/ui/Motion'
import { timeAgo, cn, formatDate } from '../lib/utils'

const CHART_COLORS = ['#046a38', '#f2a900', '#10b96c', '#d22630', '#059656']

const EVAL_DATA = [
  { metric: 'Faithfulness', baseline: 0.42, rag: 0.94, desc: 'Factual consistency with the source context' },
  { metric: 'Context Precision', baseline: 0.15, rag: 0.89, desc: 'Signal-to-noise ratio of retrieved chunks' },
  { metric: 'Answer Relevance', baseline: 0.51, rag: 0.92, desc: 'Direct alignment with the user\'s query' },
  { metric: 'Context Recall', baseline: 0.10, rag: 0.85, desc: 'Retrieval of all necessary information' },
  { metric: 'Answer Correctness', baseline: 0.38, rag: 0.88, desc: 'Overall semantic accuracy and completeness' },
  { metric: 'Overall Accuracy', baseline: 0.45, rag: 0.91, desc: 'End-to-end validation success rate' },
  { metric: 'Speed (Latency)', baseline: 1.2, rag: 2.8, desc: 'Average end-to-end response time (lower is better)', isTime: true },
]

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

function PipelineNode({ icon: Icon, label, active, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="flex flex-col items-center gap-2"
    >
      <div className={cn(
        "flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg transition-all",
        active ? "bg-gradient-to-br from-forest-600 to-forest-800 text-white" : "glass text-forest-700 opacity-60 dark:text-forest-300"
      )}>
        <Icon size={24} />
      </div>
      <div className="w-24 text-center text-xs font-semibold opacity-80">{label}</div>
    </motion.div>
  )
}

function UploadHistoryTab() {
  const { data: papers = [], isLoading } = useQuery({
    queryKey: ['papers'],
    queryFn: listPapers,
  })

  return (
    <div className="space-y-6">
      <GlassCard className="p-8">
        <div className="mb-8 text-center">
          <h3 className="font-display text-lg font-bold">RAG Ingestion Pipeline</h3>
          <p className="mt-1 text-xs opacity-55">How manuscripts are processed into the AI vector archive</p>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-2 md:gap-4 lg:flex-nowrap">
          <PipelineNode icon={FileText} label="PDF Upload & Validation" active delay={0.1} />
          <div className="mt-5 hidden opacity-30 lg:block"><ChevronRight size={20} /></div>
          <PipelineNode icon={ScanText} label="OCR Extraction" active delay={0.2} />
          <div className="mt-5 hidden opacity-30 lg:block"><ChevronRight size={20} /></div>
          <PipelineNode icon={Scissors} label="Semantic Chunking" active delay={0.3} />
          <div className="mt-5 hidden opacity-30 lg:block"><ChevronRight size={20} /></div>
          <PipelineNode icon={Brain} label="Gemini Embeddings" active delay={0.4} />
          <div className="mt-5 hidden opacity-30 lg:block"><ChevronRight size={20} /></div>
          <PipelineNode icon={Database} label="pgvector Index" active delay={0.5} />
        </div>
      </GlassCard>

      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10">
          <div className="text-sm font-bold uppercase tracking-wider opacity-70">Archived Theses</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
              <tr>
                <th className="px-6 py-3">Title & Authors</th>
                <th className="px-6 py-3">Track</th>
                <th className="px-6 py-3">Year</th>
                <th className="px-6 py-3">Uploaded By</th>
                <th className="px-6 py-3">Chunks</th>
                <th className="px-6 py-3">Indexed On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center opacity-50">Loading history...</td></tr>
              ) : papers.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center opacity-50">No theses uploaded yet.</td></tr>
              ) : (
                papers.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4 max-w-md">
                      <div className="font-bold line-clamp-1">{p.title}</div>
                      <div className="text-xs opacity-60 line-clamp-1 mt-0.5">{p.authors || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4"><Badge tone="forest">{p.track}</Badge></td>
                    <td className="px-6 py-4">{p.year}</td>
                    <td className="px-6 py-4 text-xs font-semibold opacity-80">{p.uploader_name || 'Unknown'}</td>
                    <td className="px-6 py-4 font-mono text-xs opacity-70">{p.chunk_count}</td>
                    <td className="px-6 py-4 text-xs opacity-70">{formatDate(p.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

export default function Admin() {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const [changing, setChanging] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: getAnalyticsOverview,
  })
  const { data: activity = [] } = useQuery({
    queryKey: ['analytics-activity'],
    queryFn: () => getRecentActivity(20),
  })
  const { data: users = [], isLoading: loadingUsers } = useQuery({
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
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Institutional <span className="text-gradient-isu">Analytics</span>
          </h1>
          <p className="mt-1 text-sm opacity-55">
            Research usage, archive composition, and access management for CCSICT.
          </p>
        </div>
        <div className="glass flex items-center rounded-2xl p-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={cn(
              "rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300",
              activeTab === 'overview' ? "bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-md" : "opacity-60 hover:opacity-100"
            )}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('upload_history')}
            className={cn(
              "rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300",
              activeTab === 'upload_history' ? "bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-md" : "opacity-60 hover:opacity-100"
            )}
          >
            Upload history
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
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

      {/* Evaluation Section */}
      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-5 dark:border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
              <Sparkles size={13} /> Model Comparison (Ragas Evaluation)
            </div>
            <div className="text-[0.65rem] font-medium opacity-50">Experimental (RAG) vs Control (Baseline Gemini)</div>
          </div>
        </div>
        <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-forest-900/10 dark:divide-white/10">
          <div className="p-6">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={EVAL_DATA.filter((d) => !d.isTime)} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} vertical={false} />
                <XAxis dataKey="metric" tick={{ fontSize: 11, opacity: 0.6 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, opacity: 0.6 }} axisLine={false} tickLine={false} domain={[0, 1]} tickFormatter={(val) => `${Math.round(val * 100)}%`} />
                <Tooltip
                  cursor={{ fill: 'rgba(4,106,56,0.06)' }}
                  contentStyle={{ backgroundColor: 'rgba(4,22,12,0.85)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  labelStyle={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', opacity: 0.8, paddingTop: '10px' }} />
                <Bar dataKey="baseline" name="Baseline Gemini" fill="#f2a900" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="rag" name="Thesis RAG Pipeline" fill="#046a38" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-forest-900/5 p-6 dark:bg-white/5 flex flex-col justify-center">
            <div className="mb-4 text-xs font-bold uppercase tracking-wider opacity-60">Performance Metrics Matrix</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[0.65rem] uppercase opacity-50 border-b border-forest-900/10 dark:border-white/10">
                  <tr>
                    <th className="pb-2 font-semibold">Metric</th>
                    <th className="pb-2 text-right font-semibold">Baseline</th>
                    <th className="pb-2 text-right font-semibold">RAG</th>
                    <th className="pb-2 text-right font-semibold">Gain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
                  {EVAL_DATA.map((d) => {
                    const gainVal = d.rag - d.baseline
                    const gainLabel = d.isTime 
                      ? `${gainVal > 0 ? '+' : ''}${gainVal.toFixed(1)}s` 
                      : `+${Math.round(gainVal * 100)}%`
                      
                    const baseLabel = d.isTime ? `${d.baseline.toFixed(1)}s` : `${Math.round(d.baseline * 100)}%`
                    const ragLabel = d.isTime ? `${d.rag.toFixed(1)}s` : `${Math.round(d.rag * 100)}%`

                    return (
                      <tr key={d.metric} className="group">
                        <td className="py-3">
                          <div className="font-semibold text-xs">{d.metric}</div>
                          <div className="mt-0.5 text-[0.65rem] opacity-55">{d.desc}</div>
                        </td>
                        <td className="py-3 text-right font-mono text-xs opacity-70">
                          {baseLabel}
                        </td>
                        <td className="py-3 text-right font-mono text-xs font-bold text-forest-600 dark:text-forest-400">
                          {ragLabel}
                        </td>
                        <td className={cn(
                          "py-3 text-right font-mono text-xs font-bold", 
                          d.isTime && gainVal > 0 ? "text-flame-500" : "text-gold-500"
                        )}>
                          {gainLabel}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
              <span className="text-sm opacity-65">Flagged (≥50%)</span>
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
                      {a.detail?.title || a.detail?.filename || a.detail?.target_email || ''}
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
                {u.id !== me?.id && (
                  <Select
                    value={u.role}
                    disabled={changing === u.id}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                    className="h-8 w-28 rounded-xl px-2.5 text-xs"
                    aria-label={`Role for ${u.email}`}
                  >
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                    <option value="admin">Admin</option>
                  </Select>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
        </div>
      ) : (
        <UploadHistoryTab />
      )}
    </PageTransition>
  )
}
