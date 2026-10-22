import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { FileSearch, ScanSearch, Upload } from 'lucide-react'
import { cn } from '../../lib/utils'
import { MAX_BATCH_SCAN_FILES, scanFileError } from './batchScan'

/**
 * The drop target for novelty scans, in either mode.
 *
 * Single mode validates the one file here and hands it to `onScan`. Batch mode
 * hands every dropped file to `onFiles` and lets the queue decide, because it
 * has to report duplicates and the batch cap as well as bad files. `compact`
 * shrinks it to a strip once a batch has files in it, so the queue below
 * stays in view.
 */
export function ScanDropzone({ onScan, onFiles, scanning = false, multiple = false, compact = false }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handle = (files) => {
    if (!files?.length) return
    if (multiple) {
      onFiles(files)
      return
    }
    const file = files[0]
    const error = scanFileError(file)
    if (error) {
      toast.error('Unsupported file', { description: error })
      return
    }
    onScan(file)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt"
        multiple={multiple}
        aria-label={multiple ? 'Choose manuscripts to scan' : 'Choose a manuscript to scan'}
        className="hidden"
        onChange={(e) => { handle(e.target.files); e.target.value = '' }}
      />
      <button
        type="button"
        disabled={scanning}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files) }}
        onClick={() => !scanning && inputRef.current?.click()}
        className={cn(
          'flex w-full cursor-pointer items-center justify-center rounded-[1.5rem] border-2 border-dashed text-center transition-all duration-300',
          compact ? 'gap-3 px-5 py-3.5' : 'flex-col px-6 py-10',
          dragging
            ? 'border-gold-400 bg-gold-400/10 scale-[1.01]'
            : 'border-forest-700/25 hover:border-forest-600/50 dark:border-white/15 dark:hover:border-gold-400/40',
          scanning && 'pointer-events-none opacity-60',
        )}
      >
        {compact ? (
          <>
            <Upload size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="text-sm font-semibold">Add more manuscripts</span>
            <span className="hidden text-xs text-ink-muted sm:inline">PDF or TXT · up to {MAX_BATCH_SCAN_FILES}</span>
          </>
        ) : scanning ? (
          <>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl"
            >
              <ScanSearch size={26} className="text-gold-300" />
            </motion.div>
            <div className="font-display text-base font-bold">Scanning against the archive…</div>
            <p className="mt-1 max-w-xs text-xs text-ink-muted">
              Every chunk is embedded and compared at the 85% cosine-similarity threshold. This can take a minute for long drafts.
            </p>
          </>
        ) : (
          <>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl shadow-forest-900/25">
              <FileSearch size={26} className="text-gold-300" />
            </div>
            <div className="font-display text-base font-bold">
              {multiple ? 'Drop several proposals or drafts' : 'Drop a proposal or draft to scan'}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {multiple
                ? `PDF or TXT · up to ${MAX_BATCH_SCAN_FILES} manuscripts, scanned one after another`
                : 'PDF or TXT · compared chunk-by-chunk against every archived thesis'}
            </p>
          </>
        )}
      </button>
    </>
  )
}
