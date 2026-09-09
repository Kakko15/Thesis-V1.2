import { motion } from 'framer-motion'
import {
  AlertTriangle, Archive, ArrowRight, Ban, ScanText, Scissors, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { staggerContainer, staggerItem } from '../ui/Motion'
import { cn, mostSimilarPaper, normalizePercent, scanMetrics, verdictLabel } from '../../lib/utils'
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
      className="flex flex-col items-center text-center max-w-2xl mx-auto py-2"
    >
      <div className="relative mb-5 flex items-center justify-center">
        {tone === 'success' && (
          <div className="absolute -inset-3 rounded-full bg-forest-500/20 blur-xl dark:bg-forest-400/25 animate-pulse" />
        )}
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 18 }}
          className={cn(
            'relative flex h-20 w-20 items-center justify-center rounded-full shadow-xl',
            tone === 'success' && 'bg-gradient-to-br from-forest-600 to-forest-800 text-white ring-4 ring-forest-500/30',
            tone === 'error' && 'bg-flame-500/15 text-flame-500 ring-4 ring-flame-500/20',
            tone === 'warning' && 'bg-gold-400/20 text-gold-500 ring-4 ring-gold-400/20',
          )}
        >
          {icon}
        </motion.div>
      </div>
      <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">{title}</h2>
      {children}
    </motion.div>
  )
}

function paperLine(paper) {
  const title = paper.title || 'Untitled thesis'
  const year = paper.year ? ` (${paper.year})` : ''
  return `"${title}"${year}`
}

/**
 * Which archived thesis the manuscript resembles, said once and first.
 *
 * The panel used to open with four percentages and leave the title for a list
 * three lines down, so the question everyone asked at this screen — "similar to
 * *what*?" — was answered last (2026-09-08). Authors are shown because two
 * theses from one programme in one year can share a title fragment.
 */
function MostSimilar({ paper }) {
  if (!paper) return null
  const chunks = Number(paper.match_count) || 0
  return (
    <div className="mt-3 rounded-xl border border-gold-400/30 bg-[var(--surface-1)]/60 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Most similar thesis</div>
      <div className="mt-1 text-sm font-semibold text-ink">{paperLine(paper)}</div>
      {paper.authors && <div className="mt-0.5 text-xs text-ink-muted">{paper.authors}</div>}
      <div className="mt-1 text-xs text-ink-muted">
        Closest passage {normalizePercent(paper.similarity).toFixed(2)}%
        {chunks > 0 && ` · matched ${chunks} chunk${chunks === 1 ? '' : 's'}`}
      </div>
    </div>
  )
}

function UploadScreening({ scan, onReviewNovelty }) {
  if (!scan?.flagged) return null
  const metrics = scanMetrics(scan)
  const top = mostSimilarPaper(scan)
  const others = (scan.matched_papers || []).filter((paper) => paper.id !== top?.id)
  return (
    <div className="mt-6 w-full max-w-xl rounded-2xl border border-gold-400/40 bg-gold-400/10 p-5 text-left shadow-xs backdrop-blur-xs">
      <div className="flex items-center gap-2 text-sm font-bold text-ink">
        <ShieldAlert size={16} className="shrink-0 text-gold-600 dark:text-gold-400" aria-hidden="true" />
        {verdictLabel(metrics.verdict)}
      </div>
      <div className="mt-2.5 grid gap-1.5 text-xs text-ink-muted sm:grid-cols-2">
        <span className="font-medium">Highest passage similarity: <strong className="text-ink">{metrics.highest.toFixed(2)}%</strong></span>
        <span className="font-medium">Matched chunk coverage: <strong className="text-ink">{metrics.coverage.toFixed(2)}%</strong></span>
        <span className="font-medium">Matched chunks / total chunks: <strong className="text-ink">{metrics.matchedChunks} / {metrics.totalChunks}</strong></span>
        <span className="font-medium">Advisory verdict: <strong className="text-ink">{verdictLabel(metrics.verdict)}</strong></span>
      </div>
      <MostSimilar paper={top} />
      {others.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 text-xs text-ink-muted border-t border-gold-400/20 pt-2.5">
          {others.map((paper) => (
            <li key={paper.id} className="rounded-lg bg-gold-400/10 px-2.5 py-1">
              Also {paperLine(paper)} — highest passage {normalizePercent(paper.similarity).toFixed(2)}%
              {' · '}{paper.match_count} chunk{paper.match_count === 1 ? '' : 's'}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-xs text-ink-muted leading-relaxed">
        The manuscript was still indexed. This is advisory only; faculty makes the final decision.
      </p>
      {onReviewNovelty && (
        <div className="mt-3.5 border-t border-gold-400/30 pt-3">
          <p className="text-xs text-ink-muted leading-relaxed">
            This screening reports counts, not passages. <strong className="font-semibold text-ink">Novelty
            Review</strong> compares a draft against the archive and shows each overlapping excerpt side by
            side with its page numbers. Scan a draft there before uploading it — a manuscript already in the
            archive matches itself.
          </p>
          <Button variant="outline" size="sm" className="mt-2.5" onClick={onReviewNovelty}>
            <ShieldAlert size={13} aria-hidden="true" /> Open Novelty Review
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The three ways an ingestion job ends.
 */
export function IngestOutcome({ job, title, onReset, onViewArchive, onReviewNovelty }) {
  if (job?.status === 'failed') {
    // The worker refuses a verbatim re-upload (services/ingestion.py,
    // DuplicateManuscriptIngestionError) and its public error names the
    // archived thesis. It is the one failure that is not a processing fault,
    // so it gets its own heading and a route to the paper already indexed.
    const duplicate = /exact duplicate/i.test(job.error || '')
    return (
      <OutcomeShell
        tone="error"
        title={duplicate ? 'Already in the archive' : 'Ingestion failed'}
        icon={<AlertTriangle size={32} aria-hidden="true" />}
      >
        <p className="mt-2 max-w-md text-sm text-ink-muted leading-relaxed">{job.error}</p>
        {duplicate && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onViewArchive}>
            View archive <ArrowRight size={13} aria-hidden="true" />
          </Button>
        )}
        <Button variant="secondary" className="mt-7" onClick={onReset}>Try again</Button>
      </OutcomeShell>
    )
  }

  if (job?.status === 'cancelled') {
    return (
      <OutcomeShell tone="warning" title="Upload cancelled" icon={<Ban size={32} aria-hidden="true" />}>
        <p className="mt-2 max-w-md text-sm text-ink-muted leading-relaxed">
          The manuscript was not indexed. Its staged private copy is being removed safely.
        </p>
        <Button variant="secondary" className="mt-7" onClick={onReset}>Start a new upload</Button>
      </OutcomeShell>
    )
  }

  return (
    <OutcomeShell tone="success" title="Thesis indexed!" icon={<DrawnCheck />}>
      <p className="mt-2 max-w-md text-sm text-ink-muted leading-relaxed">
        &quot;{title}&quot; is now part of the semantic archive with{' '}
        <span className="font-bold text-forest-700 dark:text-gold-300">{job?.chunks}</span> embedded chunks.
      </p>

      {/* Modern Telemetry metrics strip */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-mono font-semibold text-ink">
          {job?.chunks} Semantic Chunks
        </span>
        <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-mono font-semibold text-ink">
          768d Vector Space
        </span>
        <span className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-mono font-semibold text-ink">
          gemini-embedding-001
        </span>
      </div>

      <UploadScreening scan={job?.duplication} onReviewNovelty={onReviewNovelty} />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-6 grid w-full max-w-xl gap-2.5 text-left sm:grid-cols-2"
      >
        {ASSURANCES.map(([Icon, label, description]) => (
          <motion.div
            key={label}
            variants={staggerItem}
            className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-3.5 shadow-xs transition-all hover:bg-[var(--surface-2)]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-600/10 text-forest-700 dark:bg-gold-400/15 dark:text-gold-300 ring-1 ring-forest-500/20">
              <Icon size={16} aria-hidden="true" />
            </span>
            <div>
              <div className="text-xs font-bold text-ink">{label}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div className="mt-8 flex flex-wrap justify-center gap-3.5">
        <Button variant="secondary" onClick={onReset}>Upload another</Button>
        <Button onClick={onViewArchive}>View archive <ArrowRight size={15} aria-hidden="true" /></Button>
      </div>
    </OutcomeShell>
  )
}
