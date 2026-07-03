import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  UploadCloud, FileText, X, ArrowRight, ArrowLeft, CheckCircle2,
  ScanText, Archive, Scissors, BrainCircuit, Database, PartyPopper, AlertTriangle,
  ShieldAlert,
} from 'lucide-react'
import { uploadPaper, getUploadStatus, getTracks, apiErrorMessage } from '../api'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { Input, Textarea, Select, Field } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { PageTransition } from '../components/ui/Motion'
import { cn } from '../lib/utils'

const STEPS = ['Manuscript', 'Metadata', 'Review']

const PIPELINE_STAGES = [
  { key: 'extract', label: 'Extract & clean', icon: ScanText },
  { key: 'store', label: 'Archive original', icon: Archive },
  { key: 'chunk', label: 'Chunk (800 tokens)', icon: Scissors },
  { key: 'embed', label: 'Embed (768d)', icon: BrainCircuit },
  { key: 'screen', label: 'Screen novelty (85%)', icon: ShieldAlert },
  { key: 'index', label: 'Index vectors', icon: Database },
]

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
    if (!f.name.toLowerCase().endsWith('.pdf') && !f.name.toLowerCase().endsWith('.txt')) {
      toast.error('Unsupported file', { description: 'Please upload a PDF or plain-text manuscript.' })
      return
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.error('File too large', { description: 'Maximum size is 25 MB.' })
      return
    }
    onFile(f)
  }, [onFile])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'group flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-6 py-14 text-center transition-all duration-300',
        dragging
          ? 'border-gold-400 bg-gold-400/10 scale-[1.01]'
          : 'border-forest-700/25 hover:border-forest-600/50 dark:border-white/15 dark:hover:border-gold-400/40',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {file ? (
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center">
          <div className="glass mb-4 flex h-16 w-16 items-center justify-center rounded-3xl">
            <FileText size={26} className="text-forest-600 dark:text-gold-300" />
          </div>
          <div className="max-w-xs truncate text-sm font-semibold">{file.name}</div>
          <div className="mt-1 text-xs opacity-50">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={(e) => { e.stopPropagation(); onFile(null) }}
          >
            <X size={14} /> Remove
          </Button>
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
            or click to browse · PDF or TXT · up to 25 MB · scanned copies are OCR-processed
          </p>
        </>
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
      <div className="grid grid-cols-6 gap-2">
        {PIPELINE_STAGES.map((stage, i) => {
          const done = job?.status === 'completed' || i < currentIdx
          const active = i === currentIdx && job?.status === 'processing'
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
    </div>
  )
}

export default function Upload() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState(null)
  const [form, setForm] = useState({ title: '', authors: '', year: '', abstract: '', track: '' })
  const [errors, setErrors] = useState({})
  const [job, setJob] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: tracks = [] } = useQuery({ queryKey: ['tracks'], queryFn: getTracks })

  useEffect(() => () => clearInterval(pollRef.current), [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const validateMetadata = () => {
    const next = {}
    if (form.title.trim().length < 5) next.title = 'Enter the full thesis title'
    if (!form.track) next.track = 'Select the academic track'
    if (form.year && (!/^\d{4}$/.test(form.year) || +form.year < 1978 || +form.year > new Date().getFullYear() + 1)) {
      next.year = 'Enter a valid year'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const startPolling = (jobId) => {
    pollRef.current = setInterval(async () => {
      try {
        const status = await getUploadStatus(jobId)
        setJob(status)
        if (status.status === 'completed') {
          clearInterval(pollRef.current)
          queryClient.invalidateQueries({ queryKey: ['papers'] })
          toast.success('Thesis indexed!', {
            description: `${status.chunks} semantic chunks embedded into the archive.`,
          })
          if (status.duplication?.flagged) {
            toast.warning('Potential duplication detected', {
              description: `${status.duplication.duplication_percentage}% of the manuscript matched the archive at the ${status.duplication.threshold}% similarity threshold.`,
            })
          }
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current)
          toast.error('Ingestion failed', { description: status.error })
        }
      } catch {
        // transient poll failure — keep trying
      }
    }, 1500)
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await uploadPaper({ file, ...form })
      setJob({ status: 'queued', stage: 'extract', progress: 0, message: 'Queued for processing…' })
      setStep(3)
      startPolling(res.job_id)
    } catch (err) {
      toast.error('Upload failed', { description: apiErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    clearInterval(pollRef.current)
    setStep(0)
    setFile(null)
    setForm({ title: '', authors: '', year: '', abstract: '', track: '' })
    setJob(null)
    setErrors({})
  }

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Upload <span className="text-gradient-isu">Thesis</span>
        </h1>
        <p className="mt-1 text-sm opacity-55">
          Digitize a CCSICT manuscript into the semantic vector archive.
        </p>
      </div>

      <GlassCard className="p-6 sm:p-10">
        {step < 3 && <StepIndicator current={step} />}

        <AnimatePresence mode="wait">
          {/* Step 1: file */}
          {step === 0 && (
            <motion.div
              key="file"
              initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3 }}
            >
              <Dropzone file={file} onFile={setFile} />
              <div className="mt-6 flex justify-end">
                <Button disabled={!file} onClick={() => setStep(1)} className="group">
                  Continue <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
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
              <Field label="Academic track" error={errors.track} required hint="Metadata tag attached to every semantic chunk">
                <Select value={form.track} onChange={set('track')} error={errors.track}>
                  <option value="">Select a CCSICT track…</option>
                  {tracks.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
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
                  {job.duplication?.flagged && (
                    <div className="mt-6 w-full max-w-md rounded-2xl border border-gold-400/40 bg-gold-400/10 p-4 text-left">
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <ShieldAlert size={15} className="shrink-0 text-gold-500" />
                        Potential duplication — {job.duplication.duplication_percentage}% of the manuscript
                        matched the archive at the {job.duplication.threshold}% similarity threshold
                      </div>
                      <ul className="mt-2 space-y-1 text-xs opacity-75">
                        {(job.duplication.matched_papers || []).map((p) => (
                          <li key={p.id}>
                            "{p.title || 'Untitled thesis'}"{p.year ? ` (${p.year})` : ''} — top match {p.similarity}%
                            · {p.match_count} chunk{p.match_count === 1 ? '' : 's'}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[0.7rem] opacity-55">
                        The manuscript was still indexed. Review it against the matched studies per the 85%
                        duplication delimitation before accepting the topic.
                      </p>
                    </div>
                  )}
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
              ) : (
                <PipelineProgress job={job} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </PageTransition>
  )
}
