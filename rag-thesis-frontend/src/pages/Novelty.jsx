import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClipboardList, ShieldCheck, FileSearch, Layers } from 'lucide-react'
import {
  scanDuplication, scanCapsule, getScanHistory, deleteScanHistory, clearScanHistory,
  apiErrorMessage, getDepartments,
} from '../api'
import { useAuth } from '../context/AuthContext'
import { ConfirmDialog } from '../components/ui/Modal'
import { PageTransition } from '../components/ui/Motion'
import { Select } from '../components/ui/Input'
import { cn, scanMetrics } from '../lib/utils'
import { ScanDropzone } from './novelty/ScanDropzone'
import { BatchScanPanel } from './novelty/BatchScanPanel'
import { ScanReport } from './novelty/ScanReport'
import { ScanHistoryPanel } from './novelty/ScanHistoryPanel'
import { CapsuleForm } from './novelty/CapsuleForm'
import { capsulePayload, isCapsuleScan } from './novelty/capsule'
import { PANEL } from './novelty/panel'

// Single and batch take manuscripts; a capsule is the short proposal an
// adviser reviews before any manuscript exists, typed in section by section.
const SCAN_MODES = [
  { value: 'single', label: 'Single', icon: FileSearch, hint: 'One manuscript, one advisory report.' },
  { value: 'batch', label: 'Batch', icon: Layers, hint: 'Each manuscript is scanned and saved to history on its own.' },
  { value: 'capsule', label: 'Capsule', icon: ClipboardList, hint: 'A proposal before the manuscript: each section is checked on its own.' },
]
const MODE_VALUES = new Set(SCAN_MODES.map((item) => item.value))

/** The toast after a scan, in the terms the scan was graded in. */
function announceScan(result) {
  const metrics = scanMetrics(result)
  if (isCapsuleScan(result)) {
    const flagged = `${metrics.matchedChunks} of ${metrics.totalChunks} sections flagged`
    if (metrics.verdict === 'high_overlap') toast.warning(`High overlap—faculty review required: ${flagged}`)
    else toast.success(`Capsule checked — ${flagged}`)
    return
  }
  if (metrics.verdict === 'high_overlap') {
    toast.warning(`High overlap—faculty review required: ${metrics.concentration.toFixed(1)}% of passages closest to one thesis`)
  } else {
    toast.success(`Scan complete — ${metrics.concentration.toFixed(1)}% of passages closest to one thesis`)
  }
}

/**
 * The scan mode, as a segmented control -- the same shape as the archive's
 * category tabs, so the two pages switch views the same way.
 */
function ScanModeSwitch({ value, onChange, disabled }) {
  return (
    <div
      role="radiogroup"
      aria-label="Scan mode"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-forest-900/10 bg-forest-900/[0.04] p-1 shadow-2xs dark:border-white/10 dark:bg-white/[0.04]"
    >
      {SCAN_MODES.map(({ value: mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            value === mode
              ? 'bg-forest-800 font-bold text-white shadow-2xs dark:bg-forest-400 dark:text-forest-950'
              : 'text-ink-muted hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10',
          )}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
export default function Novelty() {
  const { isSuperadmin, department: userDepartment } = useAuth()
  const [activeScan, setActiveScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [department, setDepartment] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const queryClient = useQueryClient()
  // In the URL, like the settings section, so /novelty?mode=batch deep-links
  // and survives a reload.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedMode = searchParams.get('mode')
  const mode = MODE_VALUES.has(requestedMode) ? requestedMode : 'single'
  const setMode = (next) => setSearchParams(next === 'single' ? {} : { mode: next }, { replace: true })

  const {
    data: history = [],
    isLoading: loadingHistory,
    isError: historyError,
    error: historyFailure,
    refetch: retryHistory,
  } = useQuery({
    queryKey: ['scan-history'],
    queryFn: getScanHistory,
  })
  const { data: departments = [], isError: departmentsError } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
    enabled: isSuperadmin,
  })
  const effectiveDepartment = isSuperadmin
    ? (department || userDepartment || 'CCSICT')
    : (userDepartment || 'CCSICT')

  const handleDeleteScan = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteScanHistory(deleteTarget.id)
      if (activeScan?.id === deleteTarget.id) {
        setActiveScan(null)
      }
      await queryClient.invalidateQueries({ queryKey: ['scan-history'] })
      toast.success('Scan removed from history')
      setDeleteTarget(null)
    } catch (err) {
      toast.error('Could not remove scan', { description: apiErrorMessage(err) })
    } finally {
      setDeleting(false)
    }
  }

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await clearScanHistory()
      setActiveScan(null)
      await queryClient.invalidateQueries({ queryKey: ['scan-history'] })
      toast.success('All scan history cleared')
      setConfirmClearOpen(false)
    } catch (err) {
      toast.error('Could not clear history', { description: apiErrorMessage(err) })
    } finally {
      setClearing(false)
    }
  }

  const scanDepartment = isSuperadmin ? department || null : null
  const runScan = async (request) => {
    setScanning(true)
    setActiveScan(null)
    try {
      const result = await request()
      setActiveScan(result)
      queryClient.invalidateQueries({ queryKey: ['scan-history'] })
      announceScan(result)
    } catch (err) {
      toast.error('Scan failed', { description: apiErrorMessage(err) })
    } finally {
      setScanning(false)
    }
  }
  const scanFile = (file) => runScan(() => scanDuplication(file, scanDepartment))
  const checkCapsule = (capsule) => runScan(() => scanCapsule(capsulePayload(capsule), scanDepartment))

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      {/* The department picker was a full-width form field, so on desktop it
          sat on a row of its own above the access note and pushed the whole
          page down; as a chip it shares the title's row. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Novelty <span className="text-gradient-isu">Check</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Validate proposed topics against the archive at the 85% similarity threshold.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuperadmin ? (
            <Select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Scan department"
              className="h-9 w-auto rounded-full px-3.5 text-xs font-medium"
            >
              <option value="">Default ({userDepartment || 'CCSICT'})</option>
              {departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </Select>
          ) : (
            <span className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-3.5 text-xs font-medium">
              {effectiveDepartment}
            </span>
          )}
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 text-xs font-medium text-ink-muted">
            <ShieldCheck size={13} className="text-gold-text dark:text-gold-300" aria-hidden="true" />
            Faculty &amp; administrators only
          </span>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-5">
          <div className={cn(PANEL, 'space-y-4 p-5 sm:p-6')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ScanModeSwitch value={mode} onChange={setMode} disabled={scanning} />
              <p className="text-xs text-ink-muted">
                {SCAN_MODES.find((item) => item.value === mode)?.hint}
              </p>
            </div>
            {/* All stay mounted so switching modes never drops a batch that is
                queued or mid-scan, or a capsule half typed; only the inactive
                ones are hidden. */}
            <div hidden={mode !== 'single'}>
              <ScanDropzone onScan={scanFile} scanning={scanning} />
            </div>
            <div hidden={mode !== 'capsule'}>
              <CapsuleForm onScan={checkCapsule} scanning={scanning} />
            </div>
            <div hidden={mode !== 'batch'}>
              <BatchScanPanel
                department={scanDepartment}
                activeScanId={activeScan?.id}
                onOpen={setActiveScan}
                onScanned={() => queryClient.invalidateQueries({ queryKey: ['scan-history'] })}
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            {activeScan && (
              <ScanReport
                key={activeScan.id}
                scan={activeScan}
                onAsk={() => queryClient.invalidateQueries({ queryKey: ['scan-history'] })}
              />
            )}
          </AnimatePresence>
        </div>

        <ScanHistoryPanel
          history={history}
          loading={loadingHistory}
          failure={historyError ? historyFailure : null}
          onRetry={() => retryHistory()}
          activeScanId={activeScan?.id}
          onOpen={setActiveScan}
          onRemove={setDeleteTarget}
          onClearAll={() => setConfirmClearOpen(true)}
        />
      </div>
      {isSuperadmin && departmentsError && (
        <p role="alert" className="text-xs text-flame-500">Department choices could not be loaded. The enforced default remains active.</p>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleDeleteScan}
        title="Remove this scan?"
        message={`"${deleteTarget?.filename}" and its advisory report will be permanently removed.`}
        confirmLabel="Remove scan"
        danger
        loading={deleting}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        onClose={() => !clearing && setConfirmClearOpen(false)}
        onConfirm={handleClearAll}
        title="Clear all scan history?"
        message="All novelty check records and advisory reports will be permanently removed."
        confirmLabel="Clear all"
        danger
        loading={clearing}
      />
    </PageTransition>
  )
}
