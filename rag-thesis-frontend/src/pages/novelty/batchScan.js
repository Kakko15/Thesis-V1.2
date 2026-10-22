// Batch novelty scanning: the queue of manuscripts, and the rules for moving
// each one through /duplication/scan.
//
// There is no batch endpoint on purpose. A scan embeds every chunk and runs a
// verdict call, so one request carrying ten manuscripts would hold a
// connection open for many minutes and report nothing until the last one
// finished. The client sends the files one at a time through the same endpoint
// the single scan uses, so every file lands in scan history exactly as a
// single scan does and a failure costs that file alone.

export const MAX_BATCH_SCAN_FILES = 10
export const MAX_SCAN_BYTES = 25 * 1024 * 1024
// The server's /duplication/scan contract: a PDF or a plain-text manuscript.
export const SCAN_MIME_TYPES = Object.freeze([
  'application/pdf', 'application/x-pdf', 'text/plain', 'application/octet-stream',
])

// /duplication/scan is rate-limited (settings.rate_limit_scan, 5/minute), and a
// batch of short drafts can outrun it. Back-to-back large manuscripts can also
// exhaust the embedding provider's quota or time out the archive search, which
// the endpoint reports as 503 with a Retry-After. Either way the wait-and-retry
// is about pacing, not about the file, so the same file is tried again rather
// than failed.
export const RATE_LIMIT_RETRIES = 3
export const RATE_LIMIT_FALLBACK_MS = 15_000
// The rate limiter sends no Retry-After (services/rate_limiting.py builds the
// slowapi Limiter without headers), and its window is a minute. Retrying a 429
// every 15 s spent all three retries inside that same window, so a sixth file
// in a fast batch always failed; waiting out the window lets it through.
export const RATE_LIMIT_WINDOW_MS = 60_000

/** Why a file cannot be scanned, or '' when it can. */
export function scanFileError(file) {
  if (!file) return 'No file.'
  const name = String(file.name || '').toLowerCase()
  const validName = name.endsWith('.pdf') || name.endsWith('.txt')
  const validMime = !file.type || SCAN_MIME_TYPES.includes(file.type)
  if (!validName || !validMime) return 'Only PDF or plain-text manuscripts can be scanned.'
  if (file.size > MAX_SCAN_BYTES) return 'Larger than the 25 MB limit.'
  return ''
}

let nextId = 0
function entryId() {
  nextId += 1
  return `scan-${Date.now().toString(36)}-${nextId}`
}

function sameFile(left, right) {
  return left.name === right.name && left.size === right.size && left.lastModified === right.lastModified
}

/**
 * Add files to the queue, skipping ones already queued and anything past the
 * cap. Returns the new entries alongside what was turned away and why, so the
 * caller can say so instead of silently dropping a file.
 */
export function addScanFiles(entries, files) {
  const next = [...entries]
  const rejected = []
  for (const file of Array.from(files || [])) {
    const error = scanFileError(file)
    if (error) {
      rejected.push({ name: file?.name || 'file', reason: error })
      continue
    }
    if (next.some((entry) => sameFile(entry.file, file))) continue
    if (next.length >= MAX_BATCH_SCAN_FILES) {
      rejected.push({ name: file.name, reason: `A batch holds at most ${MAX_BATCH_SCAN_FILES} manuscripts.` })
      continue
    }
    next.push({ id: entryId(), file, status: 'queued', scan: null, error: '' })
  }
  return { entries: next, rejected }
}

export function updateScanEntry(entries, id, patch) {
  return entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
}

export function removeScanEntry(entries, id) {
  return entries.filter((entry) => entry.id !== id || entry.status === 'scanning')
}

/** The next file still waiting, or null. */
export function nextQueued(entries) {
  return entries.find((entry) => entry.status === 'queued') || null
}

/** Counts for the progress line: how many are finished out of how many. */
export function batchScanProgress(entries) {
  const done = entries.filter((entry) => entry.status === 'done').length
  const failed = entries.filter((entry) => entry.status === 'failed').length
  return {
    total: entries.length,
    done,
    failed,
    finished: done + failed,
    queued: entries.filter((entry) => entry.status === 'queued').length,
  }
}

/** How long to wait before retrying a rate-limited or busy scan, in milliseconds. */
export function retryDelayMs(error) {
  const header = error?.response?.headers?.['retry-after']
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 120) * 1000
  return error?.response?.status === 429 ? RATE_LIMIT_WINDOW_MS : RATE_LIMIT_FALLBACK_MS
}

export function isRetryableScanFailure(error) {
  const status = error?.response?.status
  return status === 429 || status === 503
}
