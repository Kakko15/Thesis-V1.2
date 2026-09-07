import { motion } from 'framer-motion'
import {
  Archive, BrainCircuit, CheckCircle2, Database, ScanText, Scissors, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { stageView } from '../../pages/upload/wizardSteps'

const STAGE_ICONS = {
  download: Archive,
  malware_scan: ShieldCheck,
  extract: ScanText,
  chunk: Scissors,
  embed: BrainCircuit,
  screen: ShieldAlert,
  index: Database,
}

const barTransition = { duration: 0.6, ease: [0.2, 0, 0, 1] }

function StageRow({ stage, message, last }) {
  const Icon = STAGE_ICONS[stage.key] ?? Archive
  return (
    <motion.li layout className="relative flex gap-3.5">
      {!last && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[1.0625rem] top-9 w-0.5 -translate-x-1/2 overflow-hidden rounded-full bg-[var(--border)]"
        >
          <motion.span
            className="block h-full w-full origin-top rounded-full bg-forest-600"
            initial={false}
            animate={{ scaleY: stage.done ? 1 : 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
          />
        </span>
      )}

      <span
        className={cn(
          'relative z-[1] flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-2xl',
          'transition-colors duration-300',
          stage.done && 'bg-forest-600 text-white',
          stage.active && 'bg-gradient-to-br from-gold-300 to-gold-400 text-forest-950 shadow-lg shadow-gold-400/30',
          !stage.done && !stage.active && 'border border-[var(--border)] bg-[var(--surface-2)] text-ink-faint',
        )}
      >
        {stage.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
      </span>

      <motion.div layout className={cn('min-w-0 flex-1', !last && 'pb-4')}>
        <span
          className={cn(
            'block pt-2 text-sm font-semibold leading-tight transition-colors duration-300',
            stage.done || stage.active ? 'text-ink' : 'text-ink-faint',
          )}
        >
          {stage.label}
        </span>
        {/* Only the running stage carries the worker's own message, so the
            column stays one line tall for the six stages that are not. */}
        {stage.active && message && (
          <motion.span
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative mt-1.5 block overflow-hidden rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-ink-muted"
          >
            {message}
            <span
              aria-hidden="true"
              className="animate-stage-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-gold-300/25 to-transparent"
            />
          </motion.span>
        )}
      </motion.div>
    </motion.li>
  )
}

/**
 * Live ingestion progress.
 *
 * Replaces a seven-across icon strip that wrapped to three columns on a phone
 * and truncated every stage name. As a vertical timeline each stage keeps its
 * full label, the connector fills as the worker advances, and only the running
 * stage expands to carry the message.
 *
 * The old progress bar had no `role="progressbar"` — the batch page's did — so
 * a screen reader was told nothing at all while a job ran.
 */
export function PipelineTimeline({ job }) {
  const { stages, progress } = stageView(job)
  const activeStage = stages.find((stage) => stage.active)

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Ingesting</span>
          <span className="font-display text-sm font-extrabold tabular-nums">{progress}%</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Ingestion progress"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-forest-600 via-forest-500 to-gold-400"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={barTransition}
          />
        </div>
        {/* Announced on change, and deliberately only the stage name: the
            percentage ticks every 1.5s and would make the region unusable. */}
        <p className="sr-only" aria-live="polite">
          {activeStage ? `${activeStage.label} in progress` : ''}
        </p>
      </div>

      <ol className="space-y-0">
        {stages.map((stage, index) => (
          <StageRow
            key={stage.key}
            stage={stage}
            message={job?.message}
            last={index === stages.length - 1}
          />
        ))}
      </ol>

      {job?.status === 'retry_wait' && (
        <div className="rounded-2xl border border-gold-400/35 bg-gold-400/10 px-4 py-3 text-center text-xs">
          Temporary service interruption. Automatic retry {job.attempt_count}/{job.max_attempts}
          {job.next_retry_at ? ` is scheduled for ${new Date(job.next_retry_at).toLocaleTimeString()}.` : ' is scheduled.'}
        </div>
      )}
    </div>
  )
}
