import { useState, useMemo } from 'react'
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
  Trash2, TerminalSquare, Save, Plus, X as CloseIcon, Pencil, Search
} from 'lucide-react'
import {
  getAnalyticsOverview, getRecentActivity, listUsers, updateUserRole, apiErrorMessage, listPapers, deleteUser, updateUserDetails, getSystemLogs, getPaperUrl, getDepartments, createDepartment, updateDepartment, deleteDepartment, getFeaturePermissions, updateFeaturePermissions, getTracks
} from '../api'
import { useAuth } from '../context/AuthContext'
import { GlassCard } from '../components/ui/GlassCard'
import { Skeleton } from '../components/ui/Skeleton'
import { Badge, RoleBadge } from '../components/ui/Badge'
import { Select, Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
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

function PaginationControls({ page, setPage, total, limit }) {
  const totalPages = Math.ceil(total / limit)
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-forest-900/10 dark:border-white/10">
      <div className="text-xs opacity-60">Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total}</div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="py-1 px-3 h-auto text-xs">Prev</Button>
        <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="py-1 px-3 h-auto text-xs">Next</Button>
      </div>
    </div>
  )
}

function UploadHistoryTab() {
  const { role, department: userDept } = useAuth()
  const { data: papers = [], isLoading } = useQuery({
    queryKey: ['papers', role, userDept],
    queryFn: () => listPapers(role === 'admin' ? userDept : null),
  })

  const [query, setQuery] = useState('')
  const [trackFilter, setTrackFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState(role === 'admin' ? userDept : '')

  const { data: tracks = [] } = useQuery({ queryKey: ['tracks'], queryFn: getTracks })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const years = useMemo(() => {
    const ys = [...new Set((papers || []).map((p) => p.year).filter(Boolean))]
    return ys.sort((a, b) => b - a)
  }, [papers])

  const { activeTracks, trackLabel } = useMemo(() => {
    if (!deptFilter) return { activeTracks: tracks, trackLabel: 'track' }
    const dept = departments.find(d => d.name === deptFilter)
    if (dept) return { activeTracks: dept.tracks || [], trackLabel: dept.track_label?.toLowerCase() || 'track' }
    return { activeTracks: tracks, trackLabel: 'track' }
  }, [deptFilter, departments, tracks])

  const filteredPapers = useMemo(() => {
    return (papers || []).filter((p) => {
      const q = query.trim().toLowerCase()
      const matchQ = !q ||
        p.title?.toLowerCase().includes(q) ||
        p.authors?.toLowerCase().includes(q)
      const matchTrack = !trackFilter || p.track === trackFilter
      const matchYear = !yearFilter || String(p.year) === yearFilter
      const matchDepartment = !deptFilter || p.department === deptFilter
      return matchQ && matchTrack && matchYear && matchDepartment
    })
  }, [papers, query, trackFilter, yearFilter, deptFilter])

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

      {/* Filters */}
      <GlassCard className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <Input
            className="pl-11"
            placeholder="Search titles or authors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {deptFilter && (
          <Select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} className="sm:w-52" aria-label={`Filter by ${trackLabel}`}>
            <option value="">All {trackLabel}s</option>
            {activeTracks.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        )}
        {role !== 'admin' && (
          <Select value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setTrackFilter(''); }} className="sm:w-40" aria-label="Filter by department">
            <option value="">All depts</option>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
        )}
        <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="sm:w-36" aria-label="Filter by year">
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
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
                <th className="px-6 py-3">Dept</th>
                <th className="px-6 py-3">Year</th>
                <th className="px-6 py-3">Uploaded By</th>
                <th className="px-6 py-3">Chunks</th>
                <th className="px-6 py-3">Indexed On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              {isLoading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center opacity-50">Loading history...</td></tr>
              ) : filteredPapers.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center opacity-50">No matching theses found.</td></tr>
              ) : (
                filteredPapers.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4 max-w-md">
                      <div className="font-bold line-clamp-1">{p.title}</div>
                      <div className="text-xs opacity-60 line-clamp-1 mt-0.5">{p.authors || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4"><Badge tone="forest">{p.track}</Badge></td>
                    <td className="px-6 py-4"><Badge tone="neutral">{p.department}</Badge></td>
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

function FeaturePermissionsManagement() {
  const { broadcastFeatureUpdate } = useAuth()
  const queryClient = useQueryClient()
  const { data: features, isLoading } = useQuery({ queryKey: ['features'], queryFn: getFeaturePermissions })

  const handleToggle = async (role, feature) => {
    if (!features) return
    const current = features[role] || {}
    const newValue = !current[feature]
    const payload = {
      ...features,
      [role]: { ...current, [feature]: newValue }
    }
    
    // Optimistic update
    queryClient.setQueryData(['features'], payload)
    
    try {
      await updateFeaturePermissions(payload)
      toast.success(`${feature} for ${role} ${newValue ? 'enabled' : 'disabled'}`)
      
      // Fire a realtime broadcast so all connected clients instantly refetch without needing table RLS
      broadcastFeatureUpdate?.()
    } catch (err) {
      toast.error('Failed to update feature', { description: apiErrorMessage(err) })
      queryClient.invalidateQueries({ queryKey: ['features'] })
    }
  }

  return (
    <GlassCard className="overflow-hidden mb-6">
      <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-wider opacity-70">Role Feature Permissions</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
            <tr>
              <th className="px-6 py-3 w-1/4">Role</th>
              <th className="px-6 py-3 w-3/4">Granted Features</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
            {isLoading ? (
              <tr><td colSpan={2} className="px-6 py-8 text-center opacity-50">Loading features...</td></tr>
            ) : (
              ['student', 'faculty'].map(role => (
                <tr key={role} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                  <td className="px-6 py-4 font-bold capitalize">{role}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-4">
                      {['chat', 'archive', 'novelty', 'upload'].map(feature => {
                        const isEnabled = features?.[role]?.[feature] || false
                        const labelMap = {
                          chat: 'AI Chat',
                          archive: 'Archive',
                          novelty: 'Novelty Check',
                          upload: 'Upload Thesis'
                        }
                        return (
                          <label key={feature} className="flex items-center gap-2 cursor-pointer group">
                            <div className="relative inline-flex items-center">
                              <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={isEnabled}
                                onChange={() => handleToggle(role, feature)}
                              />
                              <div className="w-9 h-5 bg-forest-900/20 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-forest-500"></div>
                            </div>
                            <span className="text-sm font-medium group-hover:text-forest-600 dark:group-hover:text-gold-400 transition-colors">
                              {labelMap[feature]}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

function DepartmentsManagement() {
  const queryClient = useQueryClient()
  const { data: departments = [], isLoading } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', track_label: '', tracks: '' })
  const [page, setPage] = useState(1)

  const paginated = departments.slice((page - 1) * 5, page * 5)

  const startEdit = (d) => {
    setEditingId(d.id)
    setForm({ name: d.name, track_label: d.track_label, tracks: d.tracks.join(', ') })
  }
  
  const startCreate = () => {
    setEditingId('new')
    setForm({ name: '', track_label: 'Academic track', tracks: '' })
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name.trim(),
        track_label: form.track_label.trim(),
        tracks: form.tracks.split(',').map(t => t.trim()).filter(Boolean)
      }
      if (editingId === 'new') {
        await createDepartment(payload)
        toast.success('Department created')
      } else {
        await updateDepartment(editingId, payload)
        toast.success('Department updated')
      }
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setEditingId(null)
    } catch (err) {
      toast.error('Failed to save department', { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this department?')) return
    try {
      await deleteDepartment(id)
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('Department deleted')
    } catch (err) {
      toast.error('Failed to delete department', { description: apiErrorMessage(err) })
    }
  }

  return (
    <GlassCard className="overflow-hidden mb-6">
      <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-wider opacity-70">Departments & Tracks Configuration</div>
        <Button size="sm" onClick={startCreate} disabled={editingId !== null}><Plus size={14} className="mr-1" /> Add Dept</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
            <tr>
              <th className="px-6 py-3">Dept Name</th>
              <th className="px-6 py-3">Track Label</th>
              <th className="px-6 py-3">Tracks (Options)</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
            {isLoading ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center opacity-50">Loading departments...</td></tr>
            ) : (
              <>
                {paginated.map(d => (
                  <tr key={d.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4">
                      {editingId === d.id ? <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="h-8 text-xs max-w-[120px]" /> : <div className="font-bold">{d.name}</div>}
                    </td>
                    <td className="px-6 py-4">
                      {editingId === d.id ? <Input value={form.track_label} onChange={e => setForm({...form, track_label: e.target.value})} className="h-8 text-xs max-w-[150px]" /> : d.track_label}
                    </td>
                    <td className="px-6 py-4">
                      {editingId === d.id ? (
                        <Input value={form.tracks} onChange={e => setForm({...form, tracks: e.target.value})} placeholder="Comma-separated" className="h-8 text-xs w-full min-w-[200px]" />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {d.tracks.map(t => <Badge key={t} tone="neutral" className="text-[10px] py-0">{t}</Badge>)}
                          {d.tracks.length === 0 && <span className="opacity-40 italic text-xs">No tracks</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {editingId === d.id ? (
                          <>
                            <Button size="icon-sm" onClick={handleSave} aria-label="Save"><Save size={14} /></Button>
                            <Button size="icon-sm" variant="ghost" onClick={cancelEdit} aria-label="Cancel"><CloseIcon size={14} /></Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon-sm" variant="ghost" onClick={() => startEdit(d)} aria-label="Edit"><Pencil size={14} /></Button>
                            <Button size="icon-sm" variant="ghost" className="text-flame-500 hover:text-flame-600 hover:bg-flame-500/10" onClick={() => handleDelete(d.id)} aria-label="Delete"><Trash2 size={14} /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {editingId === 'new' && (
                  <tr className="bg-forest-900/5 dark:bg-white/5">
                    <td className="px-6 py-4"><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="E.g. CBEA" className="h-8 text-xs max-w-[120px]" /></td>
                    <td className="px-6 py-4"><Input value={form.track_label} onChange={e => setForm({...form, track_label: e.target.value})} placeholder="E.g. Program" className="h-8 text-xs max-w-[150px]" /></td>
                    <td className="px-6 py-4"><Input value={form.tracks} onChange={e => setForm({...form, tracks: e.target.value})} placeholder="Comma-separated tracks" className="h-8 text-xs w-full min-w-[200px]" /></td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="icon-sm" onClick={handleSave} aria-label="Save"><Save size={14} /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={cancelEdit} aria-label="Cancel"><CloseIcon size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls page={page} setPage={setPage} total={departments.length} limit={5} />
    </GlassCard>
  )
}

function SystemManagementTab() {
  const { user: me, role: myRole, isSuperadmin, department: myDept } = useAuth()
  const queryClient = useQueryClient()
  const [editingUser, setEditingUser] = useState(null)
  const [deptFilter, setDeptFilter] = useState(isSuperadmin ? 'all' : (myDept || 'all'))
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [paperSearchQuery, setPaperSearchQuery] = useState('')
  const [paperDeptFilter, setPaperDeptFilter] = useState(isSuperadmin ? 'all' : (myDept || 'all'))
  const [paperPage, setPaperPage] = useState(1)
  
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })
  
  const filteredUsers = users.filter(u => {
    if (deptFilter !== 'all' && u.department !== deptFilter) return false
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (statusFilter !== 'all' && u.status !== statusFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!u.full_name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false
    }
    return true
  })
  const paginatedUsers = filteredUsers.slice((userPage - 1) * 5, userPage * 5)
  
  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['system-logs'],
    queryFn: () => getSystemLogs(200),
  })

  const { data: papers = [], isLoading: loadingPapers } = useQuery({
    queryKey: ['papers', 'all'],
    queryFn: () => listPapers(null),
  })
  const filteredPapers = papers.filter(p => {
    if (paperDeptFilter !== 'all' && p.department !== paperDeptFilter) return false
    if (paperSearchQuery) {
      const q = paperSearchQuery.toLowerCase()
      if (!p.title?.toLowerCase().includes(q) && !p.authors?.toLowerCase().includes(q)) return false
    }
    return true
  })
  const paginatedPapers = filteredPapers.slice((paperPage - 1) * 5, paperPage * 5)

  const handleUpdate = async (userId, data) => {
    try {
      await updateUserDetails(userId, data)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
      setEditingUser(null)
    } catch (err) {
      toast.error('Update failed', { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to permanently delete this user? This action cannot be undone.')) return
    try {
      await deleteUser(userId)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deleted')
    } catch (err) {
      toast.error('Delete failed', { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="space-y-6">
      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider opacity-70">User Directory</div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <Input
                className="pl-9 h-8 text-xs w-[160px] rounded-xl"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setUserPage(1); }}
              />
            </div>
            {isSuperadmin && (
              <Select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setUserPage(1); }} className="h-8 rounded-xl px-2.5 text-xs w-[110px]">
                <option value="all">All Depts</option>
                <option value="CCSICT">CCSICT</option>
                <option value="CAS">CAS</option>
              </Select>
            )}
            <Select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setUserPage(1); }} className="h-8 rounded-xl px-2.5 text-xs w-[110px]">
              <option value="all">All Roles</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="admin">Admin</option>
              {isSuperadmin && <option value="superadmin">Superadmin</option>}
            </Select>
            <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setUserPage(1); }} className="h-8 rounded-xl px-2.5 text-xs w-[110px]">
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
              <tr>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Dept</th>
                <th className="px-6 py-3">Joined</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              {loadingUsers ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center opacity-50">Loading users...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center opacity-50">No users found.</td></tr>
              ) : (
                paginatedUsers.map(u => (
                  <tr key={u.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id ? (
                        <Input 
                          value={editingUser.full_name} 
                          onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })} 
                          className="h-8 text-xs max-w-[200px]"
                        />
                      ) : (
                        <div className="flex items-center gap-3">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt={u.full_name || u.email} className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm" />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest-900/10 text-xs font-bold text-forest-700 dark:bg-white/10 dark:text-forest-300 shadow-sm uppercase">
                              {(u.full_name || u.email || '?').charAt(0)}
                            </div>
                          )}
                          <div>
                            <div className="font-bold">{u.full_name || u.email}</div>
                            <div className="mt-0.5 text-[0.65rem] font-semibold text-forest-600 dark:text-gold-400 capitalize">
                              {u.role === 'superadmin' ? 'Super Admin at System' : <>{u.role === 'admin' ? 'Administrator' : u.role} at {u.department || 'Unassigned'}</>}
                            </div>
                            <div className="mt-0.5 text-xs opacity-60">{u.email}</div>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id ? (
                        <Select
                          value={editingUser.role}
                          onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                          className="h-8 rounded-xl px-2.5 text-xs w-[120px]"
                        >
                          <option value="student">Student</option>
                          <option value="faculty">Faculty</option>
                          {isSuperadmin && <option value="admin">Admin</option>}
                          {isSuperadmin && <option value="superadmin">Superadmin</option>}
                        </Select>
                      ) : (
                        <RoleBadge role={u.role} />
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id && isSuperadmin ? (
                        <Select
                          value={editingUser.status || 'approved'}
                          onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                          className="h-8 rounded-xl px-2.5 text-xs w-[100px]"
                        >
                          <option value="approved">Approved</option>
                          <option value="pending">Pending</option>
                          <option value="rejected">Rejected</option>
                        </Select>
                      ) : (
                        <Badge tone={u.status === 'pending' ? 'warning' : u.status === 'rejected' ? 'critical' : 'success'}>
                          {u.status || 'approved'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {editingUser?.id === u.id ? (
                        <Select
                          value={editingUser.department || ''}
                          onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                          className="h-8 rounded-xl px-2.5 text-xs w-[100px]"
                        >
                          <option value="CCSICT">CCSICT</option>
                          <option value="CAS">CAS</option>
                        </Select>
                      ) : (
                        <Badge tone="neutral">{u.department || 'Unassigned'}</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs opacity-70">{formatDate(u.created_at)}</td>
                    <td className="px-6 py-4 text-right">
                      {u.id !== me?.id && (
                        <div className="flex justify-end gap-2">
                          {u.status === 'pending' && (isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                            <>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-8 py-0 px-3 text-xs text-flame-500 hover:text-flame-600 hover:bg-flame-500/10"
                                onClick={() => {
                                  if (!window.confirm('Are you sure you want to reject this user?')) return
                                  if (myRole === 'superadmin') {
                                    updateUserDetails(u.id, { full_name: u.full_name || u.email.split('@')[0] || 'Unknown', role: u.role, department: u.department, status: 'rejected' })
                                      .then(() => {
                                        queryClient.invalidateQueries({ queryKey: ['users'] })
                                        toast.success('User rejected')
                                      })
                                      .catch(err => toast.error('Failed to reject', { description: apiErrorMessage(err) }))
                                  } else {
                                    updateUserRole(u.id, { role: u.role, status: 'rejected' })
                                      .then(() => {
                                        queryClient.invalidateQueries({ queryKey: ['users'] })
                                        toast.success('User rejected')
                                      })
                                      .catch(err => toast.error('Failed to reject', { description: apiErrorMessage(err) }))
                                  }
                                }}
                              >
                                Reject
                              </Button>
                              <Button 
                                size="sm" 
                                variant="primary" 
                                className="h-8 py-0 px-3 text-xs"
                                onClick={() => {
                                  if (!window.confirm('Are you sure you want to approve this user?')) return
                                  if (myRole === 'superadmin') {
                                    updateUserDetails(u.id, { full_name: u.full_name || u.email.split('@')[0] || 'Unknown', role: u.role, department: u.department, status: 'approved' })
                                      .then(() => {
                                        queryClient.invalidateQueries({ queryKey: ['users'] })
                                        toast.success('User approved')
                                      })
                                      .catch(err => toast.error('Failed to approve', { description: apiErrorMessage(err) }))
                                  } else {
                                    updateUserRole(u.id, { role: u.role, status: 'approved' })
                                      .then(() => {
                                        queryClient.invalidateQueries({ queryKey: ['users'] })
                                        toast.success('User approved')
                                      })
                                      .catch(err => toast.error('Failed to approve', { description: apiErrorMessage(err) }))
                                  }
                                }}
                              >
                                Approve
                              </Button>
                            </>
                          )}
                          {editingUser?.id === u.id ? (
                            <Button size="icon-sm" onClick={() => handleUpdate(u.id, editingUser)} aria-label="Save"><Save size={14} /></Button>
                          ) : (
                            (isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                              <Button size="icon-sm" variant="ghost" onClick={() => setEditingUser(u)} aria-label="Edit"><UserCog size={14} /></Button>
                            )
                          )}
                          {(isSuperadmin || !['admin', 'superadmin'].includes(u.role)) && (
                            <Button size="icon-sm" variant="ghost" className="text-flame-500 hover:text-flame-600 hover:bg-flame-500/10" onClick={() => handleDelete(u.id)} aria-label="Delete"><Trash2 size={14} /></Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls page={userPage} setPage={setUserPage} total={filteredUsers.length} limit={5} />
      </GlassCard>

      <GlassCard className="p-6">
        <div className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
          <TerminalSquare size={13} /> Raw System Logs
        </div>
        <div className="bg-canvas-950 text-white rounded-2xl p-4 font-mono text-[0.65rem] max-h-96 overflow-y-auto space-y-2">
          {loadingLogs ? <div className="opacity-50">Loading system logs...</div> : (
            logs.map(log => (
              <div key={log.id} className="border-b border-white/10 pb-2">
                <span className="text-forest-400">[{new Date(log.created_at).toISOString()}]</span>{' '}
                <span className="text-gold-400">{log.action}</span>{' '}
                <span className="opacity-60">USER:{log.user?.email || log.user_id || 'system'}</span>{' '}
                <span className="text-white/80">{JSON.stringify(log.detail)}</span>
              </div>
            ))
          )}
        </div>
      </GlassCard>

      {myRole === 'superadmin' && (
        <>
          <FeaturePermissionsManagement />
          <DepartmentsManagement />
        </>
      )}

      <GlassCard className="overflow-hidden">
        <div className="border-b border-forest-900/10 px-6 py-4 dark:border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider opacity-70">Database Papers & Buckets</div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
              <Input
                className="pl-9 h-8 text-xs w-[160px] rounded-xl"
                placeholder="Search titles, authors..."
                value={paperSearchQuery}
                onChange={(e) => { setPaperSearchQuery(e.target.value); setPaperPage(1); }}
              />
            </div>
            {isSuperadmin && (
              <Select value={paperDeptFilter} onChange={e => { setPaperDeptFilter(e.target.value); setPaperPage(1); }} className="h-8 rounded-xl px-2.5 text-xs w-[110px]">
                <option value="all">All Depts</option>
                <option value="CCSICT">CCSICT</option>
                <option value="CAS">CAS</option>
              </Select>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-forest-900/5 text-xs font-semibold uppercase tracking-wider opacity-60 dark:bg-white/5">
              <tr>
                <th className="px-6 py-3">Title & Authors</th>
                <th className="px-6 py-3">Dept / Track</th>
                <th className="px-6 py-3">File Link (Bucket)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/5 dark:divide-white/5">
              {loadingPapers ? (
                <tr><td colSpan={3} className="px-6 py-8 text-center opacity-50">Loading database papers...</td></tr>
              ) : filteredPapers.length === 0 ? (
                <tr><td colSpan={3} className="px-6 py-8 text-center opacity-50">No papers found.</td></tr>
              ) : (
                paginatedPapers.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-forest-900/5 dark:hover:bg-white/5">
                    <td className="px-6 py-4 max-w-sm">
                      <div className="font-bold line-clamp-1">{p.title}</div>
                      <div className="text-xs opacity-60 line-clamp-1 mt-0.5">{p.authors || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-1">
                        <Badge tone="neutral">{p.department || 'Unassigned'}</Badge>
                        <Badge tone="forest">{p.track}</Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            const url = await getPaperUrl(p.id);
                            window.open(url, '_blank');
                          } catch (err) {
                            toast.error('Failed to get URL', { description: apiErrorMessage(err) });
                          }
                        }}
                      >
                        <BookMarked size={14} className="mr-1.5" /> Open PDF
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls page={paperPage} setPage={setPaperPage} total={filteredPapers.length} limit={5} />
      </GlassCard>
    </div>
  )
}

export default function Admin() {
  const { user: me, isSuperadmin, displayName, role, department } = useAuth()
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
          <p className="text-sm font-semibold text-gold-500 dark:text-gold-300">
            {displayName} • <span className="capitalize">{role === 'superadmin' ? 'Super Admin at System' : <>{role === 'admin' ? 'Administrator' : role} at {department || 'Unassigned'}</>}</span>
          </p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Institutional <span className="text-gradient-isu">Analytics</span>
          </h1>
          <p className="mt-1 text-sm opacity-55">
            Research usage, archive composition, and access management.
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
          <button
            onClick={() => setActiveTab('system')}
            className={cn(
              "rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300",
              activeTab === 'system' ? "bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-md" : "opacity-60 hover:opacity-100"
            )}
          >
            System Management
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
      ) : activeTab === 'upload_history' ? (
        <UploadHistoryTab />
      ) : activeTab === 'system' ? (
        <SystemManagementTab />
      ) : null}
    </PageTransition>
  )
}
