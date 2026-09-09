import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Layers, Sparkles, UploadCloud } from 'lucide-react'
import {
  uploadPaper, getUploadStatus, getDepartments, apiErrorMessage, extractMetadata,
  cancelUploadJob,
} from '../api'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { PageTransition } from '../components/ui/Motion'
import { ConfirmDialog } from '../components/ui/Modal'
import { useAuth } from '../context/AuthContext'
import { mostSimilarPaper, scanMetrics, verdictLabel } from '../lib/utils'
import { departmentPrograms, programSelection } from '../lib/catalog'
import {
  createUploadState, emptyUploadForm, isCurrentPoll, uploadMetadataErrors, uploadReducer, UPLOAD_STEPS,
} from './upload/uploadState'
import {
  WIZARD_STEPS, autofilledKeys, extractionDepartment, isTerminalJob, stageView,
} from './upload/wizardSteps'
import { Dropzone } from '../components/upload/Dropzone'
import { WizardStepper } from '../components/upload/WizardStepper'
import { WizardStep } from '../components/upload/WizardStep'
import { MetadataForm } from '../components/upload/MetadataForm'
import { ReviewPanel } from '../components/upload/ReviewPanel'
import { PipelineTimeline } from '../components/upload/PipelineTimeline'
import { IngestOutcome } from '../components/upload/IngestOutcome'

const IngestScene3D = lazy(() => import('../components/three/IngestScene3D'))

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

/** Ingestion in flight: 3D neural hologram + telemetry + pipeline timeline. */
function IngestingPanel({ job, pollError, onCancel, onResume }) {
  const { stages, progress } = stageView(job)
  const activeStage = stages.find((stage) => stage.active)

  return (
    <div className="space-y-6">
      {/* 2-Column Mission Control for Ingestion on desktop */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: 3D Holographic Visualizer */}
        <div className="lg:col-span-7 space-y-3.5">
          <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-b from-[var(--surface-1)] to-[var(--surface-2)]/60 shadow-xl shadow-forest-950/5">
            <Suspense
              fallback={
                <div className="flex h-72 w-full items-center justify-center rounded-3xl bg-[var(--surface-2)]/40 animate-pulse">
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

          {/* Live Telemetry Chips */}
          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-3 shadow-xs">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Progress</span>
              <span className="font-display text-base sm:text-lg font-extrabold text-forest-700 dark:text-gold-300 tabular-nums">
                {progress}%
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-3 shadow-xs">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Vector Space</span>
              <span className="font-display text-base sm:text-lg font-extrabold text-ink">
                768d
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/80 p-3 shadow-xs">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">Chunk Size</span>
              <span className="font-display text-base sm:text-lg font-extrabold text-ink">
                800 tok
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Pipeline Timeline */}
        <div className="lg:col-span-5">
          <PipelineTimeline job={job} hide3D />
        </div>
      </div>

      {job?.cancel_requested && (
        <div className="rounded-2xl border border-gold-400/35 bg-gold-400/10 p-4 text-center text-sm font-medium text-ink shadow-xs">
          Cancellation requested. Processing will stop at the next safe checkpoint.
        </div>
      )}
      {job?.can_cancel && !job?.cancel_requested && (
        <div className="flex justify-center pt-1">
          <Button variant="ghost" onClick={onCancel} className="text-flame-600 hover:text-flame-700 hover:bg-flame-500/10">
            <Ban size={15} aria-hidden="true" /> Cancel upload
          </Button>
        </div>
      )}
      {pollError && (
        <div role="alert" className="rounded-2xl border border-gold-400/35 bg-gold-400/10 p-5 text-center shadow-xs">
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
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
      {children}
    </div>
  )
}

export default function Upload() {
  const { isSuperadmin, canScan, department: userDepartment } = useAuth()
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

  // The department decides which programs exist, so every classification below
  // is read from the one currently selected.
  const currentPrograms = departmentPrograms(departments, form.department)
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
      // The department decides which programs exist, so it is settled first and
      // the program is then resolved inside it. The extractor answers with a
      // program *code*: one belonging to another college resolves to nothing
      // here rather than filling a value the upload would be rejected for.
      //
      // Two departments, deliberately -- see `extractionDepartment`, which owns
      // the rule so it is testable without JSX.
      const { extractedDepartment, department } = extractionDepartment({
        isSuperadmin,
        extracted: metadata.department,
        current: form.department,
        enforced: enforcedDepartment,
      })
      const selection = programSelection(
        departments, department, metadata.program_code, metadata.specialization_code,
      )
      // Only what the extractor produced, so `autofilledKeys` below credits it
      // with nothing it left blank. The form keeps whatever is already typed in
      // a field the extractor could not read.
      const patch = {
        title: metadata.title || '',
        authors: metadata.authors || '',
        year: metadata.year || '',
        department: extractedDepartment,
        ...(selection || {}),
      }
      setForm((prev) => ({
        ...prev,
        title: patch.title || prev.title,
        authors: patch.authors || prev.authors,
        year: patch.year || prev.year,
        department: department || prev.department,
        // The classification is applied whole or not at all. Merging it field
        // by field would leave the specialization of a previously chosen file
        // sitting under a program that does not offer it, which the upload is
        // then rejected for.
        ...(selection || {}),
      }))
      // Which fields the extractor actually filled, so the form can mark them.
      // The resolved patch, not the raw reply: a program code that matched no
      // program in this department filled nothing and is claimed by nothing.
      dispatch({ type: 'set-autofilled', keys: autofilledKeys(patch) })
      if (patch.title || patch.authors || patch.year || patch.department || selection) {
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
            const similar = mostSimilarPaper(status.duplication)
            const similarTo = similar?.title ? ` Most similar to "${similar.title}".` : ''
            toast.warning('Potential duplication detected', {
              description: `${metrics.highest.toFixed(2)}% highest passage similarity; ${metrics.coverage.toFixed(2)}% matched chunk coverage. ${verdictLabel(metrics.verdict)}.${similarTo}`,
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

  return (
    <PageTransition className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
            Upload <span className="text-gradient-isu">Thesis</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Digitize a thesis manuscript into its department-scoped semantic archive.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate('/upload/batch')}
          title="Ingest several manuscripts in one go"
          className="shadow-xs hover:shadow-md transition-all"
        >
          <Layers size={14} aria-hidden="true" /> Batch upload
        </Button>
      </div>

      <GlassCard className="overflow-hidden p-0 border border-[var(--border)] shadow-xl backdrop-blur-md rounded-3xl">
        {/* Top Stepper Navigation Bar */}
        {step < UPLOAD_STEPS.ingesting && (
          <div className="border-b border-[var(--border)]/70 bg-[var(--surface-1)]/80 px-3.5 py-4 sm:px-8 backdrop-blur-xs">
            <WizardStepper
              steps={WIZARD_STEPS}
              current={step}
              orientation="horizontal"
              onSelect={setStep}
            />
          </div>
        )}

        <div className="min-w-0 p-3.5 sm:p-7 md:p-8">
          <DepartmentLoadError show={departmentsError} onRetry={() => retryDepartments()} />

          <WizardStep stepKey={step} direction={direction}>
            {step === UPLOAD_STEPS.manuscript && (
              <div className="max-w-2xl mx-auto">
                <Dropzone file={file} onFile={handleFileSelect} />

                {/* Compact extracted details banner if autofilled on this manuscript */}
                {file && form.title && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-2xl border border-gold-400/30 bg-gold-400/8 p-4 shadow-xs text-left backdrop-blur-xs"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={14} className="text-gold-500 animate-pulse shrink-0" />
                      <span className="text-xs font-bold uppercase tracking-wider text-ink">
                        Extracted Manuscript Details
                      </span>
                      <span className="ml-auto text-[11px] font-medium text-ink-muted">
                        Autofilled by AI
                      </span>
                    </div>
                    <div className="text-sm font-bold text-ink line-clamp-2">
                      {form.title}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      {form.authors && <span><strong>Authors:</strong> {form.authors}</span>}
                      {form.year && <span><strong>Year:</strong> {form.year}</span>}
                      {form.department && <span><strong>Department:</strong> {form.department}</span>}
                    </div>
                  </motion.div>
                )}

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
              </div>
            )}

            {step === UPLOAD_STEPS.metadata && (
              <div className="max-w-3xl mx-auto">
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
              </div>
            )}

            {step === UPLOAD_STEPS.review && (
              <div className="max-w-3xl mx-auto">
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
                  <Button loading={submitting} onClick={submit}>
                    <UploadCloud size={16} aria-hidden="true" /> Ingest into archive
                  </Button>
                </StepActions>
              </div>
            )}

              {step === UPLOAD_STEPS.ingesting && (
                <div className="py-2">
                  {terminal ? (
                    /* onReviewNovelty is offered only to accounts the server
                       would actually let scan: /novelty is gated by the same
                       role-feature matrix, so pointing every uploader at it
                       would send some of them to a page that refuses them. */
                    <IngestOutcome
                      job={job}
                      title={form.title}
                      onReset={reset}
                      onViewArchive={() => navigate('/archive')}
                      onReviewNovelty={canScan ? () => navigate('/novelty') : undefined}
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
