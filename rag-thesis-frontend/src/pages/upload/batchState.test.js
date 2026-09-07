import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVE_BATCH_STORAGE_KEY,
  BATCH_STEPS,
  BATCH_WIZARD_STEPS,
  MAX_BATCH_FILES,
  MISSING_POLLS_BEFORE_EXPIRED,
  activeJobIds,
  allTerminal,
  batchRailMode,
  batchReducer,
  batchProgress,
  batchSummary,
  createBatchRow,
  createBatchState,
  emptyBatchDefaults,
  fileValidationError,
  isTerminal,
  restoreActiveBatch,
  serializeActiveBatch,
  splitMetadataErrors,
  stageLabel,
  statusLabel,
  statusTone,
  validateBatch,
} from './batchState.js'

const pdf = (name, size = 1024) => ({ name, size, type: 'application/pdf' })

function stateWithFiles(...files) {
  return batchReducer(createBatchState('CCSICT'), { type: 'add-rows', files })
}

function readyDefaults() {
  return { ...emptyBatchDefaults('CCSICT'), program_id: 'p1', requires_specialization: false }
}

test('fileValidationError accepts PDFs under 25 MB and rejects everything else', () => {
  assert.equal(fileValidationError(pdf('thesis.pdf')), null)
  assert.equal(fileValidationError({ name: 'thesis.PDF', size: 10, type: '' }), null)
  assert.match(fileValidationError({ name: 'notes.txt', size: 10, type: 'text/plain' }), /PDF/)
  assert.match(fileValidationError({ name: 'thesis.pdf', size: 10, type: 'image/png' }), /PDF/)
  assert.match(fileValidationError({ name: 'thesis.pdf', size: 25 * 1024 * 1024 + 1, type: 'application/pdf' }), /25 MB/)
  assert.match(fileValidationError(null), /No file/)
})

test('createBatchRow mints a stable id and idempotency key per file', () => {
  const a = createBatchRow(pdf('a.pdf'))
  const b = createBatchRow(pdf('a.pdf'))
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.idempotencyKey, b.idempotencyKey)
  assert.equal(a.name, 'a.pdf')
  assert.equal(a.jobId, null)
  const fixed = createBatchRow(pdf('c.pdf'), { id: 'row-1', idempotencyKey: 'key-1' })
  assert.equal(fixed.id, 'row-1')
  assert.equal(fixed.idempotencyKey, 'key-1')
})

test('add-rows dedupes by name and size and never exceeds the batch cap', () => {
  const state = stateWithFiles(pdf('a.pdf'), pdf('a.pdf'), pdf('b.pdf'))
  assert.deepEqual(state.rows.map((row) => row.name), ['a.pdf', 'b.pdf'])
  const again = batchReducer(state, { type: 'add-rows', files: [pdf('a.pdf'), pdf('c.pdf')] })
  assert.deepEqual(again.rows.map((row) => row.name), ['a.pdf', 'b.pdf', 'c.pdf'])
  const many = Array.from({ length: MAX_BATCH_FILES + 5 }, (_, index) => pdf(`t-${index}.pdf`))
  assert.equal(batchReducer(createBatchState(), { type: 'add-rows', files: many }).rows.length, MAX_BATCH_FILES)
})

test('remove-row and set-row-field target rows by id, not position', () => {
  const state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  const [a, b] = state.rows
  const edited = batchReducer(state, { type: 'set-row-field', id: b.id, key: 'title', value: 'Second Manuscript' })
  assert.equal(edited.rows[1].title, 'Second Manuscript')
  assert.equal(edited.rows[0].title, '')
  const removed = batchReducer(edited, { type: 'remove-row', id: a.id })
  assert.deepEqual(removed.rows.map((row) => row.name), ['b.pdf'])
  assert.equal(removed.rows[0].title, 'Second Manuscript')
})

test('apply-extraction fills blank fields by index and records per-file rejections', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'))
  state = batchReducer(state, { type: 'set-row-field', id: state.rows[0].id, key: 'title', value: 'Kept By Hand' })
  state = batchReducer(state, {
    type: 'apply-extraction',
    files: [
      { index: 0, title: 'Extracted Title', authors: 'Ana Cruz', year: '2026' },
      { index: 1, title: 'Second Title', authors: '', year: 2025 },
      { index: 2, error: 'Encrypted or password-protected PDFs are not accepted', status_code: 422 },
    ],
  })
  assert.equal(state.rows[0].title, 'Kept By Hand')
  assert.equal(state.rows[0].authors, 'Ana Cruz')
  assert.equal(state.rows[0].year, '2026')
  assert.equal(state.rows[1].title, 'Second Title')
  assert.equal(state.rows[1].year, '2025')
  assert.equal(state.rows[2].extractError, 'Encrypted or password-protected PDFs are not accepted')
  assert.ok(state.rows.every((row) => row.extracted))
})

test('splitMetadataErrors sends title and year to the row and classification to the defaults', () => {
  const row = { title: 'abc', authors: '', year: '1900' }
  const { rowErrors, defaultErrors } = splitMetadataErrors(row, emptyBatchDefaults('CCSICT'))
  assert.deepEqual(Object.keys(rowErrors).sort(), ['title', 'year'])
  assert.deepEqual(Object.keys(defaultErrors), ['program_id'])
  const faculty = splitMetadataErrors(
    { title: 'A Long Enough Title', authors: '', year: '' },
    { ...emptyBatchDefaults('CCSICT'), thesis_category: 'faculty' },
  )
  assert.deepEqual(faculty.rowErrors, {})
  assert.deepEqual(faculty.defaultErrors, {})
  const specialization = splitMetadataErrors(
    { title: 'A Long Enough Title', authors: '', year: '' },
    { ...emptyBatchDefaults(''), program_id: 'p1', requires_specialization: true },
  )
  assert.deepEqual(Object.keys(specialization.defaultErrors).sort(), ['department', 'specialization_id'])
})

test('validateBatch reports per-row and shared errors and flags rejected files', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  const [a, b] = state.rows
  state = batchReducer(state, { type: 'set-row-field', id: a.id, key: 'title', value: 'A Complete Thesis Title' })
  state = batchReducer(state, { type: 'apply-extraction', files: [{ index: 1, error: 'Malformed or unreadable PDF' }] })
  const invalid = validateBatch(state.rows, emptyBatchDefaults('CCSICT'))
  assert.equal(invalid.valid, false)
  assert.equal(invalid.rowErrorsById[a.id], undefined)
  assert.match(invalid.rowErrorsById[b.id].title, /title/)
  assert.match(invalid.rowErrorsById[b.id].file, /Remove this file/)
  assert.deepEqual(Object.keys(invalid.defaultErrors), ['program_id'])

  const cleaned = batchReducer(state, { type: 'remove-row', id: b.id })
  const valid = validateBatch(cleaned.rows, readyDefaults())
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.rowErrorsById, {})
  assert.deepEqual(validateBatch([], readyDefaults()).defaultErrors, { rows: 'Add at least one manuscript' })
})

test('set-row-errors and set-default-errors store validation output', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const [a] = state.rows
  state = batchReducer(state, { type: 'set-row-errors', errorsById: { [a.id]: { title: 'Enter the full thesis title' } } })
  state = batchReducer(state, { type: 'set-default-errors', errors: { program_id: 'Select the academic program' } })
  assert.equal(state.rows[0].errors.title, 'Enter the full thesis title')
  assert.equal(state.defaultErrors.program_id, 'Select the academic program')
  state = batchReducer(state, { type: 'set-row-errors', errorsById: {} })
  assert.deepEqual(state.rows[0].errors, {})
})

test('defaults actions update the shared classification', () => {
  let state = createBatchState('CCSICT')
  state = batchReducer(state, { type: 'set-defaults-field', key: 'thesis_category', value: 'faculty' })
  assert.equal(state.defaults.thesis_category, 'faculty')
  state = batchReducer(state, { type: 'set-defaults', value: (current) => ({ ...current, program_id: 'p1', track: 'BSCS' }) })
  assert.equal(state.defaults.program_id, 'p1')
  assert.equal(state.defaults.track, 'BSCS')
  state = batchReducer(state, { type: 'set-defaults', value: emptyBatchDefaults('CAS') })
  assert.equal(state.defaults.department, 'CAS')
})

test('apply-submit-results assigns jobs or per-row rejections by index', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [
      { index: 0, job_id: 'job-a', status: 'queued', message: 'Accepted' },
      { index: 1, error: 'Only PDF thesis files are accepted', status_code: 415 },
    ],
  })
  assert.equal(state.rows[0].jobId, 'job-a')
  assert.equal(state.rows[0].job.status, 'queued')
  assert.equal(state.rows[1].jobId, null)
  assert.equal(state.rows[1].submitError, 'Only PDF thesis files are accepted')
  assert.equal(state.rows[1].submitStatusCode, 415)
})

test('apply-submit-results maps a partial resubmit back through rowIds', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'))
  const [a, b, c] = state.rows
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [
      { index: 0, job_id: 'job-a', status: 'queued' },
      { index: 1, error: 'boom', status_code: 503 },
      { index: 2, error: 'boom', status_code: 503 },
    ],
  })
  state = batchReducer(state, {
    type: 'apply-submit-results',
    rowIds: [b.id, c.id],
    results: [{ index: 0, job_id: 'job-b', status: 'queued' }, { index: 1, error: 'still down', status_code: 503 }],
  })
  assert.equal(state.rows[0].jobId, 'job-a')
  assert.equal(state.rows[1].jobId, 'job-b')
  assert.equal(state.rows[1].submitError, null)
  assert.equal(state.rows[2].submitError, 'still down')
  assert.equal(a.id, state.rows[0].id)
})

test('apply-job-statuses updates rows by job id and expires jobs that vanish', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [{ index: 0, job_id: 'job-a', status: 'queued' }, { index: 1, job_id: 'job-b', status: 'queued' }],
  })
  state = batchReducer(state, {
    type: 'apply-job-statuses',
    jobs: [{ job_id: 'job-a', status: 'processing', stage: 'embed', progress: 58, message: 'Embedding' }],
  })
  assert.equal(state.rows[0].job.progress, 58)
  assert.equal(state.rows[1].missingPolls, 1)
  for (let poll = 1; poll < MISSING_POLLS_BEFORE_EXPIRED; poll += 1) {
    state = batchReducer(state, { type: 'apply-job-statuses', jobs: [{ job_id: 'job-a', status: 'completed', progress: 100 }] })
  }
  assert.equal(state.rows[1].job.status, 'expired')
  assert.equal(state.rows[0].job.status, 'completed')
  // Terminal rows are frozen: a late poll cannot move them back.
  state = batchReducer(state, { type: 'apply-job-statuses', jobs: [{ job_id: 'job-a', status: 'processing', progress: 10 }] })
  assert.equal(state.rows[0].job.status, 'completed')
})

test('terminal detection and summary counts follow the job statuses', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf'))
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [
      { index: 0, job_id: 'job-a', status: 'queued' },
      { index: 1, job_id: 'job-b', status: 'queued' },
      { index: 2, job_id: 'job-c', status: 'queued' },
      { index: 3, error: 'rejected', status_code: 422 },
    ],
  })
  assert.deepEqual(activeJobIds(state.rows), ['job-a', 'job-b', 'job-c'])
  assert.equal(allTerminal(state.rows), false)
  state = batchReducer(state, {
    type: 'apply-job-statuses',
    jobs: [
      { job_id: 'job-a', status: 'completed', progress: 100 },
      { job_id: 'job-b', status: 'retry_wait', progress: 58 },
      { job_id: 'job-c', status: 'failed', progress: 100 },
    ],
  })
  assert.deepEqual(activeJobIds(state.rows), ['job-b'])
  assert.deepEqual(batchSummary(state.rows), {
    total: 4, accepted: 3, rejected: 1, queued: 0, processing: 0, retrying: 1,
    completed: 1, failed: 1, cancelled: 0, expired: 0,
  })
  state = batchReducer(state, { type: 'apply-job-statuses', jobs: [{ job_id: 'job-b', status: 'cancelled' }] })
  assert.equal(allTerminal(state.rows), true)
  assert.equal(isTerminal({ status: 'processing' }), false)
  assert.equal(isTerminal(null), false)
  assert.equal(allTerminal([]), false)
})

test('status tones and labels cover every worker status', () => {
  assert.equal(statusTone('completed'), 'forest')
  assert.equal(statusTone('retry_wait'), 'gold')
  assert.equal(statusTone('failed'), 'flame')
  assert.equal(statusTone('expired'), 'flame')
  assert.equal(statusTone('processing'), 'neutral')
  assert.equal(statusLabel('retry_wait'), 'Retrying')
  assert.equal(statusLabel('completed'), 'Indexed')
  assert.equal(statusLabel(undefined), 'Pending')
  assert.equal(statusLabel('mystery'), 'mystery')
})

test('serialize and restore round-trip only rows that carry a job', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  state = batchReducer(state, { type: 'set-row-field', id: state.rows[0].id, key: 'title', value: 'Restored Title' })
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [{ index: 0, job_id: 'job-a', status: 'queued' }, { index: 1, error: 'nope', status_code: 415 }],
  })
  const json = serializeActiveBatch(state.rows)
  const restored = restoreActiveBatch(json)
  assert.equal(restored.length, 1)
  assert.equal(restored[0].id, state.rows[0].id)
  assert.equal(restored[0].idempotencyKey, state.rows[0].idempotencyKey)
  assert.equal(restored[0].jobId, 'job-a')
  assert.equal(restored[0].title, 'Restored Title')
  assert.equal(restored[0].file, null)
  assert.equal(restored[0].job.status, 'queued')
  const restoredState = batchReducer(createBatchState(), { type: 'restore', rows: restored })
  assert.equal(restoredState.step, BATCH_STEPS.ingesting)
  assert.equal(restoreActiveBatch(null), null)
  assert.equal(restoreActiveBatch('not json'), null)
  assert.equal(restoreActiveBatch('[]'), null)
  assert.equal(restoreActiveBatch('{"jobId": "x"}'), null)
  assert.equal(typeof ACTIVE_BATCH_STORAGE_KEY, 'string')
})

test('step, flag, progress, poll-error and reset actions', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, { type: 'set-step', step: BATCH_STEPS.review })
  state = batchReducer(state, { type: 'set-extracting', value: true })
  state = batchReducer(state, { type: 'set-submitting', value: true })
  state = batchReducer(state, { type: 'set-upload-progress', value: 42 })
  state = batchReducer(state, { type: 'set-poll-error', value: 'paused' })
  assert.equal(state.step, BATCH_STEPS.review)
  assert.equal(state.extracting, true)
  assert.equal(state.submitting, true)
  assert.equal(state.uploadProgress, 42)
  assert.equal(state.pollError, 'paused')
  assert.equal(batchReducer(state, { type: 'unknown' }), state)
  assert.deepEqual(batchReducer(state, { type: 'reset', department: 'CAS' }), createBatchState('CAS'))
})

test('stageLabel names every worker stage and batchProgress averages accepted rows', () => {
  assert.equal(stageLabel('embed'), 'Embedding (768d)')
  assert.equal(stageLabel('store'), 'Securing source')
  assert.equal(stageLabel('done'), 'Indexed')
  assert.equal(stageLabel('unknown-stage'), 'unknown-stage')
  assert.equal(stageLabel(undefined), '')
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'))
  assert.equal(batchProgress(state.rows), 0)
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [
      { index: 0, job_id: 'job-a', status: 'queued' },
      { index: 1, job_id: 'job-b', status: 'queued' },
      { index: 2, error: 'rejected', status_code: 415 },
    ],
  })
  state = batchReducer(state, {
    type: 'apply-job-statuses',
    jobs: [{ job_id: 'job-a', status: 'completed', progress: 100 }, { job_id: 'job-b', status: 'processing', progress: 40 }],
  })
  assert.equal(batchProgress(state.rows), 70)
})

test('the batch wizard names three steps and remembers its direction', () => {
  assert.deepEqual(BATCH_WIZARD_STEPS.map((step) => step.label), ['Manuscripts', 'Review', 'Ingest'])

  let state = createBatchState('CCSICT')
  assert.equal(state.direction, 1)
  state = batchReducer(state, { type: 'set-step', step: BATCH_STEPS.review })
  assert.equal(state.direction, 1)
  state = batchReducer(state, { type: 'set-step', step: BATCH_STEPS.files })
  assert.equal(state.direction, -1)
})

test('the batch rail shows progress only while the workers are running', () => {
  assert.equal(batchRailMode(BATCH_STEPS.files), 'summary')
  assert.equal(batchRailMode(BATCH_STEPS.review), 'summary')
  // Still 'progress' once every job is terminal: the table below keeps listing
  // per-row outcomes, so the ring summarises it rather than duplicating a
  // full-width success screen the way the single wizard does.
  assert.equal(batchRailMode(BATCH_STEPS.ingesting), 'progress')
})
