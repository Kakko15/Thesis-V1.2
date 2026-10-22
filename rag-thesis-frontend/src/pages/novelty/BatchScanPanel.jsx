import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Clock, FileText, Loader2, X, XCircle } from 'lucide-react'
import { scanDuplication, apiErrorMessage } from '../../api'
import { Button } from '../../components/ui/Button'
import { cn, scanMetrics, verdictLabel, verdictTone } from '../../lib/utils'
import { formatFileSize } from '../upload/wizardSteps'
import {
  MAX_BATCH_SCAN_FILES, RATE_LIMIT_RETRIES, addScanFiles, batchScanProgress, isRetryableScanFailure,
  nextQueued, removeScanEntry, retryDelayMs, updateScanEntry,
} from './batchScan'
import { ScanDropzone } from './ScanDropzone'

const RESULT_TONE = {
  critical: 'text-flame-500',
  warning: 'text-gold-text dark:text-gold-300',
  neutral: 'text-forest-700 dark:text-forest-300',
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

function StatusLine({ entry }) {
  if (entry.status === 'scanning') {
    return <span className="inline-flex items-center gap-1 text-ink-muted"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Scanning…</span>
  }
  if (entry.status === 'waiting') {
    return <span className="inline-flex items-center gap-1 text-ink-muted"><Clock size={12} aria-hidden="true" /> {entry.note}</span>
  }
  if (entry.status === 'failed') {
    return <span className="inline-flex items-start gap-1 text-flame-600 dark:text-flame-200"><XCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {entry.error}</span>
  }
  if (entry.status === 'done') {
    const metrics = scanMetrics(entry.scan)
    return (
      <span className="inline-flex items-center gap-1 text-ink-muted">
        <CheckCircle2 size={12} className="text-forest-600 dark:text-forest-300" aria-hidden="true" />
        {verdictLabel(metrics.verdict)}
      </span>
    )
  }
  return <span className="text-ink-muted">Waiting · {formatFileSize(entry.file.size)}</span>
}

/**
 * Several manuscripts scanned one after another, each row opening onto the
 * same report a single scan produces.
 */
export function BatchScanPanel({ department, activeScanId, onOpen, onScanned }) {
  const [entries, setEntries] = useState([])
  const [running, setRunning] = useState(false)
  // The loop reads the queue from here rather than from state, so a file
  // removed while an earlier one is scanning is not picked up afterwards.
  const entriesRef = useRef(entries)
  const stopRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      // Leaving the page ends the loop after the file in flight; that scan
      // still lands in history server-side.
      mountedRef.current = false
      stopRef.current = true
    }
  }, [])

  const commit = (next) => {
    entriesRef.current = next
    if (mountedRef.current) setEntries(next)
  }
  const patch = (id, values) => commit(updateScanEntry(entriesRef.current, id, values))

  const addFiles = (files) => {
    const { entries: next, rejected } = addScanFiles(entriesRef.current, files)
    commit(next)
    if (rejected.length === 1) {
      toast.error(`${rejected[0].name} was not added`, { description: rejected[0].reason })
    } else if (rejected.length > 1) {
      toast.error(`${rejected.length} files were not added`, {
        description: [...new Set(rejected.map((item) => item.reason))].join(' '),
      })
    }
  }

  const scanWithRetry = async (entry) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await scanDuplication(entry.file, department)
      } catch (error) {
        if (!isRetryableScanFailure(error) || attempt >= RATE_LIMIT_RETRIES || stopRef.current) throw error
        const delay = retryDelayMs(error)
        const reason = error.response.status === 429 ? 'Rate limited' : 'Service busy'
        patch(entry.id, { status: 'waiting', note: `${reason} — retrying in ${Math.round(delay / 1000)} s` })
        await sleep(delay)
        if (stopRef.current) throw error
        patch(entry.id, { status: 'scanning', note: '' })
      }
    }
  }

  const run = async () => {
    stopRef.current = false
    setRunning(true)
    for (let entry = nextQueued(entriesRef.current); entry && !stopRef.current; entry = nextQueued(entriesRef.current)) {
      patch(entry.id, { status: 'scanning', error: '' })
      try {
        const scan = await scanWithRetry(entry)
        patch(entry.id, { status: 'done', scan })
        onScanned?.(scan)
      } catch (error) {
        patch(entry.id, { status: 'failed', note: '', error: apiErrorMessage(error, 'Scan failed') })
      }
    }
    if (!mountedRef.current) return
    setRunning(false)
    const progress = batchScanProgress(entriesRef.current)
    if (progress.failed > 0) {
      toast.warning(`Batch finished: ${progress.done} scanned, ${progress.failed} failed`)
    } else if (progress.queued === 0) {
      toast.success(`Batch finished: ${progress.done} manuscript${progress.done === 1 ? '' : 's'} scanned`)
    }
  }

  const retryFailed = () => {
    commit(entriesRef.current.map((entry) => (
      entry.status === 'failed' ? { ...entry, status: 'queued', error: '' } : entry
    )))
  }
  const clearFinished = () => commit(entriesRef.current.filter((entry) => !['done', 'failed'].includes(entry.status)))

  const progress = batchScanProgress(entries)
  const percent = progress.total ? Math.round((progress.finished / progress.total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Never disabled: a file added mid-batch joins the end of the queue. */}
      <ScanDropzone multiple compact={entries.length > 0} onFiles={addFiles} />

      {entries.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 text-sm">
              <span className="font-semibold">{progress.finished} of {progress.total} scanned</span>
              {progress.failed > 0 && <span className="text-flame-600 dark:text-flame-200"> · {progress.failed} failed</span>}
              <span className="text-ink-muted"> · up to {MAX_BATCH_SCAN_FILES} per batch</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <Button variant="ghost" size="sm" onClick={() => { stopRef.current = true }}>
                  Stop after this file
                </Button>
              ) : (
                <>
                  {progress.failed > 0 && <Button variant="ghost" size="sm" onClick={retryFailed}>Retry failed</Button>}
                  {progress.finished > 0 && <Button variant="ghost" size="sm" onClick={clearFinished}>Clear finished</Button>}
                  {progress.queued > 0 && (
                    <Button size="sm" onClick={run}>
                      Scan {progress.queued} manuscript{progress.queued === 1 ? '' : 's'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          <div
            className="h-1 bg-[var(--border)]"
            role="progressbar"
            aria-label="Batch scan progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-1 bg-[var(--primary)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          {/* Capped with its own scroll: ten rows used to push the report a
              full screen below the queue. */}
          <ul className="max-h-[19rem] divide-y divide-[var(--border)] overflow-y-auto" aria-label="Manuscripts in this batch">
            {entries.map((entry) => {
              const metrics = entry.scan ? scanMetrics(entry.scan) : null
              const open = entry.status === 'done' && entry.scan?.id === activeScanId
              return (
                <li
                  key={entry.id}
                  className={cn('flex items-center gap-3 px-4 py-2 text-xs', open && 'bg-[var(--primary-container)]/40')}
                >
                  <FileText size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={entry.file.name}>{entry.file.name}</div>
                    {/* A failure reason wraps, because cut off mid-sentence it is
                        the one line on the row worth reading; every other status
                        is short and stays on one line so a phone row stays one row. */}
                    <div className={cn('mt-0.5', entry.status === 'failed' ? 'break-words' : 'truncate')}>
                      <StatusLine entry={entry} />
                    </div>
                  </div>
                  {metrics && (
                    <span
                      className={cn('shrink-0 font-display text-base font-extrabold tabular-nums', RESULT_TONE[verdictTone(metrics.verdict)] ?? RESULT_TONE.neutral)}
                      title={`${metrics.concentration.toFixed(1)}% of passages closest to one archived thesis`}
                    >
                      {metrics.concentration.toFixed(0)}%
                    </span>
                  )}
                  {entry.status === 'done' && (
                    <Button variant={open ? 'secondary' : 'outline'} size="sm" onClick={() => onOpen(entry.scan)} aria-label={`View report for ${entry.file.name}`}>
                      {open ? 'Viewing' : 'View'}
                    </Button>
                  )}
                  {(entry.status === 'queued' || entry.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => commit(removeScanEntry(entriesRef.current, entry.id))}
                      aria-label={`Remove ${entry.file.name} from the batch`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-flame-500/10 hover:text-flame-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <X size={15} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
