import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, FileText, Trash2, Layers, AlertTriangle, RefreshCw, UploadCloud, Ban,
  CheckCircle2, Sparkles, PartyPopper, Clock3, XCircle, FileWarning, Loader2,
} from 'lucide-react'
import {
  getDepartments, extractMetadataBatch, uploadBatch, getUploadJobs, cancelUploadJob, apiErrorMessage,
} from '../api'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { Input, Textarea, Select, Field } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { AnimatedCounter, PageTransition, staggerContainer, staggerItem } from '../components/ui/Motion'
import { ConfirmDialog } from '../components/ui/Modal'
import { TableScroller } from '../components/ui/TableScroller'
import { Dropzone } from '../components/upload/Dropzone'
import { RailHeading, WizardRail } from '../components/upload/WizardRail'
import { WizardStep } from '../components/upload/WizardStep'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'
import { THESIS_CATEGORIES } from '../lib/catalog'
import {
  ACTIVE_BATCH_STORAGE_KEY, BATCH_STEPS, BATCH_WIZARD_STEPS, MAX_BATCH_FILES,
  activeJobIds, allTerminal, batchProgress, batchRailMode, batchReducer, batchSummary, createBatchState,
  restoreActiveBatch, serializeActiveBatch, stageLabel, statusLabel, statusTone, validateBatch,
} from './upload/batchState'
import { formatFileSize } from './upload/wizardSteps'

// One read for every job of the batch each tick; the list endpoint sits under
// the global request limit, not the ten-a-minute upload limit.
const POLL_MS = 2000
const MAX_POLL_FAILURES = 5
const POLL_CEILING_MS = 30 * 60 * 1000

/** The wizard's own action bar. Sits at the foot of whichever step is showing. */
function StepActions({ children }) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
      {children}
    </div>
  )
}

function SectionHeading({ id, icon: Icon, title, hint, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300">
          <Icon size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="font-display text-sm font-bold">{title}</h2>
          {hint && <p className="text-xs text-ink-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

/** How full the batch is. Lives in the rail, where the batch's identity is. */
function CapacityMeter({ count, totalBytes }) {
  const percent = Math.round((count / MAX_BATCH_FILES) * 100)
  return (
    <div>
      <RailHeading>Batch</RailHeading>
      <p className="text-xs font-semibold">{count} / {MAX_BATCH_FILES} manuscripts selected</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10" aria-hidden="true">
        <motion.div
          className={cn('h-full rounded-full', count >= MAX_BATCH_FILES ? 'bg-gold-400' : 'bg-forest-600')}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      {count > 0 && <p className="mt-1.5 text-[11px] text-ink-faint">{formatFileSize(totalBytes)} in total</p>}
    </div>
  )
}

function SelectedFiles({ rows, onRemove }) {
  if (rows.length === 0) return null
  return (
    <motion.ul
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mt-5 grid gap-2 sm:grid-cols-2"
      aria-label="Selected manuscripts"
    >
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.li
            key={row.id}
            variants={staggerItem}
            layout
            exit={{ opacity: 0, scale: 0.96 }}
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 text-gold-300">
              <FileText size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" title={row.name}>{row.name}</span>
              <span className="block text-[11px] text-ink-faint">PDF · {formatFileSize(row.size)}</span>
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => onRemove(row.id)} aria-label={`Remove ${row.name}`}>
              <Trash2 size={14} />
            </Button>
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  )
}

function BatchDefaultsForm({ defaults, errors, departments, isSuperadmin, enforcedDepartment, loadingDepts, onChange }) {
  const currentDept = departments.find((d) => d.name === defaults.department)
  const programs = currentDept?.programs || []
  const program = programs.find((item) => item.id === defaults.program_id)
  const specializations = program?.specializations || []
  return (
    <div className="grid gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4 sm:grid-cols-3 sm:p-5">
      <Field label="Thesis category" required hint="Who authored the manuscripts">
        <Select
          value={defaults.thesis_category}
          onChange={(event) => onChange({ thesis_category: event.target.value })}
          aria-label="Select thesis category"
        >
          {THESIS_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </Select>
      </Field>
      <Field
        label="Academic program"
        error={errors.program_id}
        required={defaults.thesis_category !== 'faculty'}
        hint={defaults.thesis_category === 'faculty' ? 'Optional for faculty research' : 'Validated against the official catalog'}
      >
        <Select value={defaults.program_id} onChange={(event) => {
          const next = programs.find((item) => item.id === event.target.value)
          onChange({
            program_id: event.target.value,
            specialization_id: '',
            requires_specialization: Boolean(next?.specializations?.length),
            track: next?.specializations?.length ? '' : (next?.code || ''),
          })
        }} error={errors.program_id} disabled={!defaults.department || programs.length === 0} aria-label="Select academic program">
          <option value="">Select program…</option>
          {programs.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
        </Select>
        {specializations.length > 0 && (
          <Select className="mt-2" value={defaults.specialization_id} onChange={(event) => {
            const next = specializations.find((item) => item.id === event.target.value)
            onChange({ specialization_id: event.target.value, track: next?.name || '' })
          }} error={errors.specialization_id} aria-label="Select academic specialization">
            <option value="">Select specialization…</option>
            {specializations.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Department" error={errors.department} required hint="Archive these manuscripts belong to">
        {isSuperadmin ? (
          <Select value={defaults.department} onChange={(event) => onChange({
            department: event.target.value, track: '', program_id: '', specialization_id: '', requires_specialization: false,
          })} error={errors.department} disabled={loadingDepts} aria-label="Select thesis department">
            <option value="">Select a Department…</option>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
        ) : (
          <div className="flex h-11 items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3">
            <Badge tone="neutral">{enforcedDepartment}</Badge>
          </div>
        )}
      </Field>
    </div>
  )
}

/**
 * A title field that grows to fit what it holds.
 *
 * This used to size itself from `Math.ceil(title.length / N)`, but wrapping
 * happens at word boundaries, so a title that broke badly came up exactly one
 * line short and silently clipped — on the one step whose whole job is letting
 * a reader check the title before it enters the archive. Measured: two of four
 * realistic titles were cut off. No character count can be right; the content's
 * own height can.
 */
function AutoGrowTitle({ value, ...props }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const fit = () => {
      node.style.height = 'auto'
      // Tailwind's preflight is border-box, so `height` has to carry the
      // borders that scrollHeight leaves out or the field lands 2px short.
      const borders = node.offsetHeight - node.clientHeight
      node.style.height = `${node.scrollHeight + borders}px`
    }
    fit()
    // The column narrows with the viewport, which changes the line count.
    // A resize listener rather than a ResizeObserver on the field itself:
    // the callback resizes that very element, which would re-trigger it.
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [value])

  return <Textarea ref={ref} value={value} {...props} />
}

function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-[11px] font-medium text-[var(--destructive)]">{message}</p>
}

function ReviewRow({ row, index, onChange, onRemove }) {
  const set = (key) => (event) => onChange(row.id, key, event.target.value)
  const hasErrors = Object.keys(row.errors).length > 0
  const rejected = Boolean(row.extractError)
  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className={cn(
        'align-top transition-colors',
        rejected ? 'bg-flame-500/5' : hasErrors ? 'bg-gold-400/5' : '',
      )}
    >
      <td className="w-48 px-3 py-3">
        <div className="flex items-start gap-2.5">
          <span className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
            rejected ? 'bg-flame-500/10 text-flame-500' : 'bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300',
          )}>
            {rejected ? <FileWarning size={15} /> : <FileText size={15} />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold" title={row.name}>{row.name}</div>
            <div className="text-[11px] text-ink-faint">{formatFileSize(row.size)}</div>
            <div className="mt-1.5">
              {rejected ? (
                <Badge tone="flame"><XCircle size={11} /> Rejected</Badge>
              ) : row.extracted ? (
                <Badge tone="forest"><Sparkles size={11} /> Autofilled</Badge>
              ) : (
                <Badge tone="neutral">Manual</Badge>
              )}
            </div>
          </div>
        </div>
      </td>
      {rejected ? (
        <td colSpan={3} className="px-3 py-3">
          <div className="flex h-full flex-wrap items-center justify-between gap-3 rounded-xl border border-flame-500/25 bg-flame-500/5 px-4 py-3 text-xs">
            <span className="flex items-center gap-2 text-ink">
              <AlertTriangle size={14} className="shrink-0 text-flame-500" />
              {row.extractError}. Remove this file to continue.
            </span>
            <Button variant="outline" size="sm" onClick={() => onRemove(row.id)} aria-label={`Remove ${row.name}`}>
              <Trash2 size={13} /> Remove file
            </Button>
          </div>
        </td>
      ) : (
        <>
          <td className="min-w-[14rem] px-3 py-3">
            <AutoGrowTitle
              value={row.title}
              onChange={set('title')}
              placeholder="Full official thesis title"
              rows={2}
              error={row.errors.title}
              className="min-h-[3.25rem] resize-none py-2.5 text-sm leading-snug"
              aria-label={`Title for ${row.name}`}
            />
            <FieldError message={row.errors.title} />
          </td>
          <td className="min-w-[10rem] px-3 py-3">
            <Input value={row.authors} onChange={set('authors')} placeholder="Dela Cruz, J., Santos, M." aria-label={`Authors for ${row.name}`} />
          </td>
          <td className="min-w-[5.5rem] px-3 py-3">
            <Input value={row.year} onChange={set('year')} placeholder={`e.g. ${new Date().getFullYear()}`} inputMode="numeric" maxLength={4} error={row.errors.year} aria-label={`Year for ${row.name}`} />
            <FieldError message={row.errors.year} />
          </td>
        </>
      )}
      <td className="w-10 px-2 py-3 text-right">
        {!rejected && (
          <Button variant="ghost" size="icon-sm" onClick={() => onRemove(row.id)} aria-label={`Remove ${row.name}`}>
            <Trash2 size={14} />
          </Button>
        )}
      </td>
    </motion.tr>
  )
}

function ReviewTable({ rows, onChange, onRemove }) {
  return (
    <TableScroller label="Batch metadata review" className="overflow-hidden rounded-2xl border border-[var(--border)]">
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wider text-ink-faint">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Manuscript</th>
            <th className="px-3 py-2.5 font-semibold">Title</th>
            <th className="px-3 py-2.5 font-semibold">Authors</th>
            <th className="px-3 py-2.5 font-semibold">Year</th>
            <th className="px-2 py-2.5"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          <AnimatePresence initial={false}>
            {rows.map((row, index) => (
              <ReviewRow key={row.id} row={row} index={index} onChange={onChange} onRemove={onRemove} />
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </TableScroller>
  )
}

function rowPresentation(row) {
  if (row.submitError) {
    return { tone: 'flame', label: 'Not accepted', message: row.submitError, progress: 0, stage: '' }
  }
  const job = row.job ?? {}
  const status = job.status ?? 'queued'
  return {
    tone: statusTone(status),
    label: statusLabel(status),
    message: job.error || job.message || '',
    progress: job.progress ?? 0,
    stage: status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'expired' ? '' : stageLabel(job.stage),
  }
}

function StatusIcon({ status, submitError }) {
  if (submitError) return <XCircle size={14} className="text-flame-500" />
  if (status === 'completed') return <CheckCircle2 size={14} className="text-forest-600 dark:text-gold-300" />
  if (status === 'failed' || status === 'expired') return <XCircle size={14} className="text-flame-500" />
  if (status === 'cancelled') return <Ban size={14} className="text-flame-500" />
  if (status === 'retry_wait') return <Clock3 size={14} className="text-gold-500" />
  if (status === 'processing') return <Loader2 size={14} className="animate-spin text-forest-600 dark:text-gold-300" />
  return <Clock3 size={14} className="text-ink-faint" />
}

function ProgressRow({ row, onCancel }) {
  const { tone, label, message, progress, stage } = rowPresentation(row)
  const status = row.job?.status
  const canCancel = Boolean(row.jobId && row.job?.can_cancel && !row.job?.cancel_requested)
  return (
    <tr className="align-top">
      <td className="max-w-[16rem] px-3 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 dark:bg-gold-400/15">
            <StatusIcon status={status} submitError={row.submitError} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold" title={row.title || row.name}>{row.title || row.name}</div>
            <div className="truncate text-[11px] text-ink-faint" title={row.name}>{row.name}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3"><Badge tone={tone}>{label}</Badge></td>
      <td className="min-w-[11rem] px-3 py-3">
        <div className="h-2 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress for ${row.name}`}>
          <motion.div
            className={cn(
              'h-full rounded-full',
              status === 'completed'
                ? 'bg-forest-600'
                : row.submitError || status === 'failed' || status === 'expired' || status === 'cancelled'
                  ? 'bg-flame-500/60'
                  : 'bg-gradient-to-r from-forest-600 via-forest-500 to-gold-400',
            )}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
          <span>{stage}</span>
          <span>{progress}%</span>
        </div>
      </td>
      <td className="min-w-[14rem] px-3 py-3 text-xs text-ink-muted">
        {message}
        {status === 'retry_wait' && (
          <div className="mt-1 text-[11px] text-gold-600 dark:text-gold-300">Automatic retry {row.job.attempt_count}/{row.job.max_attempts}</div>
        )}
        {status === 'completed' && row.job.chunks != null && (
          <div className="mt-1 text-[11px]">{row.job.chunks} embedded chunks</div>
        )}
      </td>
      <td className="px-2 py-3 text-right">
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={() => onCancel(row)} aria-label={`Cancel upload of ${row.name}`}>
            <Ban size={13} /> Cancel
          </Button>
        )}
      </td>
    </tr>
  )
}

function ProgressTable({ rows, onCancel }) {
  return (
    <TableScroller label="Batch ingestion progress" className="overflow-hidden rounded-2xl border border-[var(--border)]">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wider text-ink-faint">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Manuscript</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Progress</th>
            <th className="px-3 py-2.5 font-semibold">Details</th>
            <th className="px-2 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => <ProgressRow key={row.id} row={row} onCancel={onCancel} />)}
        </tbody>
      </table>
    </TableScroller>
  )
}

/**
 * The four counts. The headline bar and percentage that used to sit above them
 * moved to the rail, which now carries the progressbar semantics too — the same
 * number in two places on one screen was never telling anyone anything new.
 */
function BatchOverview({ summary }) {
  const inProgress = summary.queued + summary.processing + summary.retrying
  const problems = summary.failed + summary.expired + summary.cancelled
  const tiles = [
    { label: 'Indexed', value: summary.completed, icon: CheckCircle2, tone: 'text-forest-700 dark:text-gold-300' },
    { label: 'In progress', value: inProgress, icon: Loader2, tone: 'text-ink', spin: inProgress > 0 },
    { label: 'Failed', value: problems, icon: XCircle, tone: problems ? 'text-[var(--destructive)]' : 'text-ink-faint' },
    { label: 'Not accepted', value: summary.rejected, icon: FileWarning, tone: summary.rejected ? 'text-[var(--destructive)]' : 'text-ink-faint' },
  ]
  return (
    <section aria-label="Batch summary">
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <motion.div
            key={tile.label}
            variants={staggerItem}
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-3.5"
          >
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 dark:bg-gold-400/10', tile.tone)}>
              <tile.icon size={16} className={tile.spin ? 'animate-spin' : ''} />
            </span>
            <span>
              <span className={cn('block font-display text-2xl font-extrabold leading-none', tile.tone)}>
                <AnimatedCounter value={tile.value} />
              </span>
              <span className="block text-[11px] uppercase tracking-wide text-ink-faint">{tile.label}</span>
            </span>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}

function FinishedBanner({ summary }) {
  const allGood = summary.completed === summary.total
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-center gap-4 rounded-2xl border px-5 py-4',
        allGood ? 'border-forest-600/25 bg-forest-600/5' : 'border-gold-400/35 bg-gold-400/10',
      )}
    >
      <span className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg',
        allGood ? 'bg-gradient-to-br from-forest-600 to-forest-800 shadow-forest-900/25' : 'bg-gradient-to-br from-gold-300 to-gold-400 text-forest-950 shadow-gold-400/30',
      )}>
        {allGood ? <PartyPopper size={22} /> : <AlertTriangle size={22} />}
      </span>
      <div>
        <div className="font-display text-lg font-extrabold">
          {allGood ? 'Batch indexed!' : 'Batch finished with issues'}
        </div>
        <p className="text-sm text-ink-muted">
          {summary.completed} of {summary.total} manuscripts are now part of the semantic archive.
          {!allGood && ' Rows marked failed or not accepted can be resubmitted individually.'}
        </p>
      </div>
    </motion.div>
  )
}

/** The batch once it is in the workers' hands: counts, per-row rows, recovery. */
function IngestingStep({
  rows, summary, finished, pollError, submitting, rejectedRows,
  onCancel, onResumePolling, onRetryRejected, onReset, onViewArchive,
}) {
  return (
    <div className="space-y-6">
      {finished && <FinishedBanner summary={summary} />}
      <BatchOverview summary={summary} />
      <ProgressTable rows={rows} onCancel={onCancel} />
      {pollError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-400/35 bg-gold-400/10 px-4 py-3 text-xs">
          <span>{pollError}</span>
          <Button variant="ghost" size="sm" onClick={onResumePolling}>
            <RefreshCw size={13} aria-hidden="true" /> Resume status check
          </Button>
        </div>
      )}
      {/* Only while work is outstanding. Once it is done the banner above, the
          rail's ring and this line all reported the same count three times. */}
      {!finished && (
        <p className="text-center text-sm text-ink-muted">
          The durable worker processes these in the background. You can leave and come back;
          refreshing keeps this view.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {rejectedRows.length > 0 && (
          <Button variant="secondary" loading={submitting} onClick={onRetryRejected}>
            <RefreshCw size={14} aria-hidden="true" /> Retry {rejectedRows.length} rejected
          </Button>
        )}
        <Button variant="ghost" onClick={onReset}>
          <Layers size={14} aria-hidden="true" /> Upload another batch
        </Button>
        <Button onClick={onViewArchive}>View archive</Button>
      </div>
    </div>
  )
}

function readStoredBatch() {
  try {
    return restoreActiveBatch(sessionStorage.getItem(ACTIVE_BATCH_STORAGE_KEY))
  } catch {
    return null
  }
}

function writeStoredBatch(rows) {
  try {
    if (allTerminal(rows)) sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY)
    else sessionStorage.setItem(ACTIVE_BATCH_STORAGE_KEY, serializeActiveBatch(rows))
  } catch {
    // Storage may be unavailable (private mode); the page still works without resume.
  }
}

export default function UploadBatch() {
  const { isSuperadmin, department: userDepartment } = useAuth()
  const enforcedDepartment = userDepartment || 'CCSICT'
  const [state, dispatch] = useReducer(batchReducer, enforcedDepartment, createBatchState)
  const { step, direction, rows, defaults, defaultErrors, extracting, submitting, uploadProgress } = state
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  // Polling pauses on its own after repeated failures (derived from the query)
  // or after the 30-minute ceiling (a timer flips this flag from its callback).
  const [ceilingReached, setCeilingReached] = useState(false)
  const pollStartedRef = useRef(0)
  const restoredRef = useRef(false)
  const invalidatedRef = useRef(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: departments = [],
    isLoading: loadingDepts,
    isError: departmentsError,
    refetch: retryDepartments,
  } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  useEffect(() => {
    if (!isSuperadmin) {
      dispatch({ type: 'set-defaults', value: (current) => ({ ...current, department: enforcedDepartment }) })
    }
  }, [enforcedDepartment, isSuperadmin])

  // Resume a batch whose jobs were queued before a refresh. Only the job ids
  // and titles survive; the files themselves cannot be restored.
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const stored = readStoredBatch()
    if (stored) {
      pollStartedRef.current = Date.now()
      dispatch({ type: 'restore', rows: stored })
    }
  }, [])

  useEffect(() => {
    if (step === BATCH_STEPS.ingesting) writeStoredBatch(rows)
  }, [rows, step])

  const ids = activeJobIds(rows)
  const idsKey = ids.join(',')
  const hasActiveJobs = step === BATCH_STEPS.ingesting && ids.length > 0
  const jobsQuery = useQuery({
    queryKey: ['upload-batch-jobs', idsKey],
    queryFn: () => getUploadJobs(idsKey.split(',')),
    enabled: hasActiveJobs && !ceilingReached,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (
      hasActiveJobs && !ceilingReached && query.state.fetchFailureCount < MAX_POLL_FAILURES ? POLL_MS : false
    ),
  })
  const { data: polledJobs, failureCount: pollFailures, refetch: refetchJobs } = jobsQuery
  const failurePaused = pollFailures >= MAX_POLL_FAILURES
  const pollError = !hasActiveJobs
    ? ''
    : ceilingReached
      ? 'Status checking paused after 30 minutes. The worker keeps running.'
      : failurePaused
        ? 'The server could not confirm the batch status. No job was cancelled.'
        : ''

  useEffect(() => {
    if (polledJobs) dispatch({ type: 'apply-job-statuses', jobs: polledJobs })
  }, [polledJobs])

  useEffect(() => {
    if (!hasActiveJobs || ceilingReached) return undefined
    const remaining = POLL_CEILING_MS - (Date.now() - pollStartedRef.current)
    const timer = setTimeout(() => setCeilingReached(true), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [hasActiveJobs, ceilingReached])

  const summary = batchSummary(rows)
  useEffect(() => {
    if (summary.completed > 0 && !invalidatedRef.current) {
      invalidatedRef.current = true
      queryClient.invalidateQueries({ queryKey: ['papers'] })
    }
  }, [summary.completed, queryClient])

  const setStep = (value) => dispatch({ type: 'set-step', step: value })
  const updateDefaults = (patch) => dispatch({ type: 'set-defaults', value: (current) => ({ ...current, ...patch }) })
  const changeRow = (id, key, value) => dispatch({ type: 'set-row-field', id, key, value })
  const removeRow = (id) => dispatch({ type: 'remove-row', id })

  const continueToReview = async () => {
    if (rows.length === 0) return
    dispatch({ type: 'set-extracting', value: true })
    toast.info('Extracting metadata from the title pages…')
    try {
      const response = await extractMetadataBatch(rows.map((row) => row.file))
      dispatch({ type: 'apply-extraction', files: response.files })
      const rejected = response.files.filter((entry) => entry.error).length
      if (rejected) {
        toast.warning(`${rejected} file${rejected === 1 ? ' was' : 's were'} rejected`, {
          description: 'Remove the rejected rows before ingesting.',
        })
      } else {
        toast.success('Metadata autofilled', { description: 'Review each row before ingesting.' })
      }
    } catch (error) {
      toast.warning('Metadata extraction unavailable', { description: apiErrorMessage(error, 'Fill in the rows manually.') })
    } finally {
      dispatch({ type: 'set-extracting', value: false })
      setStep(BATCH_STEPS.review)
    }
  }

  const submitRows = async (targets) => {
    const validation = validateBatch(targets, defaults)
    dispatch({ type: 'set-row-errors', errorsById: validation.rowErrorsById })
    dispatch({ type: 'set-default-errors', errors: validation.defaultErrors })
    if (!validation.valid) {
      toast.error('Check the highlighted fields')
      return
    }
    if (targets.some((row) => !row.file)) {
      toast.error('Files unavailable', { description: 'Select the manuscripts again to resubmit them.' })
      return
    }
    dispatch({ type: 'set-submitting', value: true })
    dispatch({ type: 'set-upload-progress', value: 0 })
    try {
      const response = await uploadBatch({
        files: targets.map((row) => row.file),
        rows: targets.map((row) => ({
          title: row.title.trim(), authors: row.authors.trim(), year: row.year.trim(),
          idempotency_key: row.idempotencyKey,
        })),
        defaults,
        onUploadProgress: (event) => {
          if (event.total) dispatch({ type: 'set-upload-progress', value: Math.round((event.loaded / event.total) * 100) })
        },
      })
      dispatch({ type: 'apply-submit-results', results: response.results, rowIds: targets.map((row) => row.id) })
      if (pollStartedRef.current === 0) pollStartedRef.current = Date.now()
      setCeilingReached(false)
      setStep(BATCH_STEPS.ingesting)
      const accepted = response.results.filter((result) => result.job_id).length
      const rejected = response.results.length - accepted
      if (rejected) {
        toast.warning(`${accepted} of ${response.results.length} manuscripts queued`, {
          description: 'The rest were not accepted; see each row for the reason.',
        })
      } else {
        toast.success(`${accepted} manuscript${accepted === 1 ? '' : 's'} queued for ingestion`)
      }
    } catch (error) {
      toast.error('Batch upload failed', { description: apiErrorMessage(error) })
    } finally {
      dispatch({ type: 'set-submitting', value: false })
    }
  }

  const rejectedRows = rows.filter((row) => row.submitError && row.file)
  const extractionRejects = rows.filter((row) => row.extractError)
  const autofilled = rows.filter((row) => row.extracted && !row.extractError).length

  const confirmCancellation = async () => {
    const row = cancelTarget
    if (!row?.jobId) return
    setCancelling(true)
    try {
      const result = await cancelUploadJob(row.jobId, 'Cancelled by uploader')
      dispatch({
        type: 'set-row-field', id: row.id, key: 'job',
        value: {
          ...(row.job ?? {}), status: result.status || row.job?.status, cancel_requested: result.cancel_requested,
          cancelled_at: result.cancelled_at, can_cancel: false, message: result.message,
        },
      })
      toast.success(result.message)
    } catch (error) {
      toast.error('Cancellation failed', { description: apiErrorMessage(error) })
    } finally {
      setCancelling(false)
      setCancelTarget(null)
    }
  }

  const reset = () => {
    try { sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY) } catch { /* storage unavailable */ }
    pollStartedRef.current = 0
    invalidatedRef.current = false
    setCeilingReached(false)
    dispatch({ type: 'reset', department: enforcedDepartment })
  }

  const resumePolling = () => {
    pollStartedRef.current = Date.now()
    setCeilingReached(false)
    // A successful refetch resets the query's failure count, which re-arms the interval.
    refetchJobs()
  }

  const finished = step === BATCH_STEPS.ingesting && allTerminal(rows)
  const totalBytes = rows.reduce((sum, row) => sum + (row.size || 0), 0)
  const railMode = batchRailMode(step)
  const progress = batchProgress(rows)

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Batch <span className="text-gradient-isu">Upload</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Ingest several thesis manuscripts at once. Titles, authors, and years are read from each title page;
            the category, program, and department are shared by the whole batch.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/upload')}>
          <ArrowLeft size={14} /> Single upload
        </Button>
      </div>

      <GlassCard className="overflow-hidden p-0">
        <div className="grid lg:grid-cols-[16rem_minmax(0,1fr)]">
          <WizardRail
            steps={BATCH_WIZARD_STEPS}
            step={step}
            mode={railMode}
            progress={progress}
            progressLabel="Overall batch progress"
            statusLabel={finished ? 'Finished' : 'Ingesting'}
            caption={`${summary.completed} of ${summary.total} indexed`}
            onSelectStep={step < BATCH_STEPS.ingesting ? setStep : undefined}
          >
            {railMode === 'summary' && <CapacityMeter count={rows.length} totalBytes={totalBytes} />}
          </WizardRail>

          <div className="min-w-0 p-5 sm:p-7">
            {departmentsError && (
              <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-flame-500/25 bg-flame-500/10 p-3 text-xs">
                <span className="flex items-center gap-2"><AlertTriangle size={14} aria-hidden="true" /> Department metadata is unavailable.</span>
                <Button variant="ghost" size="sm" onClick={() => retryDepartments()}>Retry</Button>
              </div>
            )}

            <WizardStep stepKey={step} direction={direction}>
              {step === BATCH_STEPS.files && (
                <>
                  <Dropzone
                    multiple
                    disabled={rows.length >= MAX_BATCH_FILES}
                    onFiles={(files) => dispatch({ type: 'add-rows', files })}
                  />
                  <SelectedFiles rows={rows} onRemove={removeRow} />
                  <StepActions>
                    <p className="text-xs text-ink-faint">
                      {rows.length === 0
                        ? 'Choose one or more PDFs to continue.'
                        : 'Title pages are read next, then you check every record.'}
                    </p>
                    <Button disabled={rows.length === 0 || extracting} loading={extracting} onClick={continueToReview} className="group">
                      {extracting ? 'Reading title pages…' : 'Continue'}
                      <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Button>
                  </StepActions>
                </>
              )}

              {step === BATCH_STEPS.review && (
                <div className="space-y-7">
              <section aria-labelledby="batch-shared-heading">
                <SectionHeading id="batch-shared-heading" icon={Layers} title="Shared classification" hint="Set once, applied to every manuscript below" />
                <BatchDefaultsForm
                  defaults={defaults}
                  errors={defaultErrors}
                  departments={departments}
                  isSuperadmin={isSuperadmin}
                  enforcedDepartment={enforcedDepartment}
                  loadingDepts={loadingDepts}
                  onChange={updateDefaults}
                />
              </section>

              <section aria-labelledby="batch-rows-heading">
                <SectionHeading
                  id="batch-rows-heading"
                  icon={Sparkles}
                  title="Manuscript metadata"
                  hint={`${autofilled} of ${rows.length} autofilled from the title page. Edit anything that reads wrong.`}
                >
                  {extractionRejects.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => extractionRejects.forEach((row) => removeRow(row.id))}>
                      <Trash2 size={13} /> Remove {extractionRejects.length} rejected
                    </Button>
                  )}
                </SectionHeading>
                {defaultErrors.rows && <p role="alert" className="mb-2 text-xs text-[var(--destructive)]">{defaultErrors.rows}</p>}
                <ReviewTable rows={rows} onChange={changeRow} onRemove={removeRow} />
              </section>

              {submitting && (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                    <div className="h-full rounded-full bg-gradient-to-r from-forest-600 via-forest-500 to-gold-400 transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="mt-1 text-center text-xs text-ink-muted">Uploading manuscripts… {uploadProgress}%</p>
                </div>
              )}
                  <StepActions>
                    <Button variant="ghost" onClick={() => setStep(BATCH_STEPS.files)} disabled={submitting}>
                      <ArrowLeft size={15} aria-hidden="true" /> Back
                    </Button>
                    <div className="flex items-center gap-3">
                      <span className="hidden text-xs text-ink-faint sm:inline">Each manuscript becomes its own durable job.</span>
                      {/* Primary, not the gold container variant, matching the
                          single wizard: gold resolves to --secondary-container
                          and reads quieter than the decisive action deserves. */}
                      <Button loading={submitting} disabled={rows.length === 0} onClick={() => submitRows(rows)}>
                        <UploadCloud size={16} aria-hidden="true" /> Ingest {rows.length} manuscript{rows.length === 1 ? '' : 's'}
                      </Button>
                    </div>
                  </StepActions>
                </div>
              )}

              {step === BATCH_STEPS.ingesting && (
                <IngestingStep
                  rows={rows}
                  summary={summary}
                  finished={finished}
                  pollError={pollError}
                  submitting={submitting}
                  rejectedRows={rejectedRows}
                  onCancel={setCancelTarget}
                  onResumePolling={resumePolling}
                  onRetryRejected={() => submitRows(rejectedRows)}
                  onReset={reset}
                  onViewArchive={() => navigate('/archive')}
                />
              )}
            </WizardStep>
          </div>
        </div>
      </GlassCard>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancellation}
        title="Cancel this upload?"
        message="The worker will stop safely, the manuscript will not be indexed, and its staged private copy will be cleaned up."
        confirmLabel="Cancel upload"
        danger
        loading={cancelling}
      />
    </PageTransition>
  )
}
