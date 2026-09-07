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
    <motion.div variants={cellRise} className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </motion.div>
  )
}

/**
 * The seven worker stages, named up front.
 *
 * This replaces a dense grey paragraph that described the same pipeline in
 * prose. Collapsed it costs three lines; expanded it is the same list the
 * progress timeline is about to walk through, so the next screen is already
 * familiar.
 */
function PipelinePreview() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none transition-colors duration-200 hover:bg-[var(--surface-2)]"
      >
        <ShieldCheck size={15} className="shrink-0 text-forest-700 dark:text-gold-300" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs font-semibold">What happens on submit</span>
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
            <div className="space-y-3 px-4 pb-4">
              <ol className="grid gap-1.5 sm:grid-cols-2">
                {PIPELINE_STAGES.map((stage, index) => (
                  <li key={stage.key} className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--surface-3)] text-[10px] font-bold text-ink-muted">
                      {index + 1}
                    </span>
                    {stage.label}
                  </li>
                ))}
              </ol>
              <p className="text-xs leading-relaxed text-ink-muted">
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
 *
 * A single tonal panel rather than the old `.glass` card nested inside the
 * page's `surface-glass` card — two blurred translucent layers over each other
 * muddied both.
 */
export function ReviewPanel({ file, form, program, specialization }) {
  return (
    <motion.div variants={listStagger} initial="hidden" animate="show" className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
        <motion.div
          variants={cellRise}
          className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 text-gold-300">
            <FileText size={17} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold" title={file?.name}>{file?.name}</span>
            <span className="block text-xs text-ink-faint">PDF · {formatFileSize(file?.size)}</span>
          </span>
        </motion.div>

        <dl className="grid gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2">
          <Cell label="Title" wide>
            <span className="font-display block text-sm font-bold leading-snug">{form.title}</span>
          </Cell>
          <Cell label="Authors">
            <span className="block text-sm font-medium leading-snug">{form.authors || '—'}</span>
          </Cell>
          <Cell label="Year">
            <span className="block text-sm font-medium">{form.year || '—'}</span>
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
