import { lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import {
  Archive, BrainCircuit, CheckCircle2, Database, ScanText, Scissors, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { stageView } from '../../pages/upload/wizardSteps'

const IngestScene3D = lazy(() => import('../three/IngestScene3D'))

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
    <motion.li layout className="relative flex gap-4">
      {!last && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[1.125rem] top-9.5 w-0.5 -translate-x-1/2 overflow-hidden rounded-full bg-[var(--border)]"
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
          'relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl',
          'transition-all duration-300',
          stage.done && 'bg-forest-600 text-white shadow-md shadow-forest-900/25',
          stage.active && 'bg-gradient-to-br from-gold-300 to-gold-400 text-forest-950 shadow-lg shadow-gold-400/40 ring-4 ring-gold-400/20',
          !stage.done && !stage.active && 'border border-[var(--border)] bg-[var(--surface-2)] text-ink-faint',
        )}
      >
        {stage.done ? <CheckCircle2 size={17} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
      </span>

      <motion.div layout className={cn('min-w-0 flex-1', !last && 'pb-4.5')}>
        <span
          className={cn(
            'block pt-1.5 text-sm font-semibold leading-tight transition-colors duration-300',
            stage.done || stage.active ? 'text-ink' : 'text-ink-faint',
          )}
        >
          {stage.label}
        </span>
        {/* Only the running stage carries the worker's own message */}
        {stage.active && message && (
          <motion.div
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative mt-2 overflow-hidden rounded-xl border border-gold-400/30 bg-gold-400/10 px-3.5 py-2 text-xs font-medium text-ink-muted shadow-xs"
          >
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold-500 animate-ping shrink-0" />
              <span className="truncate">{message}</span>
            </div>
            <span
              aria-hidden="true"
              className="animate-stage-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-gold-300/30 to-transparent"
            />
          </motion.div>
        )}
      </motion.div>
    </motion.li>
  )
}

/**
 * Live ingestion progress with 3D Holographic Scene & Pipeline Timeline.
 */
export function PipelineTimeline({ job, hide3D = false }) {
  const { stages, progress } = stageView(job)
  const activeStage = stages.find((stage) => stage.active)

  return (
    <div className="space-y-4">
      {/* 3D Ingestion Holographic Visualizer */}
      {!hide3D && (
        <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-b from-[var(--surface-1)] to-[var(--surface-2)]/60 shadow-lg shadow-forest-950/5">
          <Suspense
            fallback={
              <div className="flex h-64 w-full items-center justify-center rounded-3xl bg-[var(--surface-2)]/40 animate-pulse">
                <span className="text-xs font-mono font-medium text-ink-faint">Initializing 3D Vector Space…</span>
              </div>
            }
          >
            <IngestScene3D
              progress={progress}
              stage={activeStage?.label || 'Processing'}
              stageKey={activeStage?.key || 'download'}
            />
          </Suspense>
        </div>
      )}

      {/* Progress Telemetry */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/70 p-4 sm:p-5 shadow-xs backdrop-blur-xs">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-forest-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-ink">Ingesting</span>
          </div>
          <span className="font-display text-base font-extrabold tabular-nums text-forest-700 dark:text-gold-300">
            {progress}%
          </span>
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
            className="h-full rounded-full bg-gradient-to-r from-forest-600 via-forest-500 to-gold-400 shadow-sm"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={barTransition}
          />
        </div>
        {/* Screen reader announcement */}
        <p className="sr-only" aria-live="polite">
          {activeStage ? `${activeStage.label} in progress` : ''}
        </p>
      </div>

      {/* Timeline stages */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/70 p-4 sm:p-5 shadow-xs backdrop-blur-xs">
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
      </div>

      {job?.status === 'retry_wait' && (
        <div className="rounded-2xl border border-gold-400/35 bg-gold-400/10 px-4 py-3 text-center text-xs font-medium text-ink">
          Temporary service interruption. Automatic retry {job.attempt_count}/{job.max_attempts}
          {job.next_retry_at ? ` is scheduled for ${new Date(job.next_retry_at).toLocaleTimeString()}.` : ' is scheduled.'}
        </div>
      )}
    </div>
  )
}
