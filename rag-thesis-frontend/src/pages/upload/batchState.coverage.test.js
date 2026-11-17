import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MISSING_POLLS_BEFORE_EXPIRED,
  batchProgress,
  batchReducer,
  batchSummary,
  createBatchRow,
  createBatchState,
  restoreActiveBatch,
  serializeActiveBatch,
  splitMetadataErrors,
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

test('createBatchRow falls back to getRandomValues when crypto.randomUUID is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const realCrypto = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: { getRandomValues: (array) => realCrypto.getRandomValues(array) },
  })
  try {
    const row = createBatchRow(pdf('a.pdf'))
    assert.match(row.id, /^\d+-[0-9a-f]{16}$/)
    assert.match(row.idempotencyKey, /^\d+-[0-9a-f]{16}$/)
    assert.notEqual(row.id, row.idempotencyKey)
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original)
    else delete globalThis.crypto
  }
  assert.equal(globalThis.crypto, realCrypto)
})

test('apply-extraction keeps values a row already has and notes nothing for them', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const id = state.rows[0].id
  state = batchReducer(state, {
    type: 'patch-row',
    id,
    patch: {
      title: 'Typed Title', authors: 'Typed Author', adviser: 'Typed Adviser',
      panel_chair: 'Typed Chair', panel_members: 'Typed Members', abstract: 'Typed abstract',
      year: '2020', program_id: 'p-bsis',
    },
  })
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [{
      index: 0, title: 'Doc Title', authors: 'Doc Author', adviser: 'Doc Adviser',
      panel_chair: 'Doc Chair', panel_members: 'Doc Members', abstract: 'Doc abstract',
      year: 2019, program_code: 'BSCS',
    }],
  })
  const row = state.rows[0]
  assert.equal(row.title, 'Typed Title')
  assert.equal(row.authors, 'Typed Author')
  assert.equal(row.adviser, 'Typed Adviser')
  assert.equal(row.panel_chair, 'Typed Chair')
  assert.equal(row.panel_members, 'Typed Members')
  assert.equal(row.abstract, 'Typed abstract')
  assert.equal(row.year, '2020')
  // A chosen program is never overwritten by the extracted code.
  assert.equal(row.program_id, 'p-bsis')
  assert.deepEqual(row.autofillNotes, {})
  // The document variant is still recorded for the abstract toggle.
  assert.equal(row.abstractVariants.document, 'Doc abstract')
})

test('apply-extraction fills empty rows from the entry and resolves the program without specialization notes', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [{
      index: 0, title: 'Doc Title', authors: 'Doc Author', adviser: 'Doc Adviser',
      panel_chair: 'Doc Chair', panel_members: 'Doc Members', abstract: 'Doc abstract',
      year: 2019, program_code: 'BSIS',
    }],
  })
  const row = state.rows[0]
  assert.equal(row.title, 'Doc Title')
  assert.equal(row.authors, 'Doc Author')
  assert.equal(row.adviser, 'Doc Adviser')
  assert.equal(row.panel_chair, 'Doc Chair')
  assert.equal(row.panel_members, 'Doc Members')
  assert.equal(row.abstract, 'Doc abstract')
  assert.equal(row.year, '2019')
  assert.equal(row.program_id, 'p-bsis')
  assert.equal(row.requires_specialization, false)
  assert.equal(row.track, 'BSIS')
  assert.deepEqual(row.autofillNotes, {})
})

test('apply-extraction notes an unmatched printed specialization', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [{ index: 0, title: 'Doc Title', program_code: 'BSCS', specialization_code: 'NOPE' }],
  })
  const row = state.rows[0]
  assert.equal(row.program_id, 'p-bscs')
  assert.equal(row.specialization_id, '')
  assert.equal(row.requires_specialization, true)
  assert.match(row.autofillNotes.specialization_id, /printed specialization did not match/)
  assert.equal(row.autofillNotes.program_id, undefined)
})

test('apply-extraction notes a missing specialization when none was printed', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [{ index: 0, title: 'Doc Title', program_code: 'BSCS' }],
  })
  const row = state.rows[0]
  assert.match(row.autofillNotes.specialization_id, /no specialization was identified/)
  // Missing fields fall back to empty strings, including a missing year.
  assert.equal(row.authors, '')
  assert.equal(row.year, '')
  assert.equal(row.abstract, '')
})

test('apply-extraction leaves no specialization note when the printed one matched', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [{ index: 0, title: 'Doc Title', program_code: 'BSCS', specialization_code: 'DM' }],
  })
  const row = state.rows[0]
  assert.equal(row.specialization_id, 's-dm')
  assert.equal(row.track, 'Data Mining')
  assert.equal(row.autofillNotes.specialization_id, undefined)
})

test('apply-extraction rebuilds variants for a row that has none and keeps an earlier document abstract', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  const [first, second] = state.rows
  state = batchReducer(state, { type: 'patch-row', id: first.id, patch: { abstractVariants: undefined } })
  state = batchReducer(state, {
    type: 'patch-row', id: second.id,
    patch: { abstractVariants: { document: 'Earlier doc abstract', extended: 'Long one' } },
  })
  state = batchReducer(state, {
    type: 'apply-extraction',
    departments: CATALOG,
    files: [
      { index: 0, title: 'First Title', abstract: 'First abstract' },
      { index: 1, title: 'Second Title', abstract: 'Newer abstract' },
    ],
  })
  assert.equal(state.rows[0].abstractVariants.document, 'First abstract')
  assert.equal(state.rows[1].abstractVariants.document, 'Earlier doc abstract')
  assert.equal(state.rows[1].abstractVariants.extended, 'Long one')
  assert.equal(state.rows[1].abstract, 'Newer abstract')
})

test('apply-extraction without a files list leaves every row untouched', () => {
  const state = stateWithFiles(pdf('a.pdf'))
  const next = batchReducer(state, { type: 'apply-extraction', departments: CATALOG })
  assert.deepEqual(next.rows, state.rows)
  assert.equal(next.rows[0].extracted, false)
})

test('mark-extraction-failed uses a default message when none is given', () => {
  const state = batchReducer(stateWithFiles(pdf('a.pdf')), { type: 'mark-extraction-failed' })
  assert.equal(state.rows[0].autofillError, 'Metadata extraction was unavailable.')
  assert.match(state.rows[0].autofillNotes.title, /Autofill unavailable/)
  const custom = batchReducer(stateWithFiles(pdf('a.pdf')), { type: 'mark-extraction-failed', message: 'Server down' })
  assert.equal(custom.rows[0].autofillError, 'Server down')
})

test('apply-extraction notes and blanks a title the document did not carry', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, { type: 'apply-extraction', departments: CATALOG, files: [{ index: 0 }] })
  const row = state.rows[0]
  assert.equal(row.extracted, true)
  assert.equal(row.title, '')
  assert.match(row.autofillNotes.title, /no recognizable thesis title/)
  assert.match(row.autofillNotes.program_id, /no recognizable academic program/)
})

test('apply-submit-results queues an accepted row with default status and message', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  state = batchReducer(state, { type: 'apply-submit-results', results: [{ index: 0, job_id: 'job-a' }] })
  assert.equal(state.rows[0].jobId, 'job-a')
  assert.deepEqual(state.rows[0].job, {
    status: 'queued', stage: 'download', progress: 8, message: 'Queued for the durable worker.',
  })
})

test('apply-submit-results tolerates a missing results list and stray indexes', () => {
  const state = stateWithFiles(pdf('a.pdf'))
  assert.deepEqual(batchReducer(state, { type: 'apply-submit-results' }).rows, state.rows)
  const stray = batchReducer(state, { type: 'apply-submit-results', results: [{ index: 5, job_id: 'job-x' }] })
  assert.equal(stray.rows[0].jobId, null)
})

test('apply-submit-results keeps an existing job, uses server status/message, and default errors', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'))
  const existingJob = { status: 'processing', progress: 40 }
  state = batchReducer(state, { type: 'patch-row', id: state.rows[0].id, patch: { job: existingJob } })
  state = batchReducer(state, {
    type: 'apply-submit-results',
    results: [
      { index: 0, job_id: 'job-a' },
      { index: 1, job_id: 'job-b', status: 'staging', message: 'Staged by the API.' },
      { index: 2 },
    ],
  })
  assert.equal(state.rows[0].jobId, 'job-a')
  assert.equal(state.rows[0].job, existingJob)
  assert.equal(state.rows[1].job.status, 'staging')
  assert.equal(state.rows[1].job.message, 'Staged by the API.')
  assert.equal(state.rows[2].submitError, 'This file was not accepted.')
  assert.equal(state.rows[2].submitStatusCode, null)
})

test('apply-job-statuses tolerates a missing jobs list and expires rows that never had a job snapshot', () => {
  let state = stateWithFiles(pdf('a.pdf'), pdf('b.pdf'))
  state = batchReducer(state, {
    type: 'patch-row', id: state.rows[0].id, patch: { jobId: 'job-a', job: null },
  })
  state = batchReducer(state, {
    type: 'patch-row', id: state.rows[1].id, patch: { jobId: 'job-b', job: { status: 'processing', progress: 55 } },
  })
  for (let i = 0; i < MISSING_POLLS_BEFORE_EXPIRED; i += 1) {
    state = batchReducer(state, { type: 'apply-job-statuses' })
  }
  assert.equal(state.rows[0].job.status, 'expired')
  assert.equal(state.rows[0].job.progress, 0)
  assert.equal(state.rows[1].job.status, 'expired')
  assert.equal(state.rows[1].job.progress, 55)
})

test('set-row-field refreshes a still-invalid error message', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const id = state.rows[0].id
  state = batchReducer(state, { type: 'blur-row-field', id, key: 'title' })
  assert.equal(state.rows[0].errors.title, 'Please enter the thesis title')
  state = batchReducer(state, { type: 'set-row-field', id, key: 'title', value: 'abc' })
  assert.equal(state.rows[0].errors.title, 'Enter the full thesis title (at least 5 characters)')
})

test('blur-row-field clears an error once the value is valid and copes with rows lacking errors', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const id = state.rows[0].id
  state = batchReducer(state, { type: 'patch-row', id, patch: { errors: undefined, title: 'A full thesis title' } })
  state = batchReducer(state, { type: 'blur-row-field', id, key: 'title' })
  assert.deepEqual(state.rows[0].errors, {})
  state = batchReducer(state, { type: 'patch-row', id, patch: { errors: { title: 'stale' } } })
  state = batchReducer(state, { type: 'blur-row-field', id, key: 'title' })
  assert.equal('title' in state.rows[0].errors, false)
})

test('apply-row-abstract stores an empty abstract when none is supplied', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const id = state.rows[0].id
  state = batchReducer(state, { type: 'apply-row-abstract', id, mode: 'extended', variants: { document: '', extended: '' } })
  assert.equal(state.rows[0].abstract, '')
  assert.equal(state.rows[0].abstractMode, 'extended')
  state = batchReducer(state, { type: 'apply-row-abstract', id, mode: 'document', variants: {}, abstract: 'Text' })
  assert.equal(state.rows[0].abstract, 'Text')
})

test('patch-row revalidates errored keys from function and null patches', () => {
  let state = stateWithFiles(pdf('a.pdf'))
  const id = state.rows[0].id
  state = batchReducer(state, { type: 'patch-row', id, patch: { errors: undefined } })
  state = batchReducer(state, { type: 'patch-row', id, patch: (row) => ({ title: `${row.name} title` }) })
  assert.equal(state.rows[0].title, 'a.pdf title')

  state = batchReducer(state, { type: 'patch-row', id, patch: { title: '', errors: { title: 'old', authors: 'old' } } })
  // A null patch changes nothing and leaves the existing errors alone.
  state = batchReducer(state, { type: 'patch-row', id, patch: null })
  assert.deepEqual(state.rows[0].errors, { title: 'old', authors: 'old' })

  // Still invalid: the message is refreshed. Now valid: it is removed.
  state = batchReducer(state, { type: 'patch-row', id, patch: (row) => ({ title: 'abc', authors: row.authors }) })
  assert.equal(state.rows[0].errors.title, 'Enter the full thesis title (at least 5 characters)')
  assert.equal(state.rows[0].errors.authors, 'Please enter the author name(s)')
  state = batchReducer(state, { type: 'patch-row', id, patch: { title: 'A full thesis title', year: '2020' } })
  assert.equal('title' in state.rows[0].errors, false)
})

test('splitMetadataErrors treats missing row fields as empty', () => {
  const { rowErrors, defaultErrors } = splitMetadataErrors({}, { department: '', thesis_category: 'student' })
  assert.equal(rowErrors.title, 'Enter the full thesis title')
  assert.equal(rowErrors.program_id, 'Select the academic program')
  assert.equal(defaultErrors.department, 'Select the department')
})

test('batchSummary counts every status bucket', () => {
  const rows = [
    { jobId: null, submitError: null },
    { jobId: 'a', job: null },
    { jobId: 'b', job: { status: 'completed' } },
    { jobId: 'c', job: { status: 'failed' } },
    { jobId: 'd', job: { status: 'cancelled' } },
    { jobId: 'e', job: { status: 'expired' } },
    { jobId: 'f', job: { status: 'retry_wait' } },
    { jobId: 'g', job: { status: 'processing' } },
    { jobId: 'h', job: { status: 'staging' } },
    { jobId: null, submitError: 'nope' },
  ]
  assert.deepEqual(batchSummary(rows), {
    total: 10, accepted: 8, rejected: 1, queued: 2, processing: 1,
    retrying: 1, completed: 1, failed: 1, cancelled: 1, expired: 1,
  })
})

test('batchProgress clamps progress and treats a missing job as zero', () => {
  assert.equal(batchProgress([]), 0)
  assert.equal(batchProgress([
    { jobId: 'a', job: null },
    { jobId: 'b', job: { progress: 150 } },
    { jobId: 'c', job: { progress: -20 } },
    { jobId: 'd', job: {} },
    { jobId: null, job: { progress: 100 } },
  ]), 25)
})

test('serializeActiveBatch records a null owner when none is known', () => {
  const parsed = JSON.parse(serializeActiveBatch([{ id: 'r', jobId: 'j', name: 'a.pdf', size: 1, title: 'T', idempotencyKey: 'k' }]))
  assert.equal(parsed.ownerId, null)
  assert.equal(parsed.rows.length, 1)
})

test('restoreActiveBatch rejects stored payloads without rows and defaults missing entry fields', () => {
  assert.equal(restoreActiveBatch(JSON.stringify({ ownerId: 'u1' }), 'u1'), null)
  assert.equal(restoreActiveBatch(JSON.stringify({ ownerId: 'u1', rows: [] }), 'u1'), null)
  assert.equal(restoreActiveBatch('null', 'u1'), null)
  const rows = restoreActiveBatch(JSON.stringify({
    ownerId: 'u1',
    rows: [
      { id: 'r1', jobId: 'j1' },
      { id: 'r2', jobId: 'j2', name: 'b.pdf', size: 42, title: 'Kept', idempotencyKey: 'k2' },
      null,
      { id: 3, jobId: 'j3' },
    ],
  }), 'u1')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'manuscript.pdf')
  assert.equal(rows[0].size, 0)
  assert.equal(rows[0].title, '')
  assert.equal(typeof rows[0].idempotencyKey, 'string')
  assert.equal(rows[1].name, 'b.pdf')
  assert.equal(rows[1].size, 42)
  assert.equal(rows[1].title, 'Kept')
  assert.equal(rows[1].idempotencyKey, 'k2')
})
