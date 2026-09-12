import { lazy, Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, FileText, Trash2, Layers, AlertTriangle, RefreshCw, UploadCloud, Ban,
  CheckCircle2, Sparkles, PartyPopper, Clock3, XCircle, FileWarning, Loader2, Lock,
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
import { WizardStepper } from '../components/upload/WizardStepper'
import { WizardStep } from '../components/upload/WizardStep'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'
import {
  THESIS_CATEGORIES, departmentPrograms, programSelectionById, specializationSelection,
} from '../lib/catalog'
import {
  ACTIVE_BATCH_STORAGE_KEY, BATCH_STEPS, BATCH_WIZARD_STEPS, MAX_BATCH_FILES,
  activeJobIds, allTerminal, batchProgress, batchReducer, batchSummary, createBatchState,
  restoreActiveBatch, serializeActiveBatch, stageLabel, statusLabel, statusTone, validateBatch,
} from './upload/batchState'
import { formatFileSize } from './upload/wizardSteps'

const IngestScene3D = lazy(() => import('../components/three/IngestScene3D'))

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

function SectionHeading({ id, icon: Icon, title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)]/60 pb-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300 ring-1 ring-forest-500/20 shadow-xs">
          <Icon size={15} aria-hidden="true" />
        </span>
        <h2 id={id} className="font-display text-sm font-bold text-ink">{title}</h2>
      </div>
      {children}
    </div>
  )
}

/** How full the batch is. Compact, modern Material 3 status badge. */
function CapacityMeter({ count, totalBytes }) {
  const percent = Math.round((count / MAX_BATCH_FILES) * 100)
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/80 px-4 py-2 shadow-xs backdrop-blur-xs">
      <div>
        <p className="text-xs font-bold text-ink whitespace-nowrap">
          {count} / {MAX_BATCH_FILES} manuscripts selected
        </p>
        <p className="text-[10px] font-medium text-ink-muted">
          {count > 0 ? `${formatFileSize(totalBytes)} in total` : 'Ready for upload'}
        </p>
      </div>
      <div className="w-16 sm:w-20 h-2 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10" aria-hidden="true">
        <motion.div
          className={cn('h-full rounded-full', count >= MAX_BATCH_FILES ? 'bg-gold-400' : 'bg-gradient-to-r from-forest-600 to-forest-500')}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
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

/**
 * What the whole batch really shares.
 *
 * The academic program used to sit here too, which is why ingesting a shelf of
 * theses meant one batch per degree. It moved into the table, one picker per
 * manuscript; these two are shared because they genuinely are — the backend
 * pins the department for everyone but a superadmin.
 */
function BatchDefaultsForm({ defaults, errors, departments, isSuperadmin, enforcedDepartment, loadingDepts, onChange }) {
  // nameFromLabel={false} on the Selects: Field would otherwise lend its
  // visible label as aria-labelledby, which outranks the aria-label the batch
  // journey matches these comboboxes by (e2e/critical-flows.spec.js).
  return (
    <div className="grid gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4 sm:grid-cols-2 sm:p-5">
      <Field label="Thesis category" required nameFromLabel={false}>
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
      {isSuperadmin ? (
        <Field
          label="Department"
          error={errors.department}
          required
          nameFromLabel={false}
        >
          <Select
            value={defaults.department}
            onChange={(event) => onChange({ department: event.target.value })}
            error={errors.department}
            disabled={loadingDepts}
            aria-label="Select thesis department"
          >
            <option value="">Select a Department…</option>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
        </Field>
      ) : (
        /* Pinned to the uploader's own department by the backend, so this reads
           out a fact rather than taking input. The lock and "Assigned" say why
           it cannot be changed; it used to be a bare Badge in an input-shaped
           box under a required asterisk. */
        <Field label="Department">
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-[var(--foreground)]">
            <Lock size={14} aria-hidden="true" />
            {enforcedDepartment}
            <span className="ml-auto text-xs font-medium uppercase tracking-wider text-ink-faint">Assigned</span>
          </div>
        </Field>
      )}
    </div>
  )
}

/**
 * Set one program across every row at once.
 *
 * Per-manuscript programs are what a mixed shelf needs, but a shelf from a
 * single program is still the common case, and twenty identical dropdowns to
 * say so would trade one chore for a worse one. Explicitly a bulk edit rather
 * than a default the rows inherit: after it runs, each row owns its value and
 * shows it, so there is one place to read what a manuscript will be filed as.
 */
function ProgramBulkBar({ programs, disabled, onApply }) {
  const [selection, setSelection] = useState({ program_id: '', specialization_id: '' })
  const program = programs.find((item) => item.id === selection.program_id)
  const specializations = program?.specializations || []
  // Keyed off the resolved program, not the raw id: a superadmin switching
  // department remounts this bar, but the guard must hold even before that, or
  // "Apply to all" could stamp every row with a program of the old college.
  const incomplete = !program || (specializations.length > 0 && !selection.specialization_id)

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-1)] p-3">
      <span className="min-w-0 basis-full text-xs font-semibold uppercase tracking-wider text-ink-muted sm:basis-auto sm:shrink-0">
        Same program for all
      </span>
      <div className="min-w-[11rem] flex-1">
        <Select
          value={selection.program_id}
          onChange={(event) => setSelection(programSelectionById(programs, event.target.value))}
          disabled={disabled || programs.length === 0}
          aria-label="Select a program for every manuscript"
        >
          <option value="">Select program…</option>
          {programs.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
        </Select>
      </div>
      {specializations.length > 0 && (
        <div className="min-w-[11rem] flex-1">
          <Select
            value={selection.specialization_id}
            onChange={(event) => setSelection((current) => ({
              ...current, ...specializationSelection(specializations, event.target.value),
            }))}
            aria-label="Select a specialization for every manuscript"
          >
            <option value="">Select specialization…</option>
            {specializations.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
          </Select>
        </div>
      )}
      <Button variant="outline" size="sm" className="shrink-0" disabled={disabled || incomplete} onClick={() => onApply(selection)}>
        Apply to all rows
      </Button>
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

/**
 * The error line for a row cell whose control does not render its own.
 *
 * `Input` and `Textarea` only emit their `FieldErrorHint` when they are given a
 * `label`; these cells label themselves with `CardLabel` plus an `aria-label`,
 * so the bare branch renders nothing and the message has to come from here.
 * `Select` is the exception -- it renders its hint whenever it has an `error`,
 * and that copy is what its `aria-describedby` points at -- so the program and
 * specialization cells deliberately do not use this. Rendering both put the
 * same sentence on screen twice, announced it twice, and tripped a strict-mode
 * violation in the batch upload E2E on 2026-09-09.
 *
 * Styled to match `FieldErrorHint` so the four cells of the grid read as one
 * row whichever of the two paths produced the line.
 */
function FieldError({ message }) {
  if (!message) return null
  return <span role="alert" className="block pt-1.5 text-xs font-medium text-flame-500">{message}</span>
}

function CardLabel({ children, required }) {
  return (
    <span
      aria-hidden="true"
      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint"
    >
      {children}
      {required && <span className="ml-0.5 text-flame-500">*</span>}
    </span>
  )
}

/**
 * One manuscript of the batch, as a card.
 *
 * This was a six-column table inside the wizard's content well. A real batch
 * carries filenames like "BLIS BEYOND GRADUATION MAPPING CAREER PATHS THROUGH
 * ALUMNI PROFILING AT ISABELA STATE UNIVERSITY - ECHAGUE.pdf", which pushed the
 * table past 1500px inside a ~610px column, so every field except the filename
 * sat behind a horizontal scrollbar nobody found. The batch then failed
 * validation on a program the uploader could not see, and the only feedback was
 * "Check the highlighted fields" pointing at nothing.
 *
 * A card wraps instead of scrolling, so the fields are visible at any width.
 */
function ReviewCard({ row, index, programs, onChange, onPatch, onRemove }) {
  const set = (key) => (event) => onChange(row.id, key, event.target.value)
  const hasErrors = Object.keys(row.errors).length > 0
  const rejected = Boolean(row.extractError)
  const program = programs.find((item) => item.id === row.program_id)
  const specializations = program?.specializations || []

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className={cn(
        'rounded-2xl border p-4 transition-colors',
        rejected
          ? 'border-flame-500/25 bg-flame-500/5'
          : hasErrors
            ? 'border-gold-400/40 bg-gold-400/5'
            : 'border-[var(--border)] bg-[var(--surface-1)]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          rejected ? 'bg-flame-500/10 text-flame-500' : 'bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300',
        )}>
          {rejected ? <FileWarning size={16} /> : <FileText size={16} />}
        </span>
        {/* min-w-0 is what lets the filename truncate: without it the flex item
            takes its content's width and pushes the card open. */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={row.name}>{row.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
            <span>PDF · {formatFileSize(row.size)}</span>
            {rejected ? (
              <Badge tone="flame"><XCircle size={11} /> Rejected</Badge>
            ) : row.extracted ? (
              <Badge tone="forest"><Sparkles size={11} /> Autofilled</Badge>
            ) : (
              <Badge tone="neutral">Manual</Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => onRemove(row.id)} aria-label={`Remove ${row.name}`}>
          <Trash2 size={14} />
        </Button>
      </div>

      {rejected ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-flame-500/25 bg-flame-500/5 px-3 py-2.5 text-xs text-ink">
          <AlertTriangle size={14} className="shrink-0 text-flame-500" />
          {row.extractError}. Remove this file to continue.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <CardLabel required>Title</CardLabel>
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
          </div>
          {/* Authors take the room; year, program and specialization are short
              and sit beside each other until the card gets narrow. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <CardLabel>Authors</CardLabel>
              <Input
                value={row.authors}
                onChange={set('authors')}
                placeholder="Dela Cruz, J., Santos, M."
                aria-label={`Authors for ${row.name}`}
              />
            </div>
            <div className="min-w-0">
              <CardLabel required>Year</CardLabel>
              <Input
                value={row.year}
                onChange={set('year')}
                placeholder={`e.g. ${new Date().getFullYear()}`}
                inputMode="numeric"
                maxLength={4}
                error={row.errors.year}
                aria-label={`Year for ${row.name}`}
              />
              <FieldError message={row.errors.year} />
            </div>
            <div className="min-w-0">
              <CardLabel required>Program</CardLabel>
              <Select
                value={row.program_id}
                onChange={(event) => onPatch(row.id, programSelectionById(programs, event.target.value))}
                error={row.errors.program_id}
                disabled={programs.length === 0}
                aria-label={`Program for ${row.name}`}
              >
                <option value="">Select program…</option>
                {programs.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
              </Select>
            </div>
            {/* Only some programs carry one, so the cell reveals itself rather
                than reserving an empty slot in every card. */}
            {specializations.length > 0 && (
              <div className="min-w-0">
                <CardLabel required>Specialization</CardLabel>
                <Select
                  value={row.specialization_id}
                  onChange={(event) => onPatch(row.id, specializationSelection(specializations, event.target.value))}
                  error={row.errors.specialization_id}
                  aria-label={`Specialization for ${row.name}`}
                >
                  <option value="">Select…</option>
                  {specializations.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}
                </Select>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.li>
  )
}

function ReviewList({ rows, programs, onChange, onPatch, onRemove }) {
  return (
    <ul className="space-y-3" aria-label="Batch metadata review">
      <AnimatePresence initial={false}>
        {rows.map((row, index) => (
          <ReviewCard
            key={row.id}
            row={row}
            index={index}
            programs={programs}
            onChange={onChange}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </ul>
  )
}

function rowPresentation(row) {
  if (row.submitError) {
    return { tone: 'flame', label: 'Not accepted', message: row.submitError, progress: 0, stage: '' }
  }
  const job = row.job ?? {}
  const status = job.status ?? 'queued'
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'expired'
  return {
    tone: statusTone(status),
    label: statusLabel(status),
    message: job.error || job.message || '',
    progress: job.progress ?? 0,
    stage: terminal ? '' : status === 'queued' ? 'In queue' : stageLabel(job.stage),
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
      <td className="max-w-[14rem] sm:max-w-[16rem] px-3 py-3">
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
      <td className="px-3 py-3 whitespace-nowrap"><Badge tone={tone}>{label}</Badge></td>
      <td className="min-w-[10rem] sm:min-w-[11rem] px-3 py-3">
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
      <td className="min-w-[12rem] sm:min-w-[14rem] px-3 py-3 text-xs text-ink-muted">
        {message}
        {status === 'retry_wait' && (
          <div className="mt-1 text-[11px] text-gold-600 dark:text-gold-300">Automatic retry {row.job.attempt_count}/{row.job.max_attempts}</div>
        )}
        {status === 'completed' && row.job.chunks != null && (
          <div className="mt-1 text-[11px]">{row.job.chunks} embedded chunks</div>
        )}
      </td>
      <td className="w-28 px-4 py-3 text-right whitespace-nowrap">
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={() => onCancel(row)} aria-label={`Cancel upload of ${row.name}`} className="whitespace-nowrap">
            <Ban size={13} aria-hidden="true" /> Cancel
          </Button>
        )}
      </td>
    </tr>
  )
}

function ProgressTable({ rows, onCancel }) {
  return (
    <TableScroller label="Batch ingestion progress" className="rounded-2xl border border-[var(--border)]">
      <table className="w-full min-w-[42rem] text-sm">
        <thead className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wider text-ink-faint">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Manuscript</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Progress</th>
            <th className="px-3 py-2.5 font-semibold">Details</th>
            <th className="w-28 px-4 py-2.5 text-right font-semibold"><span className="sr-only">Actions</span></th>
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
  const progress = batchProgress(rows)

  return (
    <div className="space-y-6">
      {/* 3D Batch Ingestion Visualizer & Telemetry Header */}
      <div className="grid gap-6 lg:grid-cols-12 items-center">
        <div className="lg:col-span-7">
          <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-b from-[var(--surface-1)] to-[var(--surface-2)]/60 shadow-xl shadow-forest-950/5">
            <Suspense
              fallback={
                <div className="flex h-64 w-full items-center justify-center rounded-3xl bg-[var(--surface-2)]/40 animate-pulse">
                  <span className="text-xs font-mono font-medium text-ink-faint">Initializing 3D Vector Space…</span>
                </div>
              }
            >
              <IngestScene3D
                progress={progress}
                stage={finished ? 'Completed' : 'Batch Ingestion'}
                stageKey={finished ? 'index' : (progress < 20 ? 'download' : progress < 40 ? 'malware_scan' : progress < 60 ? 'extract' : progress < 80 ? 'embed' : 'index')}
              />
            </Suspense>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-3.5">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-5 shadow-xs backdrop-blur-xs">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-forest-500 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-ink">
                  {finished ? 'Batch Completed' : 'Concurrent Workers Active'}
                </span>
              </div>
              <span className="font-display text-base sm:text-lg font-extrabold text-forest-700 dark:text-gold-300 tabular-nums">
                {progress}%
              </span>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall batch progress"
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-forest-600 via-forest-500 to-gold-400"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="mt-2.5 text-xs text-ink-muted">
              {summary.completed} of {summary.total} indexed · {summary.processing + summary.queued} active jobs
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-center">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-3 shadow-xs">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Manuscripts</span>
              <span className="font-display text-lg font-extrabold text-ink">{summary.total}</span>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-3 shadow-xs">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Status</span>
              <span className="font-display text-sm font-bold text-forest-700 dark:text-gold-300 mt-1 block">
                {finished ? 'Finished' : 'Processing'}
              </span>
            </div>
          </div>
        </div>
      </div>

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

function readStoredBatch(ownerId) {
  try {
    return restoreActiveBatch(sessionStorage.getItem(ACTIVE_BATCH_STORAGE_KEY), ownerId)
  } catch {
    return null
  }
}

function writeStoredBatch(rows, ownerId) {
  try {
    if (allTerminal(rows)) sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY)
    else sessionStorage.setItem(ACTIVE_BATCH_STORAGE_KEY, serializeActiveBatch(rows, ownerId))
  } catch {
    // Storage may be unavailable (private mode); the page still works without resume.
  }
}

export default function UploadBatch() {
  const { user, isSuperadmin, department: userDepartment } = useAuth()
  const ownerId = user?.id ?? null
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
    // Waits for the identity: a batch is only ever restored to the account that
    // queued it, so there is nothing to read until we know who that is.
    if (restoredRef.current || !ownerId) return
    restoredRef.current = true
    const stored = readStoredBatch(ownerId)
    if (stored) {
      pollStartedRef.current = Date.now()
      dispatch({ type: 'restore', rows: stored })
    }
  }, [ownerId])

  useEffect(() => {
    if (step === BATCH_STEPS.ingesting) writeStoredBatch(rows, ownerId)
  }, [rows, step, ownerId])

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

  // The department decides which programs exist, so every row's classification
  // is read from the one currently selected.
  const programs = departmentPrograms(departments, defaults.department)

  const setStep = (value) => dispatch({ type: 'set-step', step: value })
  const updateDefaults = (patch) => {
    dispatch({ type: 'set-defaults', value: (current) => ({ ...current, ...patch }) })
    // A program belongs to one college, so changing the department invalidates
    // every row's. Clearing them is the honest outcome: leaving the codes in
    // place would show a classification the upload would be rejected for.
    if (patch.department !== undefined) {
      dispatch({
        type: 'apply-program',
        selection: { program_id: '', specialization_id: '', requires_specialization: false, track: '' },
      })
    }
  }
  const changeRow = (id, key, value) => dispatch({ type: 'set-row-field', id, key, value })
  const patchRow = (id, patch) => dispatch({ type: 'patch-row', id, patch })
  const applyProgramToAll = (selection) => dispatch({ type: 'apply-program', selection })
  const removeRow = (id) => dispatch({ type: 'remove-row', id })

  /**
   * Add files, and say so when the batch could not take all of them.
   *
   * `addRows` drops duplicates and then slices to MAX_BATCH_FILES. Both are
   * right, and both used to happen in silence: dragging twenty-five manuscripts
   * onto a page that shows "20 / 20 selected" left five of them unaccounted
   * for, and the reader's only clue was a count they had no reason to be
   * totalling themselves.
   */
  const addFiles = (files) => {
    const incoming = Array.from(files ?? [])
    const room = Math.max(0, MAX_BATCH_FILES - rows.length)
    const present = new Set(rows.map((row) => `${row.name} ${row.size}`))
    const fresh = incoming.filter((file) => !present.has(`${file.name} ${file.size}`))
    const duplicates = incoming.length - fresh.length
    const overflow = Math.max(0, fresh.length - room)
    dispatch({ type: 'add-rows', files: incoming })
    if (overflow) {
      toast.warning(`${overflow} file${overflow === 1 ? ' was' : 's were'} not added`, {
        description: `A batch holds at most ${MAX_BATCH_FILES} manuscripts. Ingest these first, then start another batch.`,
      })
    }
    if (duplicates) {
      toast.info(`${duplicates} file${duplicates === 1 ? ' is' : 's are'} already in this batch`)
    }
  }

  const continueToReview = async () => {
    if (rows.length === 0) return
    dispatch({ type: 'set-extracting', value: true })
    toast.info('Extracting metadata from the title pages…')
    try {
      const response = await extractMetadataBatch(rows.map((row) => row.file))
      // The catalog goes in so each row's extracted program code resolves
      // inside the department this batch is being filed under.
      dispatch({ type: 'apply-extraction', files: response.files, departments })
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
          program_id: row.program_id, specialization_id: row.specialization_id,
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
  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
            Batch <span className="text-gradient-isu">Upload</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Ingest several thesis manuscripts at once. Titles, authors, years, and the academic program
            are read from each title page; only the category and department are shared by the whole batch.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/upload')} className="shadow-xs hover:shadow-md transition-all">
          <ArrowLeft size={14} /> Single upload
        </Button>
      </div>

      <GlassCard className="overflow-hidden p-0 border border-[var(--border)] shadow-xl backdrop-blur-md rounded-3xl">
        {/* Modern Horizontal Stepper & Batch Capacity Header */}
        {step < BATCH_STEPS.ingesting && (
          <div className="border-b border-[var(--border)]/70 bg-[var(--surface-1)]/80 px-3.5 py-4 sm:px-8 backdrop-blur-xs">
            <div className="relative flex flex-col items-center justify-center gap-4 lg:flex-row">
              <WizardStepper
                steps={BATCH_WIZARD_STEPS}
                current={step}
                orientation="horizontal"
                onSelect={step < BATCH_STEPS.ingesting ? setStep : undefined}
              />
              <div className="shrink-0 lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2">
                <CapacityMeter count={rows.length} totalBytes={totalBytes} />
              </div>
            </div>
          </div>
        )}

        <div className="min-w-0 p-3.5 sm:p-7 md:p-8">
          {departmentsError && (
            <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-flame-500/25 bg-flame-500/10 p-3 text-xs">
              <span className="flex items-center gap-2"><AlertTriangle size={14} aria-hidden="true" /> Department metadata is unavailable.</span>
              <Button variant="ghost" size="sm" onClick={() => retryDepartments()}>Retry</Button>
            </div>
          )}

          <WizardStep stepKey={step} direction={direction}>
            {step === BATCH_STEPS.files && (
              <div className="max-w-3xl mx-auto space-y-6">
                <Dropzone
                  multiple
                  disabled={rows.length >= MAX_BATCH_FILES}
                  onFiles={addFiles}
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
              </div>
            )}

            {step === BATCH_STEPS.review && (
              <div className="space-y-7">
                <section aria-labelledby="batch-shared-heading">
                  <SectionHeading id="batch-shared-heading" icon={Layers} title="Shared details" />
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
                  >
                    {extractionRejects.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => extractionRejects.forEach((row) => removeRow(row.id))}>
                        <Trash2 size={13} /> Remove {extractionRejects.length} rejected
                      </Button>
                    )}
                  </SectionHeading>
                  {defaultErrors.rows && <p role="alert" className="mb-2 text-xs text-[var(--destructive)]">{defaultErrors.rows}</p>}
                  <ProgramBulkBar
                    key={defaults.department}
                    programs={programs}
                    disabled={submitting}
                    onApply={applyProgramToAll}
                  />
                  <ReviewList
                    rows={rows}
                    programs={programs}
                    onChange={changeRow}
                    onPatch={patchRow}
                    onRemove={removeRow}
                  />
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
