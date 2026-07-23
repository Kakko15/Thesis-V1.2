import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  UploadCloud, FileText, X, ArrowRight, ArrowLeft, CheckCircle2,
  ScanText, Archive, Scissors, BrainCircuit, Database, PartyPopper, AlertTriangle,
  ShieldAlert, ShieldCheck, Ban,
} from 'lucide-react'
import {
  uploadPaper, getUploadStatus, getDepartments, apiErrorMessage, extractMetadata,
  cancelUploadJob,
} from '../api'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { Input, Textarea, Select, Field } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PageTransition } from '../components/ui/Motion'
import { ConfirmDialog } from '../components/ui/Modal'
import { useAuth } from '../context/AuthContext'
import { cn, normalizePercent, scanMetrics, verdictLabel } from '../lib/utils'
import { createUploadState, emptyUploadForm, isCurrentPoll, uploadReducer } from './upload/uploadState'

const STEPS = ['Manuscript', 'Metadata', 'Review']

const PIPELINE_STAGES = [
  { key: 'download', label: 'Secure source', icon: Archive },
  { key: 'malware_scan', label: 'Malware scan', icon: ShieldCheck },
  { key: 'extract', label: 'Extract & clean', icon: ScanText },
  { key: 'chunk', label: 'Chunk (800 tokens)', icon: Scissors },
  { key: 'embed', label: 'Embed (768d)', icon: BrainCircuit },
  { key: 'screen', label: 'Screen novelty (85%)', icon: ShieldAlert },
  { key: 'index', label: 'Index vectors', icon: Database },
]

function DepartmentLoadError({ show, onRetry }) {
  if (!show) return null
  return (
    <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-flame-500/25 bg-flame-500/10 p-3 text-xs">
      <span className="flex items-center gap-2"><AlertTriangle size={14} /> Department metadata is unavailable.</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}

function uploadMetadataErrors(form) {
  const errors = {}
  if (form.title.trim().length < 5) errors.title = 'Enter the full thesis title'
  if (!form.track) errors.track = 'Select the academic track'
  if (!form.department) errors.department = 'Select the department'
  const latestYear = new Date().getFullYear() + 1
  if (form.year && (!/^\d{4}$/.test(form.year) || +form.year < 1978 || +form.year > latestYear)) {
    errors.year = 'Enter a valid year'
  }
  return errors
}

function UploadScreening({ scan }) {
  if (!scan?.flagged) return null
  const metrics = scanMetrics(scan)
  return (
    <div className="mt-6 w-full max-w-md rounded-2xl border border-gold-400/40 bg-gold-400/10 p-4 text-left">
      <div className="flex items-center gap-2 text-sm font-bold">
        <ShieldAlert size={15} className="shrink-0 text-gold-500" />
        {verdictLabel(metrics.verdict)}
      </div>
      <div className="mt-2 grid gap-1 text-xs opacity-75 sm:grid-cols-2">
        <span>Highest passage similarity: {metrics.highest.toFixed(2)}%</span>
        <span>Matched chunk coverage: {metrics.coverage.toFixed(2)}%</span>
        <span>Matched chunks / total chunks: {metrics.matchedChunks} / {metrics.totalChunks}</span>
        <span>Advisory verdict: {verdictLabel(metrics.verdict)}</span>
      </div>
      <ul className="mt-2 space-y-1 text-xs opacity-75">
        {(scan.matched_papers || []).map((paper) => (
          <li key={paper.id}>
            &quot;{paper.title || 'Untitled thesis'}&quot;{paper.year ? ` (${paper.year})` : ''} — highest passage {normalizePercent(paper.similarity).toFixed(2)}%
            {' · '}{paper.match_count} chunk{paper.match_count === 1 ? '' : 's'}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.7rem] opacity-55">
        The manuscript was still indexed. This is advisory only; faculty makes the final decision.
      </p>
    </div>
  )
}

function StepIndicator({ current }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-0">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <motion.div
              animate={{
                scale: current === i ? 1.08 : 1,
              }}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold transition-colors duration-300',
                i < current
                  ? 'bg-forest-600 text-white'
                  : i === current
                    ? 'bg-gradient-to-br from-gold-300 to-gold-400 text-forest-950 shadow-lg shadow-gold-400/30'
                    : 'glass opacity-50',
              )}
            >
              {i < current ? <CheckCircle2 size={18} /> : i + 1}
            </motion.div>
            <span className={cn('text-[0.65rem] font-semibold uppercase tracking-wider', i === current ? 'opacity-90' : 'opacity-40')}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn('mx-3 mb-5 h-0.5 w-12 rounded-full sm:w-20', i < current ? 'bg-forest-600' : 'bg-forest-900/15 dark:bg-white/15')} />
          )}
        </div>
      ))}
    </div>
  )
}

function Dropzone({ file, onFile }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFiles = useCallback((files) => {
    const f = files?.[0]
    if (!f) return
    const validMime = !f.type || ['application/pdf', 'application/x-pdf'].includes(f.type)
    if (!f.name.toLowerCase().endsWith('.pdf') || !validMime) {
      toast.error('Unsupported file', { description: 'Please upload a valid PDF manuscript.' })
      return
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.error('File too large', { description: 'Maximum size is 25 MB.' })
      return
    }
    onFile(f)
  }, [onFile])

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
      type="button"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'group flex w-full cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-6 py-14 text-center transition-all duration-300',
        dragging
          ? 'border-gold-400 bg-gold-400/10 scale-[1.01]'
          : 'border-forest-700/25 hover:border-forest-600/50 dark:border-white/15 dark:hover:border-gold-400/40',
      )}
    >
      {file ? (
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center pb-10">
          <div className="glass mb-4 flex h-16 w-16 items-center justify-center rounded-3xl">
            <FileText size={26} className="text-forest-600 dark:text-gold-300" />
          </div>
          <div className="max-w-xs truncate text-sm font-semibold">{file.name}</div>
          <div className="mt-1 text-xs opacity-50">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
        </motion.div>
      ) : (
        <>
          <motion.div
            animate={{ y: dragging ? -6 : 0 }}
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl shadow-forest-900/25 transition-transform duration-300 group-hover:scale-105"
          >
            <UploadCloud size={26} className="text-gold-300" />
          </motion.div>
          <div className="font-display text-base font-bold">
            Drop the manuscript here
          </div>
          <p className="mt-1 text-xs opacity-55">
            or click to browse · PDF only · up to 25 MB · scanned copies are OCR-processed
          </p>
        </>
      )}
      </button>
      {file && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          onClick={() => onFile(null)}
        >
          <X size={14} /> Remove
        </Button>
      )}
    </div>
  )
}

function PipelineProgress({ job }) {
  const currentIdx = PIPELINE_STAGES.findIndex((s) => s.key === job?.stage)
  return (
    <div className="space-y-5">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-forest-600 via-forest-500 to-gold-400"
          animate={{ width: `${job?.progress ?? 0}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {PIPELINE_STAGES.map((stage, i) => {
          const done = job?.status === 'completed' || i < currentIdx
          const active = i === currentIdx && ['processing', 'retry_wait'].includes(job?.status)
          return (
            <div key={stage.key} className="flex flex-col items-center gap-1.5 text-center">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-300',
                  done
                    ? 'bg-forest-600 text-white'
                    : active
                      ? 'bg-gradient-to-br from-gold-300 to-gold-400 text-forest-950 shadow-lg shadow-gold-400/30'
                      : 'glass opacity-40',
                )}
              >
                {done ? <CheckCircle2 size={16} /> : <stage.icon size={16} className={active ? 'animate-pulse' : ''} />}
              </div>
              <span className={cn('text-[0.6rem] font-semibold leading-tight', active || done ? 'opacity-80' : 'opacity-40')}>
                {stage.label}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-center text-sm opacity-65">{job?.message}</p>
      {job?.status === 'retry_wait' && (
        <div className="rounded-xl border border-gold-400/35 bg-gold-400/10 px-4 py-3 text-center text-xs">
          Temporary service interruption. Automatic retry {job.attempt_count}/{job.max_attempts}
          {job.next_retry_at ? ` is scheduled for ${new Date(job.next_retry_at).toLocaleTimeString()}.` : ' is scheduled.'}
        </div>
      )}
    </div>
  )
}

// The multi-step wizard intentionally keeps its declarative stage rendering in one component.
// eslint-disable-next-line complexity
export default function Upload() {
  const { isSuperadmin, department: userDepartment } = useAuth()
  const enforcedDepartment = userDepartment || 'CCSICT'
  const [state, dispatch] = useReducer(uploadReducer, enforcedDepartment, createUploadState)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { step, file, form, errors, job, submitting, parsing, pendingFile, pollError } = state
  const setStep = (value) => dispatch({ type: 'set-step', step: value })
  const setFile = (value) => dispatch({ type: 'set-file', file: value })
  const setForm = (value) => dispatch({ type: 'set-form', value })
  const setErrors = (value) => dispatch({ type: 'set-errors', errors: value })
  const setJob = (value) => dispatch({ type: 'set-job', job: value })
  const setSubmitting = (value) => dispatch({ type: 'set-submitting', value })
  const setParsing = (value) => dispatch({ type: 'set-parsing', value })
  const setPendingFile = (value) => dispatch({ type: 'set-pending-file', file: value })
  const setPollError = (value) => dispatch({ type: 'set-poll-error', value })
  const pollRef = useRef(null)
  const pollFailuresRef = useRef(0)
  const pollStartedRef = useRef(0)
  const jobIdRef = useRef(null)
  const pollGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: departments = [],
    isLoading: loadingDepts,
    isError: departmentsError,
    refetch: retryDepartments,
  } = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  
  // Find the currently selected department object
  const currentDept = departments.find(d => d.name === form.department)
  const trackLabel = currentDept?.track_label || 'Track'
  const currentTracks = currentDept?.tracks || []

  const stopPolling = useCallback(() => {
    pollGenerationRef.current += 1
    clearTimeout(pollRef.current)
    pollRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])
  useEffect(() => {
    if (!isSuperadmin) {
      setForm((current) => ({ ...current, department: enforcedDepartment }))
    }
  }, [enforcedDepartment, isSuperadmin])

  const set = (key) => (e) => dispatch({ type: 'set-field', key, value: e.target.value })

  const runAutofill = async (f) => {
    setParsing(true)
    toast.info('Extracting metadata...', { description: 'Analyzing the document to autofill information.' })
    try {
      const metadata = await extractMetadata(f)
      setForm((prev) => ({
        ...prev,
        title: metadata.title || prev.title,
        authors: metadata.authors || prev.authors,
        year: metadata.year || prev.year,
        department: isSuperadmin ? metadata.department || prev.department : enforcedDepartment,
      }))
      if (metadata.title || metadata.authors || metadata.year || metadata.department) {
        toast.success('Metadata autofilled', { description: 'Extracted available information from the document.' })
      } else {
        toast.warning('Extraction incomplete', { description: 'Could not confidently identify thesis details.' })
      }
    } catch {
      toast.error('Autofill failed', { description: 'Please enter the metadata manually.' })
    } finally {
      setParsing(false)
    }
  }

  const handleFileSelect = (f) => {
    if (!f) {
      setFile(null)
      setForm(emptyUploadForm(enforcedDepartment))
      idempotencyKeyRef.current = crypto.randomUUID()
      return
    }
    idempotencyKeyRef.current = crypto.randomUUID()
    setPendingFile(f)
  }

  const validateMetadata = () => {
    const next = uploadMetadataErrors(form)
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const startPolling = (jobId) => {
    stopPolling()
    const generation = pollGenerationRef.current
    jobIdRef.current = jobId
    pollFailuresRef.current = 0
    pollStartedRef.current = Date.now()
    setPollError('')

    const poll = async () => {
      const current = () => isCurrentPoll({
        mounted: mountedRef.current,
        generation,
        currentGeneration: pollGenerationRef.current,
        jobId,
        currentJobId: jobIdRef.current,
      })
      if (!current()) return
      if (Date.now() - pollStartedRef.current > 30 * 60 * 1000) {
        setPollError('Status checking paused after 30 minutes. You can resume it safely.')
        return
      }
      try {
        const status = await getUploadStatus(jobId)
        if (!current()) return
        pollFailuresRef.current = 0
        setJob(status)
        if (status.status === 'completed') {
          sessionStorage.removeItem('activeUploadJob')
          queryClient.invalidateQueries({ queryKey: ['papers'] })
          toast.success('Thesis indexed!', {
            description: `${status.chunks} semantic chunks embedded into the archive.`,
          })
          if (status.duplication?.flagged) {
            const metrics = scanMetrics(status.duplication)
            toast.warning('Potential duplication detected', {
              description: `${metrics.highest.toFixed(2)}% highest passage similarity; ${metrics.coverage.toFixed(2)}% matched chunk coverage. ${verdictLabel(metrics.verdict)}.`,
            })
          }
        } else if (status.status === 'failed') {
          sessionStorage.removeItem('activeUploadJob')
          toast.error('Ingestion failed', { description: status.error })
        } else if (status.status === 'cancelled') {
          sessionStorage.removeItem('activeUploadJob')
          toast.info('Upload cancelled', { description: 'The staged manuscript is being removed safely.' })
        } else {
          pollRef.current = setTimeout(poll, 1500)
        }
      } catch (error) {
        if (!current()) return
        if (error?.response?.status === 404) {
          sessionStorage.removeItem('activeUploadJob')
          setPollError('This upload job has expired or is no longer available.')
          return
        }
        pollFailuresRef.current += 1
        if (pollFailuresRef.current >= 5) {
          setPollError('The server could not confirm the upload status. The job was not cancelled.')
          return
        }
        pollRef.current = setTimeout(poll, 1500 * pollFailuresRef.current)
      }
    }
    pollRef.current = setTimeout(poll, 500)
  }

  useEffect(() => {
    const saved = sessionStorage.getItem('activeUploadJob')
    if (!saved) return
    try {
      const active = JSON.parse(saved)
      if (active.jobId) {
        idempotencyKeyRef.current = active.idempotencyKey || crypto.randomUUID()
        setJob({ status: 'queued', stage: 'download', progress: 8, message: 'Restoring durable upload status…' })
        setStep(3)
        startPolling(active.jobId)
      }
    } catch {
      sessionStorage.removeItem('activeUploadJob')
    }
    // Restoring is intentionally a one-time mount action; polling owns later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await uploadPaper({ file, ...form, idempotencyKey: idempotencyKeyRef.current })
      sessionStorage.setItem('activeUploadJob', JSON.stringify({
        jobId: res.job_id,
        idempotencyKey: res.idempotency_key || idempotencyKeyRef.current,
      }))
      setJob({ status: res.status, stage: 'download', progress: 8, message: res.message })
      setStep(3)
      startPolling(res.job_id)
    } catch (err) {
      toast.error('Upload failed', { description: apiErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    stopPolling()
    jobIdRef.current = null
    sessionStorage.removeItem('activeUploadJob')
    idempotencyKeyRef.current = crypto.randomUUID()
    dispatch({ type: 'reset', department: enforcedDepartment })
  }

  const confirmCancellation = async () => {
    if (!jobIdRef.current) return
    setCancelling(true)
    try {
      const result = await cancelUploadJob(jobIdRef.current, 'Cancelled by uploader')
      setJob({
        ...job,
        status: result.status,
        cancel_requested: result.cancel_requested,
        cancelled_at: result.cancelled_at,
        can_cancel: false,
        message: result.status === 'cancelled'
          ? 'Upload cancelled. Secure cleanup is pending.'
          : 'Cancellation requested. The worker will stop at the next safe checkpoint.',
      })
      toast.success(result.status === 'cancelled' ? 'Upload cancelled' : 'Cancellation requested')
    } catch (error) {
      toast.error('Could not cancel upload', { description: apiErrorMessage(error) })
    } finally {
      setCancelling(false)
      setCancelOpen(false)
    }
  }

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Upload <span className="text-gradient-isu">Thesis</span>
        </h1>
        <p className="mt-1 text-sm opacity-55">
          Digitize a thesis manuscript into its department-scoped semantic archive.
        </p>
      </div>

      <GlassCard className="p-6 sm:p-10">
        <DepartmentLoadError show={departmentsError} onRetry={() => retryDepartments()} />
        {step < 3 && <StepIndicator current={step} />}

        <AnimatePresence mode="wait">
          {/* Step 1: file */}
          {step === 0 && (
            <motion.div
              key="file"
              initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3 }}
            >
              <Dropzone file={file} onFile={handleFileSelect} />
              <div className="mt-6 flex justify-end">
                <Button disabled={!file || parsing} loading={parsing} onClick={() => setStep(1)} className="group">
                  {parsing ? 'Extracting...' : 'Continue'} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 2: metadata */}
          {step === 1 && (
            <motion.div
              key="meta"
              initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              <Field label="Thesis title" error={errors.title} required>
                <Input value={form.title} onChange={set('title')} placeholder="Full official thesis title" error={errors.title} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Authors" hint="Separate multiple authors with commas">
                  <Input value={form.authors} onChange={set('authors')} placeholder="Dela Cruz, J., Santos, M." />
                </Field>
                <Field label="Year completed" error={errors.year}>
                  <Input value={form.year} onChange={set('year')} placeholder="2024" inputMode="numeric" maxLength={4} error={errors.year} />
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field 
                  label={trackLabel} 
                  error={errors.track} 
                  required 
                  hint="Metadata tag attached to semantic chunk"
                >
                  <Select value={form.track} onChange={set('track')} error={errors.track} disabled={!form.department || currentTracks.length === 0} aria-label={`Select ${trackLabel}`}>
                    <option value="">Select {trackLabel}…</option>
                    {currentTracks.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </Field>
                <Field label="Department" error={errors.department} required hint="Department this thesis belongs to">
                  {isSuperadmin ? (
                    <Select value={form.department} onChange={(e) => setForm(f => ({...f, department: e.target.value, track: ''}))} error={errors.department} disabled={loadingDepts} aria-label="Select thesis department">
                      <option value="">Select a Department…</option>
                      {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </Select>
                  ) : (
                    <div className="glass flex h-11 items-center rounded-xl px-3"><Badge tone="neutral">{enforcedDepartment}</Badge></div>
                  )}
                </Field>
              </div>
              <Field label="Abstract" hint="Optional but improves archive browsing">
                <Textarea value={form.abstract} onChange={set('abstract')} placeholder="Paste the thesis abstract…" rows={4} />
              </Field>
              <div className="flex justify-between pt-1">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  <ArrowLeft size={15} /> Back
                </Button>
                <Button onClick={() => validateMetadata() && setStep(2)} className="group">
                  Review <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3: review */}
          {step === 2 && (
            <motion.div
              key="review"
              initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
            >
              <div className="glass space-y-4 rounded-2xl p-5">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="shrink-0 text-gold-400" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{file?.name}</div>
                    <div className="text-xs opacity-50">{(file?.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                </div>
                <div className="grid gap-3 border-t border-forest-900/10 pt-4 text-sm dark:border-white/10 sm:grid-cols-2">
                  <div>
                    <div className="text-[0.65rem] font-bold uppercase tracking-wider opacity-45">Title</div>
                    <div className="mt-0.5 font-medium">{form.title}</div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] font-bold uppercase tracking-wider opacity-45">Authors</div>
                    <div className="mt-0.5 font-medium">{form.authors || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] font-bold uppercase tracking-wider opacity-45">Track</div>
                    <div className="mt-0.5"><Badge tone="forest">{form.track}</Badge></div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] font-bold uppercase tracking-wider opacity-45">Department</div>
                    <div className="mt-0.5"><Badge tone="neutral">{form.department}</Badge></div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] font-bold uppercase tracking-wider opacity-45">Year</div>
                    <div className="mt-0.5 font-medium">{form.year || '—'}</div>
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed opacity-55">
                On submit, the manuscript is cleaned (headers, footers, page numbers, TOC, and
                bibliography stripped), split into 800-token chunks with metadata tags, embedded via
                Gemini, and indexed in the pgvector archive. The original PDF is stored privately.
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft size={15} /> Back
                </Button>
                <Button variant="gold" loading={submitting} onClick={submit}>
                  <UploadCloud size={16} /> Ingest into archive
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 4: pipeline progress */}
          {step === 3 && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
              className="space-y-8 py-4"
            >
              {job?.status === 'completed' ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  className="flex flex-col items-center text-center"
                >
                  <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-forest-600/15">
                    <PartyPopper size={34} className="text-forest-600 dark:text-forest-300" />
                  </div>
                  <h2 className="font-display text-2xl font-extrabold">Thesis indexed!</h2>
                  <p className="mt-2 max-w-sm text-sm opacity-60">
                    "{form.title}" is now part of the semantic archive with {job.chunks} embedded chunks.
                  </p>
                  <UploadScreening scan={job.duplication} />
                  <div className="mt-7 flex gap-3">
                    <Button variant="secondary" onClick={reset}>Upload another</Button>
                    <Button onClick={() => navigate('/archive')}>View archive <ArrowRight size={15} /></Button>
                  </div>
                </motion.div>
              ) : job?.status === 'failed' ? (
                <div className="flex flex-col items-center text-center">
                  <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-flame-500/12">
                    <AlertTriangle size={32} className="text-flame-500" />
                  </div>
                  <h2 className="font-display text-2xl font-extrabold">Ingestion failed</h2>
                  <p className="mt-2 max-w-sm text-sm opacity-60">{job.error}</p>
                  <Button variant="secondary" className="mt-7" onClick={reset}>Try again</Button>
                </div>
              ) : job?.status === 'cancelled' ? (
                <div className="flex flex-col items-center text-center">
                  <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gold-400/15">
                    <Ban size={32} className="text-gold-500" />
                  </div>
                  <h2 className="font-display text-2xl font-extrabold">Upload cancelled</h2>
                  <p className="mt-2 max-w-sm text-sm opacity-60">
                    The manuscript was not indexed. Its staged private copy is being removed safely.
                  </p>
                  <Button variant="secondary" className="mt-7" onClick={reset}>Start a new upload</Button>
                </div>
              ) : (
                <>
                  <PipelineProgress job={job} />
                  {job?.cancel_requested && (
                    <div className="rounded-2xl border border-gold-400/35 bg-gold-400/10 p-4 text-center text-sm">
                      Cancellation requested. Processing will stop at the next safe checkpoint.
                    </div>
                  )}
                  {job?.can_cancel && !job?.cancel_requested && (
                    <div className="flex justify-center">
                      <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                        <Ban size={15} /> Cancel upload
                      </Button>
                    </div>
                  )}
                  {pollError && (
                    <div className="mt-5 rounded-2xl border border-gold-400/35 bg-gold-400/10 p-4 text-center">
                      <p className="text-sm opacity-75">{pollError}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        onClick={() => jobIdRef.current && startPolling(jobIdRef.current)}
                      >
                        Resume status check
                      </Button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      <ConfirmDialog
        open={!!pendingFile}
        onClose={() => {
          setFile(pendingFile)
          setPendingFile(null)
        }}
        onConfirm={() => {
          const f = pendingFile
          setFile(f)
          setPendingFile(null)
          runAutofill(f)
        }}
        title="Autofilling the field"
        message="Confirm the file and move on the next step"
        confirmLabel="Confirm"
      />
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={confirmCancellation}
        title="Cancel this upload?"
        message="The worker will stop safely, the manuscript will not be indexed, and its staged private copy will be cleaned up. To submit it again, start a new upload."
        confirmLabel="Cancel upload"
        danger
        loading={cancelling}
      />
    </PageTransition>
  )
}
