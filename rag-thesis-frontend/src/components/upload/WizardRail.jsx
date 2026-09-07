import { AnimatePresence, motion } from 'framer-motion'
import { FileText } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { ProgressRing } from '../ui/ProgressRing'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { formatFileSize } from '../../pages/upload/wizardSteps'
import { WizardStepper } from './WizardStepper'

const rowMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: motionTokens.duration.short, ease: motionTokens.easing.standard },
}

/** The chosen manuscript, for a rail describing a single file. */
export function RailFileChip({ file }) {
  if (!file) return null
  return (
    <motion.div {...rowMotion} layout className="flex items-center gap-2.5 rounded-2xl bg-[var(--surface-2)] p-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 text-gold-300">
        <FileText size={15} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold" title={file.name}>{file.name}</span>
        <span className="block text-[11px] text-ink-faint">PDF · {formatFileSize(file.size)}</span>
      </span>
    </motion.div>
  )
}

/** The live record, as `summaryRows` describes it. */
export function RailSummaryList({ rows }) {
  if (rows.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-ink-faint">
        Details you enter appear here as you go.
      </p>
    )
  }
  return (
    <dl className="space-y-2.5">
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((row) => (
          <motion.div key={row.key} {...rowMotion} layout>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{row.label}</dt>
            <dd className="mt-0.5">
              {row.tone
                ? <Badge tone={row.tone}>{row.value}</Badge>
                : <span className="block break-words text-xs font-medium leading-snug">{row.value}</span>}
            </dd>
          </motion.div>
        ))}
      </AnimatePresence>
    </dl>
  )
}

/** Small caption above a block inside the rail. */
export function RailHeading({ children }) {
  return <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">{children}</p>
}

// The ring's default palette reddens as the number climbs, which is right for
// a duplication score and exactly backwards for ingestion progress. It is also
// re-targeted on every poll, so the one-shot reveal sweep is too slow.
const PROGRESS_RING_COLOR = '#059656'
const PROGRESS_RING_TRANSITION = { duration: 0.6, ease: [0.2, 0, 0, 1] }

function IngestProgress({ progress, statusLabel, caption, progressLabel }) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Semantics are opt-in: the single wizard's timeline already exposes a
          progressbar for the same job, and two of them is noise in a screen
          reader. The batch page has no timeline, so its ring carries the role. */}
      <div
        role={progressLabel ? 'progressbar' : undefined}
        aria-label={progressLabel}
        aria-valuenow={progressLabel ? progress : undefined}
        aria-valuemin={progressLabel ? 0 : undefined}
        aria-valuemax={progressLabel ? 100 : undefined}
      >
        <ProgressRing
          value={progress}
          size={116}
          strokeWidth={9}
          color={PROGRESS_RING_COLOR}
          transition={PROGRESS_RING_TRANSITION}
        />
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">{statusLabel}</p>
      {/* What is being ingested. Survives a refresh, where the File objects are
          gone but the titles were persisted alongside the job ids. */}
      {caption && <p className="mt-2 line-clamp-3 text-xs leading-snug text-ink-faint">{caption}</p>}
    </div>
  )
}

/**
 * The sticky context rail: where you are, and what the archive is about to be
 * told. Shared by the single-manuscript wizard and the batch page.
 *
 * `children` is the summary block and the caller owns its contents — notably it
 * must not repeat what the step beside it already prints. Two copies of the
 * same title is both a duplicate-content design smell and a `getByText`
 * strict-mode violation for the E2E review-step assertions.
 */
export function WizardRail({
  steps, step, mode, onSelectStep, progress, statusLabel, caption, progressLabel, children, className,
}) {
  // One stepper, not two behind `lg:hidden`: a hidden copy would still put a
  // second set of step labels and a second aria-current into the DOM.
  const stacked = useMediaQuery('(min-width: 1024px)')

  return (
    <aside
      className={cn(
        'border-b border-[var(--border)] bg-[var(--surface-1)] p-5 lg:border-b-0 lg:border-r lg:p-6',
        className,
      )}
      aria-label="Upload progress"
    >
      <div className="lg:sticky lg:top-6">
        {mode === 'progress' ? (
          <IngestProgress
            progress={progress}
            statusLabel={statusLabel}
            caption={caption}
            progressLabel={progressLabel}
          />
        ) : (
          <>
            {/* Horizontal on narrow screens, where a tall rail would push the
                content off the first viewport; vertical from lg up. */}
            <WizardStepper
              steps={steps}
              current={step}
              orientation={stacked ? 'vertical' : 'horizontal'}
              onSelect={onSelectStep}
            />
            {children && (
              <div className="mt-5 space-y-3 border-t border-[var(--border)] pt-5">{children}</div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
