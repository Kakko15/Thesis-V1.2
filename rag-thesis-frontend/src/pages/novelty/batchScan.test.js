import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_BATCH_SCAN_FILES, RATE_LIMIT_FALLBACK_MS, RATE_LIMIT_WINDOW_MS, addScanFiles, batchScanProgress, isRetryableScanFailure,
  nextQueued, removeScanEntry, retryDelayMs, scanFileError, updateScanEntry,
} from './batchScan.js'

function file(name, { size = 1024, type = 'application/pdf', lastModified = 1 } = {}) {
  return { name, size, type, lastModified }
}

test('only PDF and plain-text manuscripts within 25 MB can be scanned', () => {
  assert.equal(scanFileError(file('draft.pdf')), '')
  assert.equal(scanFileError(file('draft.txt', { type: 'text/plain' })), '')
  assert.equal(scanFileError(file('draft.PDF', { type: '' })), '')
  assert.match(scanFileError(file('draft.docx', { type: 'application/msword' })), /PDF or plain-text/)
  assert.match(scanFileError(file('draft.pdf', { type: 'image/png' })), /PDF or plain-text/)
  assert.match(scanFileError(file('huge.pdf', { size: 26 * 1024 * 1024 })), /25 MB/)
  assert.equal(scanFileError(null), 'No file.')
})

test('adding files queues valid ones once and says why the rest were turned away', () => {
  const first = addScanFiles([], [file('a.pdf'), file('notes.docx', { type: 'application/msword' })])
  assert.deepEqual(first.entries.map((entry) => [entry.file.name, entry.status]), [['a.pdf', 'queued']])
  assert.equal(first.rejected.length, 1)
  assert.equal(first.rejected[0].name, 'notes.docx')

  // The same file dropped twice is queued once.
  const again = addScanFiles(first.entries, [file('a.pdf'), file('b.pdf')])
  assert.deepEqual(again.entries.map((entry) => entry.file.name), ['a.pdf', 'b.pdf'])
  assert.deepEqual(again.rejected, [])
  assert.notEqual(again.entries[0].id, again.entries[1].id)
})

test('the batch stops at its cap and reports the overflow', () => {
  const many = Array.from({ length: MAX_BATCH_SCAN_FILES + 2 }, (_, index) => file(`t${index}.pdf`))
  const { entries, rejected } = addScanFiles([], many)
  assert.equal(entries.length, MAX_BATCH_SCAN_FILES)
  assert.equal(rejected.length, 2)
  assert.match(rejected[0].reason, /at most 10/)
})

test('entries move through the queue in order and a scanning one cannot be removed', () => {
  let { entries } = addScanFiles([], [file('a.pdf'), file('b.pdf'), file('c.pdf')])
  const [a, b, c] = entries
  assert.equal(nextQueued(entries).id, a.id)
  entries = updateScanEntry(entries, a.id, { status: 'done', scan: { id: 'scan-a' } })
  entries = updateScanEntry(entries, b.id, { status: 'scanning' })
  assert.equal(nextQueued(entries).id, c.id)
  // Removing the file in flight would orphan its result; a waiting one goes.
  assert.equal(removeScanEntry(entries, b.id).length, 3)
  assert.deepEqual(removeScanEntry(entries, c.id).map((entry) => entry.id), [a.id, b.id])
  entries = updateScanEntry(entries, b.id, { status: 'failed', error: 'Scan failed' })
  entries = updateScanEntry(entries, c.id, { status: 'done' })
  assert.equal(nextQueued(entries), null)
  assert.deepEqual(batchScanProgress(entries), { total: 3, done: 2, failed: 1, finished: 3, queued: 0 })
})

test('a rate-limited or busy scan waits for Retry-After, capped, or the fallback', () => {
  const limited = (retryAfter) => ({ response: { status: 429, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter } } })
  assert.equal(isRetryableScanFailure(limited('10')), true)
  // The provider-capacity and archive-outage answers wait the same way.
  assert.equal(isRetryableScanFailure({ response: { status: 503, headers: { 'retry-after': '60' } } }), true)
  assert.equal(retryDelayMs({ response: { status: 503, headers: { 'retry-after': '60' } } }), 60_000)
  // A bad file is not retried: it fails the row and the batch moves on.
  for (const status of [400, 413, 415, 422, 500, 502]) {
    assert.equal(isRetryableScanFailure({ response: { status } }), false)
  }
  assert.equal(isRetryableScanFailure(new Error('network')), false)
  assert.equal(retryDelayMs(limited('10')), 10_000)
  assert.equal(retryDelayMs(limited('900')), 120_000)
  // The rate limiter sends no Retry-After, so a bare 429 waits out its window
  // rather than retrying inside it; a busy 503 with no header waits less.
  assert.equal(retryDelayMs(limited(undefined)), RATE_LIMIT_WINDOW_MS)
  assert.equal(retryDelayMs(limited('soon')), RATE_LIMIT_WINDOW_MS)
  assert.equal(retryDelayMs({ response: { status: 503, headers: {} } }), RATE_LIMIT_FALLBACK_MS)
})
