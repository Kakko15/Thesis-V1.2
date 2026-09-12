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

const CATALOG = [{
  id: 'dept-ccsict',
  name: 'CCSICT',
  programs: [
    {
      id: 'p-bscs', code: 'BSCS', name: 'Bachelor of Science in Computer Science',
      specializations: [{ id: 's-dm', code: 'DM', name: 'Data Mining' }],
    },
    {
      id: 'p-bsis', code: 'BSIS', name: 'Bachelor of Science in Information Systems',
      specializations: [],
    },
  ],
}]

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

test('splitMetadataErrors keeps each manuscript’s own program with its row', () => {
  // The program moved out of the shared card: a batch is a shelf of theses
  // from whatever degrees the college awards, so it is a row's own field and
  // its complaint belongs beside that row, not above the whole table.
  const row = { title: 'abc', authors: '', year: '1900' }
  const { rowErrors, defaultErrors } = splitMetadataErrors(row, emptyBatchDefaults('CCSICT'))
  assert.deepEqual(Object.keys(rowErrors).sort(), ['program_id', 'title', 'year'])
  assert.deepEqual(defaultErrors, {})

  const faculty = splitMetadataErrors(
    { title: 'A Long Enough Title', authors: '', year: '' },
    { ...emptyBatchDefaults('CCSICT'), thesis_category: 'faculty' },
  )
  assert.deepEqual(faculty.rowErrors, {})
  assert.deepEqual(faculty.defaultErrors, {})

  // The department is the one classification field still shared, so it is the
  // only one that can land on the shared card.
  const specialization = splitMetadataErrors(
    { title: 'A Long Enough Title', program_id: 'p-bscs', requires_specialization: true },
    emptyBatchDefaults(''),
  )
  assert.deepEqual(Object.keys(specialization.rowErrors), ['specialization_id'])
  assert.deepEqual(Object.keys(specialization.defaultErrors), ['department'])
})

test('validateBatch reports each row separately and flags rejected files', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  const [a, b] = state.rows
  state = batchReducer(state, { type: 'set-row-field', id: a.id, key: 'title', value: 'A Complete Thesis Title' })
  state = batchReducer(state, { type: 'patch-row', id: a.id, patch: { program_id: 'p-bsis' } })
  state = batchReducer(state, { type: 'apply-extraction', files: [{ index: 1, error: 'Malformed or unreadable PDF' }] })
  const defaults = emptyBatchDefaults('CCSICT')
  const invalid = validateBatch(state.rows, defaults)
  assert.equal(invalid.valid, false)
  // The classified row is clean even though its neighbour has no program: one
  // unclassified manuscript no longer holds up the rest of the batch.
  assert.equal(invalid.rowErrorsById[a.id], undefined)
  assert.match(invalid.rowErrorsById[b.id].title, /title/)
  assert.match(invalid.rowErrorsById[b.id].program_id, /academic program/)
  assert.match(invalid.rowErrorsById[b.id].file, /Remove this file/)
  assert.deepEqual(invalid.defaultErrors, {})

  const cleaned = batchReducer(state, { type: 'remove-row', id: b.id })
  const valid = validateBatch(cleaned.rows, defaults)
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.rowErrorsById, {})
  assert.deepEqual(validateBatch([], defaults).defaultErrors, { rows: 'Add at least one manuscript' })
})

test('a batch may mix programs, so two rows validate against their own', () => {
  let state = stateWithFiles(pdf('cs.pdf'), pdf('is.pdf'))
  const [cs, is] = state.rows
  for (const row of state.rows) {
    state = batchReducer(state, { type: 'set-row-field', id: row.id, key: 'title', value: 'A Complete Thesis Title' })
  }
  state = batchReducer(state, {
    type: 'patch-row', id: cs.id, patch: { program_id: 'p-bscs', requires_specialization: true },
  })
  state = batchReducer(state, { type: 'patch-row', id: is.id, patch: { program_id: 'p-bsis' } })
  const defaults = emptyBatchDefaults('CCSICT')
  // BSCS needs a specialization and BSIS does not; only the BSCS row complains.
  let result = validateBatch(state.rows, defaults)
  assert.match(result.rowErrorsById[cs.id].specialization_id, /specialization/)
  assert.equal(result.rowErrorsById[is.id], undefined)

  state = batchReducer(state, { type: 'patch-row', id: cs.id, patch: { specialization_id: 's-dm' } })
  result = validateBatch(state.rows, defaults)
  assert.equal(result.valid, true)
})

test('apply-extraction resolves each title page against the batch department', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf'))
  state = batchReducer(state, {
    type: 'patch-row', id: state.rows[3].id, patch: { program_id: 'p-bsis', track: 'BSIS' },
  })
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [
      { index: 0, title: 'A', program_code: 'BSCS', specialization_code: 'DM' },
      { index: 1, title: 'B', program_code: 'BSIS' },
      // A program from another college: resolved inside CCSICT it is nothing,
      // so the row keeps an empty program rather than an unsubmittable one.
      { index: 2, title: 'C', program_code: 'ABCOM' },
      { index: 3, title: 'D', program_code: 'BSCS', specialization_code: 'DM' },
    ],
  })
  assert.deepEqual(
    state.rows.map((row) => [row.program_id, row.specialization_id, row.track]),
    [
      ['p-bscs', 's-dm', 'Data Mining'],
      ['p-bsis', '', 'BSIS'],
      ['', '', ''],
      // Already chosen by hand, so extraction leaves it alone.
      ['p-bsis', '', 'BSIS'],
    ],
  )
  assert.equal(state.rows[0].requires_specialization, true)
  assert.equal(state.rows[1].requires_specialization, false)
})

test('apply-program sets one classification across every row', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'))
  state = batchReducer(state, {
    type: 'apply-extraction',
    files: [{ index: 2, error: 'Malformed or unreadable PDF' }],
    departments: CATALOG,
  })
  const selection = {
    program_id: 'p-bscs', specialization_id: 's-dm',
    requires_specialization: true, track: 'Data Mining',
  }
  state = batchReducer(state, { type: 'apply-program', selection })
  // The rejected row is left out: it is being removed, not classified.
  assert.deepEqual(state.rows.map((row) => row.program_id), ['p-bscs', 'p-bscs', ''])

  // Changing the department clears them all: a program belongs to one college.
  const cleared = batchReducer(state, {
    type: 'apply-program',
    selection: { program_id: '', specialization_id: '', requires_specialization: false, track: '' },
  })
  assert.deepEqual(cleared.rows.map((row) => row.program_id), ['', '', ''])
})

test('set-row-errors and set-default-errors store validation output', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const [a] = state.rows
  state = batchReducer(state, { type: 'set-row-errors', errorsById: { [a.id]: { title: 'Enter the full thesis title' } } })
  state = batchReducer(state, { type: 'set-default-errors', errors: { department: 'Select the department' } })
  assert.equal(state.rows[0].errors.title, 'Enter the full thesis title')
  assert.equal(state.defaultErrors.department, 'Select the department')
  state = batchReducer(state, { type: 'set-row-errors', errorsById: {} })
  assert.deepEqual(state.rows[0].errors, {})
})

test('defaults actions update the two fields the batch really shares', () => {
  let state = createBatchState('CCSICT')
  state = batchReducer(state, { type: 'set-defaults-field', key: 'thesis_category', value: 'faculty' })
  assert.equal(state.defaults.thesis_category, 'faculty')
  state = batchReducer(state, { type: 'set-defaults', value: (current) => ({ ...current, department: 'CAS' }) })
  assert.equal(state.defaults.department, 'CAS')
  state = batchReducer(state, { type: 'set-defaults', value: emptyBatchDefaults('CCSICT') })
  assert.deepEqual(state.defaults, { department: 'CCSICT', thesis_category: 'student' })
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
  const json = serializeActiveBatch(state.rows, 'user-alice')
  const restored = restoreActiveBatch(json, 'user-alice')
  assert.equal(restored.length, 1)
  assert.equal(restored[0].id, state.rows[0].id)
  assert.equal(restored[0].idempotencyKey, state.rows[0].idempotencyKey)
  assert.equal(restored[0].jobId, 'job-a')
  assert.equal(restored[0].title, 'Restored Title')
  assert.equal(restored[0].file, null)
  assert.equal(restored[0].job.status, 'queued')
  const restoredState = batchReducer(createBatchState(), { type: 'restore', rows: restored })
  assert.equal(restoredState.step, BATCH_STEPS.ingesting)
  assert.equal(restoreActiveBatch(null, 'user-alice'), null)
  assert.equal(restoreActiveBatch('not json', 'user-alice'), null)
  assert.equal(restoreActiveBatch('[]', 'user-alice'), null)
  assert.equal(restoreActiveBatch('{"jobId": "x"}', 'user-alice'), null)
  assert.equal(typeof ACTIVE_BATCH_STORAGE_KEY, 'string')
})

test('a stored batch is never restored to a different account', () => {
  let state = stateWithFiles(pdf('alice-thesis.pdf'))
  state = batchReducer(state, {
    type: 'set-row-field', id: state.rows[0].id, key: 'title', value: 'Alice private title',
  })
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [{ index: 0, job_id: 'job-a', status: 'queued' }],
  })
  const json = serializeActiveBatch(state.rows, 'user-alice')

  // sessionStorage survives a sign-out, so the next reader in the same tab used
  // to see Alice's filenames and titles restored into their own table.
  assert.equal(restoreActiveBatch(json, 'user-bob'), null)
  // An unresolved identity restores nothing rather than guessing.
  assert.equal(restoreActiveBatch(json, null), null)
  assert.equal(restoreActiveBatch(json, undefined), null)
  // The owner still gets their own batch back across a reload.
  assert.equal(restoreActiveBatch(json, 'user-alice').length, 1)
  // The pre-owner-stamp shape carries no owner, so it is discarded.
  const legacy = JSON.stringify([{ id: 'r1', jobId: 'job-a', title: 'Alice private title' }])
  assert.equal(restoreActiveBatch(legacy, 'user-alice'), null)
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
  assert.equal(stageLabel('queued'), 'In queue')
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
