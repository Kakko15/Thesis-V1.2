import { motion, AnimatePresence } from 'framer-motion'
import { Search, BookMarked, Trash2, Library, Lock, X, ShieldAlert, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { GlassCard } from '../components/ui/GlassCard'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { ConfirmDialog, Modal } from '../components/ui/Modal'
import { PageTransition, staggerContainer, staggerItem } from '../components/ui/Motion'
import { Button } from '../components/ui/Button'
import { formatDate, normalizePercent, scanMetrics, verdictLabel } from '../lib/utils'
import { slotKeys } from '../lib/keys'
import { useArchiveCatalog } from './archive/useArchiveCatalog'

const ARCHIVE_SKELETONS = slotKeys(6, 'archive-card')

function ScreeningDetail({ scan }) {
  if (!scan?.flagged) return null
  const metrics = scanMetrics(scan)
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">
        Duplication screening (at upload)
      </div>
      <div className="mt-1.5 rounded-xl border border-flame-500/25 bg-flame-500/8 px-3.5 py-2.5 text-xs leading-relaxed">
        <div className="flex items-center gap-1.5 font-semibold">
          <ShieldAlert size={13} className="shrink-0 text-flame-500" />
          {verdictLabel(metrics.verdict)}
        </div>
        <div className="mt-2 grid gap-1 opacity-75 sm:grid-cols-2">
          <span>Highest passage similarity: {metrics.highest.toFixed(2)}%</span>
          <span>Matched chunk coverage: {metrics.coverage.toFixed(2)}%</span>
          <span>Matched chunks / total chunks: {metrics.matchedChunks} / {metrics.totalChunks}</span>
          <span>Threshold: {normalizePercent(scan.threshold).toFixed(2)}%</span>
        </div>
        <ul className="mt-1.5 space-y-0.5 opacity-75">
          {(scan.matched_papers || []).map((p) => (
            <li key={p.id}>
              "{p.title || 'Untitled thesis'}"{p.year ? ` (${p.year})` : ''} — highest passage {normalizePercent(p.similarity).toFixed(2)}%
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function PaperCard({ paper, isAdmin, onDelete, onOpen }) {
  const screening = scanMetrics(paper.duplication_scan)
  return (
    <motion.div variants={staggerItem} layout>
      <GlassCard
        hover
        role="button"
        tabIndex={0}
        aria-label={`View metadata for ${paper.title}`}
        className="group flex h-full cursor-pointer flex-col p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        onClick={() => onOpen(paper)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(paper)
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-md">
            <BookMarked size={16} className="text-gold-300" />
          </div>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(paper) }}
              aria-label="Delete paper"
              className="rounded-lg p-1.5 text-flame-500 opacity-0 transition-opacity hover:bg-flame-500/10 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
        <h3 className="font-display mt-3.5 line-clamp-2 text-sm font-bold leading-snug">
          {paper.title}
        </h3>
        <p className="mt-1.5 line-clamp-1 text-xs text-ink-muted">
          {paper.authors || 'Unknown authors'}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
          {paper.track && <Badge tone="forest">{paper.track}</Badge>}
          {paper.year && <Badge tone="neutral">{paper.year}</Badge>}
          {paper.department && <Badge tone="neutral">{paper.department}</Badge>}
          {paper.duplication_scan?.flagged && (
            <Badge tone="flame">
              <ShieldAlert size={11} /> {screening.coverage.toFixed(2)}% matched coverage
            </Badge>
          )}
        </div>
      </GlassCard>
    </motion.div>
  )
}

function ArchiveResults({
  isLoading,
  isError,
  filtered,
  papers,
  isAdmin,
  onDelete,
  onOpen,
  onClear,
  onRetry,
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ARCHIVE_SKELETONS.map((slotId) => <Skeleton key={slotId} className="h-44" />)}
      </div>
    )
  }
  if (isError) {
    return (
      <GlassCard>
        <EmptyState
          icon={AlertTriangle}
          title="Archive unavailable"
          message="The archive could not be loaded. Check the backend and database configuration, then try again."
          action={<Button variant="secondary" size="sm" onClick={onRetry}>Retry archive</Button>}
        />
      </GlassCard>
    )
  }
  if (filtered.length === 0) {
    const hasPapers = Boolean(papers?.length)
    return (
      <GlassCard>
        <EmptyState
          icon={Library}
          title={hasPapers ? 'No matches found' : 'The archive is empty'}
          message={hasPapers
            ? 'Try different keywords or clear the filters.'
            : 'Indexed theses will appear here once an administrator uploads them.'}
          action={hasPapers ? (
            <Button variant="secondary" size="sm" onClick={onClear}>
              <X size={14} /> Clear filters
            </Button>
          ) : null}
        />
      </GlassCard>
    )
  }
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <AnimatePresence>
        {filtered.map((paper) => (
          <PaperCard
            key={paper.id}
            paper={paper}
            isAdmin={isAdmin}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  )
}

export default function Archive() {
  const { isAdmin, isSuperadmin, department: userDepartment } = useAuth()
  const archive = useArchiveCatalog({ isSuperadmin, userDepartment })
  const {
    papers, isLoading, isError: papersError, departments, years, filtered,
    filters, setFilter, clearFilters, activeTracks, trackLabel,
    programs, specializations, refetch,
    deleteTarget, setDeleteTarget, detail, setDetail, busy, submitDelete,
  } = archive
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Thesis <span className="text-gradient-isu">Archive</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Metadata catalog of every indexed thesis.
          </p>
        </div>
        <div className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-ink-muted">
          <Lock size={12} className="text-gold-400" />
          Indirect access — full manuscripts are never exposed
        </div>
      </div>

      {/* Filters */}
      <GlassCard className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-12">
        <div className="relative sm:col-span-2 lg:col-span-4">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
          <Input
            className="pl-11"
            placeholder="Search titles, authors, abstracts…"
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
          />
        </div>
        {programs.length > 0 ? (
          <Select value={filters.program_id} onChange={(e) => setFilter('program_id', e.target.value)} className="lg:col-span-2" aria-label="Filter by academic program">
            <option value="">All programs</option>
            {programs.map((program) => <option key={program.id} value={program.id}>{program.code} — {program.name}</option>)}
          </Select>
        ) : activeTracks.length > 0 ? (
          <Select value={filters.track} onChange={(e) => setFilter('track', e.target.value)} className="lg:col-span-2" aria-label={`Filter by ${trackLabel}`}>
            <option value="">All {trackLabel}s</option>
            {activeTracks.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        ) : null}
        {specializations.length > 0 && (
          <Select value={filters.specialization_id} onChange={(e) => setFilter('specialization_id', e.target.value)} className="lg:col-span-2" aria-label="Filter by academic specialization">
            <option value="">All specializations</option>
            {specializations.map((specialization) => (
              <option key={specialization.id} value={specialization.id}>{specialization.code} — {specialization.name}</option>
            ))}
          </Select>
        )}
        {isSuperadmin && (
          <Select value={filters.department} onChange={(e) => setFilter('department', e.target.value)} className="lg:col-span-2" aria-label="Filter by department">
            <option value="">All depts</option>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
        )}
        <Select value={filters.year} onChange={(e) => setFilter('year', e.target.value)} className="lg:col-span-2" aria-label="Filter by year">
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </GlassCard>

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p className="text-xs font-medium text-ink-muted">
          Showing {filtered.length} of {papers.length} indexed {papers.length === 1 ? 'thesis' : 'theses'}
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}><X size={14} /> Clear active filters</Button>
        )}
      </div>

      {/* Grid */}
      <ArchiveResults
        isLoading={isLoading}
        isError={papersError}
        filtered={filtered}
        papers={papers}
        isAdmin={isAdmin}
        onDelete={setDeleteTarget}
        onOpen={setDetail}
        onClear={clearFilters}
        onRetry={() => refetch()}
      />

      {/* Detail modal — metadata only (indirect access model) */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title} size="lg">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {detail?.track && <Badge tone="forest">{detail.track}</Badge>}
            {detail?.department && <Badge tone="neutral">{detail.department}</Badge>}
            {detail?.year && <Badge tone="gold">{detail.year}</Badge>}
            <Badge tone="neutral">Indexed {formatDate(detail?.created_at)}</Badge>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">Authors</div>
            <p className="mt-1 text-sm">{detail?.authors || 'Unknown'}</p>
          </div>
          {detail?.abstract && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">Abstract</div>
              <p className="mt-1 max-h-56 overflow-y-auto text-sm leading-relaxed opacity-80">
                {detail.abstract}
              </p>
            </div>
          )}
          <ScreeningDetail scan={detail?.duplication_scan} />
          <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs text-ink-muted">
            <Lock size={13} className="shrink-0 text-gold-400" />
            Full text is available only through AI-mediated synthesis in Chat — this protects the
            author's intellectual property.
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={submitDelete}
        title="Remove thesis from the archive?"
        message={`"${deleteTarget?.title}" and all of its vector embeddings will be permanently deleted.`}
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </PageTransition>
  )
}
