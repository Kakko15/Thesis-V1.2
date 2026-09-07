import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { UploadCloud, FileText, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { formatFileSize } from '../../pages/upload/wizardSteps'
import { fileValidationError, MAX_BATCH_FILES } from '../../pages/upload/batchState'

/**
 * The dashed outline is an SVG rect rather than `border-2 border-dashed`.
 * A CSS dashed border cannot animate its dash phase, so the drag state had
 * nothing to say beyond a colour swap; this one marches while a file is over
 * it. The keyframe lives in index.css and is disabled by data-effects="low".
 */
function DashedOutline({ dragging }) {
  return (
    // Inset by the stroke's half-width and left overflow-visible, so the 2px
    // outline lands exactly on the container edge without needing calc() in an
    // SVG geometry attribute, which is not reliably supported.
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
          'transition-[stroke] duration-300',
          dragging
            ? 'animate-dash-march stroke-gold-400'
            : 'stroke-forest-700/30 group-hover:stroke-forest-600/60 dark:stroke-white/20 dark:group-hover:stroke-gold-400/50',
        )}
      />
    </svg>
  )
}

const iconMotion = {
  initial: { opacity: 0, scale: 0.86, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.86, y: -4 },
  transition: motionTokens.spring,
}

/**
 * PDF drop target shared by the single-file wizard and the batch page.
 *
 * Single mode (`file` / `onFile`) is the original Upload.jsx behaviour: the
 * first file wins and is shown in place. Multiple mode (`multiple`,
 * `onFiles`) hands every valid file back and leaves the listing to the caller.
 * Either way the page holds exactly one `input[type="file"]`, which the E2E
 * suite selects in strict mode.
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
    <div className="relative">
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
          'group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-[1.5rem]',
          'px-6 py-14 text-center outline-none transition-colors duration-300',
          dragging ? 'bg-gold-400/10' : 'bg-[var(--surface-1)] hover:bg-[var(--surface-2)]',
          disabled && 'cursor-not-allowed opacity-60',
          selected && 'pb-20',
        )}
      >
        <DashedOutline dragging={dragging} />

        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.span key="chosen" {...iconMotion} className="flex flex-col items-center">
              <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--primary-container)] text-[var(--primary-container-foreground)] shadow-lg">
                <FileText size={26} aria-hidden="true" />
              </span>
              <span className="block max-w-xs truncate text-sm font-semibold">{file.name}</span>
              <span className="mt-1 block text-xs text-ink-faint">PDF · {formatFileSize(file.size)}</span>
            </motion.span>
          ) : (
            <motion.span key="empty" {...iconMotion} className="flex flex-col items-center">
              <motion.span
                animate={{ y: dragging ? -8 : 0 }}
                transition={motionTokens.spring}
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl shadow-forest-900/25 transition-transform duration-300 group-hover:scale-105"
              >
                <UploadCloud size={26} className="text-gold-300" aria-hidden="true" />
              </motion.span>
              <span className="font-display block text-base font-bold">
                {multiple ? 'Drop the manuscripts here' : 'Drop the manuscript here'}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">
                {multiple
                  ? `or click to browse · PDF only · up to 25 MB each · up to ${MAX_BATCH_FILES} files per batch`
                  : 'or click to browse · PDF only · up to 25 MB · scanned copies are OCR-processed'}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {selected && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-6 left-1/2 -translate-x-1/2"
          onClick={() => onFile?.(null)}
        >
          <X size={14} /> Remove
        </Button>
      )}
    </div>
  )
}
