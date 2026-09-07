import { motion } from 'framer-motion'
import {
  AlertTriangle, Archive, ArrowRight, Ban, ScanText, Scissors, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { staggerContainer, staggerItem } from '../ui/Motion'
import { cn, normalizePercent, scanMetrics, verdictLabel } from '../../lib/utils'
import { motionTokens } from '../../design/motion'

const ASSURANCES = [
  [ShieldCheck, 'Malware screening', 'Completed before document processing'],
  [ScanText, 'Text preparation', 'OCR fallback, cleanup, and structure extraction applied'],
  [Scissors, 'Privacy processing', 'Supported PII redaction rules applied before indexing'],
  [Archive, 'Source protection', 'Original manuscript retained in private storage only'],
]

/**
 * A check drawn rather than popped.
 *
 * `pathLength` runs once and settles, so it never trips the accessibility
 * suite's wait-for-opacity-to-stop-changing gate the way a looping flourish
 * would.
 */
function DrawnCheck() {
  return (
    <svg viewBox="0 0 52 52" className="h-10 w-10" fill="none" aria-hidden="true">
      <motion.path
        d="M14 27.5 L22.5 36 L38 18"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.2, 0, 0, 1], delay: 0.2 }}
      />
    </svg>
  )
}

function OutcomeShell({ tone, icon, title, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.spring}
      className="flex flex-col items-center text-center"
    >
      <motion.div
        initial={{ scale: 0.86 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className={cn(
          'mb-5 flex h-20 w-20 items-center justify-center rounded-full',
          tone === 'success' && 'bg-forest-600/15 text-forest-700 dark:text-forest-300',
          tone === 'error' && 'bg-flame-500/12 text-flame-500',
          tone === 'warning' && 'bg-gold-400/15 text-gold-500',
        )}
      >
        {icon}
      </motion.div>
      <h2 className="font-display text-2xl font-extrabold">{title}</h2>
      {children}
    </motion.div>
  )
}

function UploadScreening({ scan }) {
  if (!scan?.flagged) return null
  const metrics = scanMetrics(scan)
  return (
    <div className="mt-6 w-full max-w-md rounded-2xl border border-gold-400/40 bg-gold-400/10 p-4 text-left">
      <div className="flex items-center gap-2 text-sm font-bold">
        <ShieldAlert size={15} className="shrink-0 text-gold-500" aria-hidden="true" />
        {verdictLabel(metrics.verdict)}
      </div>
      <div className="mt-2 grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
        <span>Highest passage similarity: {metrics.highest.toFixed(2)}%</span>
        <span>Matched chunk coverage: {metrics.coverage.toFixed(2)}%</span>
        <span>Matched chunks / total chunks: {metrics.matchedChunks} / {metrics.totalChunks}</span>
        <span>Advisory verdict: {verdictLabel(metrics.verdict)}</span>
      </div>
      <ul className="mt-2 space-y-1 text-xs text-ink-muted">
        {(scan.matched_papers || []).map((paper) => (
          <li key={paper.id}>
            &quot;{paper.title || 'Untitled thesis'}&quot;{paper.year ? ` (${paper.year})` : ''} — highest passage {normalizePercent(paper.similarity).toFixed(2)}%
            {' · '}{paper.match_count} chunk{paper.match_count === 1 ? '' : 's'}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">
        The manuscript was still indexed. This is advisory only; faculty makes the final decision.
      </p>
    </div>
  )
}

/**
 * The three ways an ingestion job ends. Lifted out of the wizard page, which
 * had all three branches inline inside an already 750-line component.
 */
export function IngestOutcome({ job, title, onReset, onViewArchive }) {
  if (job?.status === 'failed') {
    return (
      <OutcomeShell tone="error" title="Ingestion failed" icon={<AlertTriangle size={32} aria-hidden="true" />}>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">{job.error}</p>
        <Button variant="secondary" className="mt-7" onClick={onReset}>Try again</Button>
      </OutcomeShell>
    )
  }

  if (job?.status === 'cancelled') {
    return (
      <OutcomeShell tone="warning" title="Upload cancelled" icon={<Ban size={32} aria-hidden="true" />}>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">
          The manuscript was not indexed. Its staged private copy is being removed safely.
        </p>
        <Button variant="secondary" className="mt-7" onClick={onReset}>Start a new upload</Button>
      </OutcomeShell>
    )
  }

  return (
    <OutcomeShell tone="success" title="Thesis indexed!" icon={<DrawnCheck />}>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        &quot;{title}&quot; is now part of the semantic archive with{' '}
        <span className="font-semibold text-ink">{job?.chunks}</span> embedded chunks.
      </p>
      <UploadScreening scan={job?.duplication} />
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-6 grid w-full max-w-xl gap-2 text-left sm:grid-cols-2"
      >
        {ASSURANCES.map(([Icon, label, description]) => (
          <motion.div
            key={label}
            variants={staggerItem}
            className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-3.5"
          >
            <Icon size={16} className="mt-0.5 shrink-0 text-forest-700 dark:text-forest-300" aria-hidden="true" />
            <div>
              <div className="text-xs font-bold">{label}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</div>
            </div>
          </motion.div>
        ))}
      </motion.div>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button variant="secondary" onClick={onReset}>Upload another</Button>
        <Button onClick={onViewArchive}>View archive <ArrowRight size={15} aria-hidden="true" /></Button>
      </div>
    </OutcomeShell>
  )
}
