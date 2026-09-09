import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { UploadCloud, FileText, X, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { formatFileSize } from '../../pages/upload/wizardSteps'
import { fileValidationError, MAX_BATCH_FILES } from '../../pages/upload/batchState'

/**
 * The dashed outline is an SVG rect with smooth animated stroke offset.
 */
function DashedOutline({ dragging }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible"
    >
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx="23"
        ry="23"
        fill="none"
        strokeWidth="2"
        strokeDasharray="11 9"
        strokeLinecap="round"
        className={cn(
          'transition-[stroke,stroke-width] duration-300',
          dragging
            ? 'animate-dash-march stroke-gold-400 stroke-[2.5px]'
            : 'stroke-forest-700/30 group-hover:stroke-forest-600/70 dark:stroke-white/20 dark:group-hover:stroke-gold-400/60',
        )}
      />
    </svg>
  )
}

const iconMotion = {
  initial: { opacity: 0, scale: 0.9, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9, y: -6 },
  transition: motionTokens.spring,
}

/**
 * PDF drop target shared by the single-file wizard and the batch page.
 */
export function Dropzone({ file, onFile, onFiles, multiple = false, disabled = false }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFiles = useCallback((fileList) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    const valid = []
    const problems = []
    for (const candidate of files) {
      const problem = fileValidationError(candidate)
      if (problem) problems.push(`${candidate.name}: ${problem}`)
      else valid.push(candidate)
    }
    if (problems.length) {
      toast.error(problems.length === 1 ? 'Unsupported file' : `${problems.length} files skipped`, {
        description: problems.slice(0, 3).join(' · '),
      })
    }
    if (valid.length === 0) return
    if (multiple) onFiles?.(valid)
    else onFile?.(valid[0])
  }, [multiple, onFile, onFiles])

  const selected = !multiple && file

  return (
    <div className="relative max-w-xl mx-auto w-full">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />
      <motion.button
        type="button"
        disabled={disabled}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        animate={{ scale: dragging ? 1.012 : 1 }}
        transition={motionTokens.spring}
        className={cn(
          'group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-3xl',
          'text-center outline-none transition-all duration-300',
          selected
            ? 'px-6 py-8 pb-16 border border-[var(--border)] bg-[var(--surface-2)]/70 shadow-md backdrop-blur-xs hover:bg-[var(--surface-2)]/90'
            : dragging
              ? 'px-6 py-10 sm:py-12 bg-gold-400/15 shadow-xl shadow-gold-400/10 ring-2 ring-gold-400/50'
              : 'px-6 py-10 sm:py-12 bg-[var(--surface-1)] hover:bg-[var(--surface-2)]/90 hover:shadow-lg hover:shadow-forest-950/5',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {!selected && <DashedOutline dragging={dragging} />}

        {/* Dynamic ambient radial glow */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 rounded-3xl transition-opacity duration-500',
            dragging
              ? 'opacity-100 bg-radial-[circle_at_center,rgba(242,169,0,0.18)_0%,transparent_70%]'
              : 'opacity-0 group-hover:opacity-100 bg-radial-[circle_at_center,rgba(16,185,108,0.12)_0%,transparent_70%]',
          )}
        />

        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div key="chosen" {...iconMotion} className="flex flex-col items-center max-w-md w-full">
              {/* Elevated 3D document card preview */}
              <div className="relative mb-3.5 flex items-center justify-center">
                <div className="absolute -inset-2 rounded-2xl bg-forest-500/20 blur-md dark:bg-forest-400/25" />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 text-gold-300 shadow-xl shadow-forest-900/25 ring-2 ring-white/20 dark:ring-white/10">
                  <FileText size={28} aria-hidden="true" />
                </span>
              </div>

              <div className="space-y-1 w-full px-4">
                <span className="block truncate text-base font-bold text-ink sm:text-lg" title={file.name}>
                  {file.name}
                </span>
                <span className="block text-xs font-semibold text-ink-muted">
                  PDF · {formatFileSize(file.size)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-500/12 px-3 py-1 text-[11px] font-semibold text-forest-700 dark:text-forest-300 border border-forest-500/25">
                  <CheckCircle2 size={13} aria-hidden="true" /> Valid Manuscript
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-400/15 px-3 py-1 text-[11px] font-semibold text-gold-700 dark:text-gold-300 border border-gold-400/25">
                  <Sparkles size={12} aria-hidden="true" /> AI Extraction Ready
                </span>
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" {...iconMotion} className="flex flex-col items-center">
              {/* 3D Floating Upload Icon */}
              <div className="relative mb-4">
                <motion.div
                  animate={{ y: dragging ? -8 : 0 }}
                  transition={motionTokens.spring}
                  className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 via-forest-700 to-forest-900 shadow-xl shadow-forest-900/30 ring-4 ring-forest-500/10 transition-transform duration-300 group-hover:scale-105 group-hover:shadow-2xl"
                >
                  <UploadCloud size={28} className="text-gold-300" aria-hidden="true" />
                </motion.div>
              </div>

              <span className="font-display block text-base font-bold text-ink sm:text-lg">
                {multiple ? 'Drop the manuscripts here' : 'Drop the manuscript here'}
              </span>

              <span className="mt-1 block max-w-sm text-xs text-ink-muted leading-relaxed">
                {multiple
                  ? `or click to browse · PDF only · up to 25 MB each · up to ${MAX_BATCH_FILES} files per batch`
                  : 'or click to browse · PDF only · up to 25 MB · scanned copies are OCR-processed'}
              </span>

              {/* Enterprise specs pill strip */}
              <div className="mt-4 hidden sm:flex items-center gap-2 text-[11px] font-medium text-ink-faint">
                <span className="flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5">
                  <ShieldCheck size={12} className="text-forest-600 dark:text-forest-400" /> ClamAV Scanned
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5">
                  PyMuPDF + OCR
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5">
                  PII Protected
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {selected && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-3.5 left-1/2 -translate-x-1/2 text-xs font-semibold text-flame-600 hover:text-flame-700 hover:bg-flame-500/10 dark:text-flame-400"
          onClick={() => onFile?.(null)}
        >
          <X size={14} /> Remove
        </Button>
      )}
    </div>
  )
}
