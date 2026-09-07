import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Layers, UploadCloud } from 'lucide-react'
import {
  uploadPaper, getUploadStatus, getDepartments, apiErrorMessage, extractMetadata,
  cancelUploadJob,
} from '../api'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { PageTransition } from '../components/ui/Motion'
import { ConfirmDialog } from '../components/ui/Modal'
import { useAuth } from '../context/AuthContext'
import { cn, scanMetrics, verdictLabel } from '../lib/utils'
import { thesisCategoryLabel } from '../lib/catalog'
import {
  createUploadState, emptyUploadForm, isCurrentPoll, uploadMetadataErrors, uploadReducer, UPLOAD_STEPS,
} from './upload/uploadState'
import {
  WIZARD_STEPS, autofilledKeys, isTerminalJob, railMode, stageView, summaryRows,
} from './upload/wizardSteps'
import { Dropzone } from '../components/upload/Dropzone'
import { RailFileChip, RailHeading, RailSummaryList, WizardRail } from '../components/upload/WizardRail'
import { WizardStep } from '../components/upload/WizardStep'
import { MetadataForm } from '../components/upload/MetadataForm'
import { ReviewPanel } from '../components/upload/ReviewPanel'
import { PipelineTimeline } from '../components/upload/PipelineTimeline'
import { IngestOutcome } from '../components/upload/IngestOutcome'

const STATUS_LABELS = {
  staging: 'Staging',
  queued: 'Queued',
  processing: 'Processing',
  retry_wait: 'Retrying',
  completed: 'Indexed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function DepartmentLoadError({ show, onRetry }) {
  if (!show) return null
  return (
    <div role="alert" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-flame-500/25 bg-flame-500/10 p-3 text-xs">
      <span className="flex items-center gap-2"><AlertTriangle size={14} aria-hidden="true" /> Department metadata is unavailable.</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}

/** Ingestion in flight: the timeline plus whatever the job lets you do about it. */
function IngestingPanel({ job, pollError, onCancel, onResume }) {
  return (
    <div className="space-y-6">
      <PipelineTimeline job={job} />
      {job?.cancel_requested && (
        <div className="rounded-2xl border border-gold-400/35 bg-gold-400/10 p-4 text-center text-sm">
          Cancellation requested. Processing will stop at the next safe checkpoint.
        </div>
      )}
      {job?.can_cancel && !job?.cancel_requested && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={onCancel}>
            <Ban size={15} aria-hidden="true" /> Cancel upload
          </Button>
        </div>
      )}
      {pollError && (
        <div role="alert" className="rounded-2xl border border-gold-400/35 bg-gold-400/10 p-4 text-center">
          <p className="text-sm text-ink-muted">{pollError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={onResume}>
            Resume status check
          </Button>
        </div>
      )}
    </div>
  )
}

/** The wizard's own action bar. Sits at the foot of whichever step is showing. */
function StepActions({ children }) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
      {children}
    </div>
  )
}

export default function Upload() {
  const { isSuperadmin, department: userDepartment } = useAuth()
  const enforcedDepartment = userDepartment || 'CCSICT'
  const [state, dispatch] = useReducer(uploadReducer, enforcedDepartment, createUploadState)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { step, direction, file, form, errors, autofilled, job, submitting, parsing, pendingFile, pollError } = state
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
  const currentPrograms = currentDept?.programs || []
  const currentProgram = currentPrograms.find((item) => item.id === form.program_id)
  const currentSpecializations = currentProgram?.specializations || []
  const currentSpecialization = currentSpecializations.find((item) => item.id === form.specialization_id)

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

  const setField = (key, value) => dispatch({ type: 'set-field', key, value })

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
      // Which fields the extractor actually filled, so the form can mark them.
      dispatch({ type: 'set-autofilled', keys: autofilledKeys(metadata) })
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

  // On blur, correct what is already wrong but never introduce a new complaint:
  // tabbing out of an empty title should not scold you for not having typed in
  // it yet. Continue still runs the full check.
  const revalidateTouched = () => {
    if (Object.keys(errors).length === 0) return
    setErrors(uploadMetadataErrors(form))
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
        if (active.title) setForm((current) => ({ ...current, title: active.title }))
        setJob({ status: 'queued', stage: 'download', progress: 8, message: 'Restoring durable upload status…' })
        setStep(UPLOAD_STEPS.ingesting)
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
        // The completion screen names the thesis. Only the job was restored on
        // a refresh, so a reader who reloaded while indexing was told that ""
        // had joined the archive.
        title: form.title,
      }))
      setJob({ status: res.status, stage: 'download', progress: 8, message: res.message })
      setStep(UPLOAD_STEPS.ingesting)
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

  const terminal = isTerminalJob(job)
  // The rail steps aside once the job is over, so the outcome gets the full card.
  const mode = railMode(step, job)

  return (
    <PageTransition className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Upload <span className="text-gradient-isu">Thesis</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Digitize a thesis manuscript into its department-scoped semantic archive.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/upload/batch')} title="Ingest several manuscripts in one go">
          <Layers size={14} aria-hidden="true" /> Batch upload
        </Button>
      </div>

      <GlassCard className="overflow-hidden p-0">
        <div className={cn('grid', mode !== 'hidden' && 'lg:grid-cols-[17rem_minmax(0,1fr)]')}>
          {mode !== 'hidden' && (
            <WizardRail
              steps={WIZARD_STEPS}
              step={step}
              mode={mode}
              caption={form.title}
              progress={stageView(job).progress}
              statusLabel={STATUS_LABELS[job?.status] ?? 'Working'}
              onSelectStep={step < UPLOAD_STEPS.ingesting ? setStep : undefined}
            >
              {mode === 'summary' && (
                <>
                  <RailFileChip file={file} />
                  {/* Desktop only. Beside the form it earns its place by showing
                      the full title and author list that the inputs truncate;
                      stacked above the same fields on a phone it is just an echo. */}
                  <div className="hidden lg:block">
                    <RailHeading>Archive record</RailHeading>
                    <RailSummaryList
                      rows={summaryRows(form, {
                        program: currentProgram,
                        specialization: currentSpecialization,
                        categoryLabel: thesisCategoryLabel(form.thesis_category),
                      })}
                    />
                  </div>
                </>
              )}
            </WizardRail>
          )}

          <div className="min-w-0 p-5 sm:p-7">
            <DepartmentLoadError show={departmentsError} onRetry={() => retryDepartments()} />

            <WizardStep stepKey={step} direction={direction}>
              {step === UPLOAD_STEPS.manuscript && (
                <>
                  <Dropzone file={file} onFile={handleFileSelect} />
                  <StepActions>
                    <p className="text-xs text-ink-faint">
                      {file ? 'Ready to describe the manuscript.' : 'Choose a PDF to continue.'}
                    </p>
                    <Button
                      disabled={!file || parsing}
                      loading={parsing}
                      onClick={() => setStep(UPLOAD_STEPS.metadata)}
                      className="group"
                    >
                      {parsing ? 'Extracting...' : 'Continue'}
                      <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Button>
                  </StepActions>
                </>
              )}

              {step === UPLOAD_STEPS.metadata && (
                <>
                  <MetadataForm
                    form={form}
                    errors={errors}
                    autofilled={autofilled}
                    departments={departments}
                    isSuperadmin={isSuperadmin}
                    enforcedDepartment={enforcedDepartment}
                    loadingDepts={loadingDepts}
                    programs={currentPrograms}
                    specializations={currentSpecializations}
                    onField={setField}
                    onForm={setForm}
                    onBlurValidate={revalidateTouched}
                  />
                  <StepActions>
                    <Button variant="ghost" onClick={() => setStep(UPLOAD_STEPS.manuscript)}>
                      <ArrowLeft size={15} aria-hidden="true" /> Back
                    </Button>
                    <Button
                      onClick={() => validateMetadata() && setStep(UPLOAD_STEPS.review)}
                      className="group"
                    >
                      Review
                      <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Button>
                  </StepActions>
                </>
              )}

              {step === UPLOAD_STEPS.review && (
                <>
                  <ReviewPanel
                    file={file}
                    form={form}
                    program={currentProgram}
                    specialization={currentSpecialization}
                  />
                  <StepActions>
                    <Button variant="ghost" onClick={() => setStep(UPLOAD_STEPS.metadata)}>
                      <ArrowLeft size={15} aria-hidden="true" /> Back
                    </Button>
                    {/* Primary, not the gold container variant. Gold resolves to
                        --secondary-container, which reads quieter than a primary
                        button — the wrong signal for the page's decisive act. */}
                    <Button loading={submitting} onClick={submit}>
                      <UploadCloud size={16} aria-hidden="true" /> Ingest into archive
                    </Button>
                  </StepActions>
                </>
              )}

              {step === UPLOAD_STEPS.ingesting && (
                <div className="py-2">
                  {terminal ? (
                    <IngestOutcome
                      job={job}
                      title={form.title}
                      onReset={reset}
                      onViewArchive={() => navigate('/archive')}
                    />
                  ) : (
                    <IngestingPanel
                      job={job}
                      pollError={pollError}
                      onCancel={() => setCancelOpen(true)}
                      onResume={() => jobIdRef.current && startPolling(jobIdRef.current)}
                    />
                  )}
                </div>
              )}
            </WizardStep>
          </div>
        </div>
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
        // Both buttons keep the file; only Confirm runs the extractor. The old
        // copy ("Autofilling the field" / "Confirm the file and move on the next
        // step") described neither, so Cancel looked like it discarded the PDF.
        title="Read metadata from this manuscript?"
        message="The title page is analysed to fill in the title, authors and year — you can edit anything it gets wrong. Cancel keeps the file and leaves the form blank for you to complete."
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
