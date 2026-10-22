import { AlertTriangle, FileSearch, History, X } from 'lucide-react'
import { apiErrorMessage, isRetryableFailure, SCAN_HISTORY_LIMIT } from '../../api'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn, scanMetrics, timeAgo, verdictLabel, verdictTone } from '../../lib/utils'
import { slotKeys } from '../../lib/keys'
import { PANEL } from './panel'
import { isCapsuleScan } from './capsule'

const HISTORY_SKELETONS = slotKeys(4, 'novelty-history')

// Keyed off the shared verdict tone so a history row can never disagree with
// the verdict it opens onto. Semantic aliases rather than hues, matching the
// archive card, so the audited AA pairings still apply.
const HISTORY_TONE = {
  critical: 'text-flame-500',
  warning: 'text-gold-text dark:text-gold-300',
  neutral: 'text-forest-700 dark:text-forest-300',
}

/**
 * The reviewer's recent scans, each opening its report.
 *
 * Sticky beside the report on desktop, and a fixed height on every screen with
 * the list scrolling inside it. Capped only at the viewport, ten rows already
 * ran the panel to the bottom of the screen and it kept growing with every
 * scan; the server now also returns only the most recent SCAN_HISTORY_LIMIT.
 */
export function ScanHistoryPanel({
  history, loading, failure, onRetry, activeScanId, onOpen, onRemove, onClearAll,
}) {
  return (
    <aside className={cn(PANEL, 'flex max-h-[28rem] flex-col p-4 lg:sticky lg:top-6 lg:max-h-[min(34rem,calc(100vh-3rem))]')} aria-label="Scan history">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History size={16} className="text-ink-muted" aria-hidden="true" /> Scan history
          {history.length > 0 && <span className="text-xs font-normal text-ink-muted">{history.length}</span>}
        </h2>
        {history.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-auto px-2 py-1 text-xs font-semibold text-ink-muted hover:bg-flame-500/10 hover:text-flame-500"
          >
            Clear all
          </Button>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">{HISTORY_SKELETONS.map((slotId) => <Skeleton key={slotId} className="h-16" />)}</div>
      ) : failure ? (
        <div role="alert" className="rounded-xl bg-flame-500/10 p-3 text-xs">
          {/* The server states why — a privilege or two-factor refusal is
              actionable, and hiding it behind a generic line leaves the
              reader with a broken panel and no way to know what to fix. */}
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{apiErrorMessage(failure, 'Scan history is unavailable.')}</span>
          </div>
          {isRetryableFailure(failure) && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>Retry</Button>
          )}
        </div>
      ) : history.length === 0 ? (
        <EmptyState icon={FileSearch} title="No scans yet" message="Your novelty scans will appear here." />
      ) : (
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {history.map((scan) => {
            const metrics = scanMetrics(scan)
            const active = activeScanId === scan.id
            return (
              <div
                key={scan.id}
                className={cn(
                  'group flex items-center gap-1 rounded-xl px-1 transition-colors duration-200',
                  active
                    ? 'bg-forest-600/12 dark:bg-forest-400/12'
                    : 'hover:bg-forest-900/6 dark:hover:bg-white/6',
                )}
              >
                <button
                  type="button"
                  onClick={() => onOpen(scan)}
                  className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left active:scale-[0.98] transition-transform touch-manipulation"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold" title={scan.filename}>{scan.filename}</span>
                    {/* Coloured by the verdict, not by a coverage band of
                        its own. While this read `coverage >= 50` and the
                        verdict was graded on concentration, a row could
                        show a red number beside a "review suggested"
                        result. */}
                    <span
                      className={cn(
                        'shrink-0 font-display text-sm font-extrabold',
                        HISTORY_TONE[verdictTone(metrics.verdict)] ?? HISTORY_TONE.neutral,
                      )}
                      title={verdictLabel(metrics.verdict)}
                    >
                      {metrics.concentration.toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted">
                    {isCapsuleScan(scan) ? 'Capsule · ' : ''}{timeAgo(scan.created_at)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(scan)
                  }}
                  aria-label={`Remove scan ${scan.filename}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-flame-500/10 hover:text-flame-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )
          })}
          {history.length >= SCAN_HISTORY_LIMIT && (
            <p className="px-2 pb-1 pt-3 text-center text-xs text-ink-muted">
              Showing your {SCAN_HISTORY_LIMIT} most recent scans.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
