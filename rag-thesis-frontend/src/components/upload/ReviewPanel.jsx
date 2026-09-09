import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, FileText, ShieldCheck } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { PIPELINE_STAGES, formatFileSize } from '../../pages/upload/wizardSteps'
import { thesisCategoryLabel } from '../../lib/catalog'

const { duration, easing, stagger } = motionTokens

const listStagger = {
  hidden: {},
  show: { transition: { staggerChildren: stagger.compact, delayChildren: 0.08 } },
}
const cellRise = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: duration.medium, ease: easing.standard } },
}

function Cell({ label, children, wide }) {
  return (
    <motion.div
      variants={cellRise}
      className={cn(
        'min-w-0 rounded-xl border border-[var(--border)]/70 bg-[var(--surface-2)]/40 p-3.5 transition-colors hover:bg-[var(--surface-2)]/70',
        wide && 'sm:col-span-2',
      )}
    >
      <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </motion.div>
  )
}

/**
 * The seven worker stages, named up front.
 */
function PipelinePreview() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 backdrop-blur-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left outline-none transition-colors duration-200 hover:bg-[var(--surface-2)]/60"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-forest-500/15 text-forest-700 dark:text-gold-300">
          <ShieldCheck size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wider text-ink">What happens on submit</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('shrink-0 text-ink-faint transition-transform duration-300', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.medium, ease: easing.standard }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-4 pb-4.5 pt-1">
              <ol className="grid gap-2 sm:grid-cols-2">
                {PIPELINE_STAGES.map((stage, index) => (
                  <li
                    key={stage.key}
                    className="flex items-center gap-2.5 rounded-xl border border-[var(--border)]/60 bg-[var(--surface-2)]/50 px-2.5 py-1.5 text-xs text-ink-muted"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-forest-600/15 text-[10px] font-mono font-bold text-forest-700 dark:text-gold-300">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium">{stage.label}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs leading-relaxed text-ink-muted bg-[var(--surface-2)]/30 rounded-xl p-3 border border-[var(--border)]/40">
                The manuscript is cleaned (headers, footers, page numbers, TOC, and bibliography
                stripped), split into 800-token chunks with metadata tags, embedded via Gemini, and
                indexed in the pgvector archive. The original PDF is stored privately.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Step 3: the record exactly as the archive will store it.
 */
export function ReviewPanel({ file, form, program, specialization }) {
  return (
    <motion.div variants={listStagger} initial="hidden" animate="show" className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 shadow-xs backdrop-blur-xs">
        <motion.div
          variants={cellRise}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)]/80 px-5 py-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 text-gold-300 shadow-md shadow-forest-900/20">
              <FileText size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="block truncate text-sm font-bold text-ink" title={file?.name}>{file?.name}</span>
              <span className="block text-xs text-ink-muted">PDF · {formatFileSize(file?.size)}</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-500/12 px-3 py-1 text-[11px] font-semibold text-forest-700 dark:text-forest-300 border border-forest-500/25">
            <ShieldCheck size={13} aria-hidden="true" /> Verified for Ingestion
          </span>
        </motion.div>

        <dl className="grid gap-3.5 p-4 sm:p-5 sm:grid-cols-2">
          <Cell label="Title" wide>
            <span className="font-display block text-base font-extrabold leading-snug text-ink">{form.title}</span>
          </Cell>
          <Cell label="Authors">
            <span className="block text-sm font-medium leading-snug text-ink">{form.authors || '—'}</span>
          </Cell>
          <Cell label="Year">
            <span className="block text-sm font-mono font-medium text-ink">{form.year || '—'}</span>
          </Cell>
          <Cell label="Category">
            <Badge tone={form.thesis_category === 'faculty' ? 'gold' : 'forest'}>
              {thesisCategoryLabel(form.thesis_category)}
            </Badge>
          </Cell>
          <Cell label="Program / specialization">
            <span className="flex flex-wrap gap-1.5">
              <Badge tone="forest">
                {program?.code || (form.thesis_category === 'faculty' ? 'Not applicable' : 'Pending program')}
              </Badge>
              {specialization && <Badge tone="gold">{specialization.code}</Badge>}
            </span>
          </Cell>
          <Cell label="Department" wide>
            <Badge tone="neutral">{form.department}</Badge>
          </Cell>
        </dl>
      </div>

      <motion.div variants={cellRise}>
        <PipelinePreview />
      </motion.div>
    </motion.div>
  )
}
