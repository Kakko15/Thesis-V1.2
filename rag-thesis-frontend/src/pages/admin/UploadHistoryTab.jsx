import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { Brain, ChevronRight, Database, FileText, ScanText, Scissors, Search } from 'lucide-react'
import { getDepartments, getTracks, listPapers } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { GlassCard } from '../../components/ui/GlassCard'
import { Badge } from '../../components/ui/Badge'
import { Input, Select } from '../../components/ui/Input'
import { cn, formatDate } from '../../lib/utils'

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

export default function UploadHistoryTab() {
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
            placeholder="Search titles or authorsâ€¦"
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

