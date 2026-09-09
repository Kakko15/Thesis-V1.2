import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createUploadState, emptyUploadForm, isCurrentPoll, uploadReducer, UPLOAD_STEPS,
} from './uploadState.js'
import { uploadMetadataErrors } from './uploadState.js'

test('upload reducer covers all upload stages and terminal outcomes', () => {
  let state = createUploadState('CCSICT')
  state = uploadReducer(state, { type: 'set-file', file: { name: 'paper.pdf' } })
  state = uploadReducer(state, { type: 'set-step', step: UPLOAD_STEPS.metadata })
  state = uploadReducer(state, { type: 'set-field', key: 'title', value: 'A valid thesis title' })
  state = uploadReducer(state, { type: 'set-step', step: UPLOAD_STEPS.review })
  state = uploadReducer(state, { type: 'set-step', step: UPLOAD_STEPS.ingesting })
  state = uploadReducer(state, { type: 'set-job', job: { status: 'completed', chunks: 12 } })
  assert.equal(state.job.status, 'completed')
  state = uploadReducer(state, { type: 'set-job', job: { status: 'failed', error: 'failed' } })
  assert.equal(state.job.status, 'failed')
})

test('reset clears transient state and restores the enforced department', () => {
  const dirty = { ...createUploadState('OLD'), file: {}, pollError: 'offline', step: 3 }
  assert.deepEqual(uploadReducer(dirty, { type: 'reset', department: 'CCSICT' }), createUploadState('CCSICT'))
})

test('a fresh form is a student thesis until the uploader says otherwise', () => {
  assert.equal(emptyUploadForm().thesis_category, 'student')
  const state = uploadReducer(
    createUploadState('CCSICT'),
    { type: 'set-field', key: 'thesis_category', value: 'faculty' },
  )
  assert.equal(state.form.thesis_category, 'faculty')
  const reset = uploadReducer(state, { type: 'reset', department: 'CCSICT' })
  assert.equal(reset.form.thesis_category, 'student')
})

test('stale polling responses are rejected after reset, replacement, or unmount', () => {
  const current = { mounted: true, generation: 3, currentGeneration: 3, jobId: 'job-1', currentJobId: 'job-1' }
  assert.equal(isCurrentPoll(current), true)
  assert.equal(isCurrentPoll({ ...current, currentGeneration: 4 }), false)
  assert.equal(isCurrentPoll({ ...current, currentJobId: 'job-2' }), false)
  assert.equal(isCurrentPoll({ ...current, mounted: false }), false)
})

test('uploadMetadataErrors enforces title, program, specialization, department and year', () => {
  const base = { ...emptyUploadForm('CCSICT'), title: 'A Complete Thesis Title', program_id: 'p1' }
  assert.deepEqual(uploadMetadataErrors(base), {})
  assert.match(uploadMetadataErrors({ ...base, title: 'abc' }).title, /full thesis title/)
  assert.match(uploadMetadataErrors({ ...base, program_id: '' }).program_id, /academic program/)
  assert.equal(uploadMetadataErrors({ ...base, program_id: '', thesis_category: 'faculty' }).program_id, undefined)
  assert.match(uploadMetadataErrors({ ...base, requires_specialization: true }).specialization_id, /specialization/)
  assert.equal(uploadMetadataErrors({ ...base, requires_specialization: true, specialization_id: 's1' }).specialization_id, undefined)
  assert.match(uploadMetadataErrors({ ...base, department: '' }).department, /department/)
  assert.equal(uploadMetadataErrors({ ...base, year: '' }).year, undefined)
  assert.equal(uploadMetadataErrors({ ...base, year: String(new Date().getFullYear()) }).year, undefined)
  assert.match(uploadMetadataErrors({ ...base, year: '1900' }).year, /valid year/)
  assert.match(uploadMetadataErrors({ ...base, year: '20x6' }).year, /valid year/)
  assert.match(uploadMetadataErrors({ ...base, year: String(new Date().getFullYear() + 2) }).year, /valid year/)
  assert.match(uploadMetadataErrors({ ...emptyUploadForm('CCSICT'), title: undefined }).title, /full thesis title/)
})

test('the wizard remembers which way it last moved', () => {
  // The step surfaces slide along this axis, so Back has to reverse the
  // transition rather than replay the forward one.
  let state = createUploadState('CCSICT')
  assert.equal(state.direction, 1)
  state = uploadReducer(state, { type: 'set-step', step: UPLOAD_STEPS.metadata })
  assert.equal(state.direction, 1)
  state = uploadReducer(state, { type: 'set-step', step: UPLOAD_STEPS.manuscript })
  assert.equal(state.direction, -1)
  state = uploadReducer(state, { type: 'set-step', step: UPLOAD_STEPS.manuscript })
  assert.equal(state.direction, 1)
})

test('autofill provenance is recorded per key and cleared on first edit', () => {
  let state = uploadReducer(createUploadState('CCSICT'), { type: 'set-autofilled', keys: ['title', 'year'] })
  assert.deepEqual(state.autofilled, { title: true, year: true })

  state = uploadReducer(state, { type: 'set-field', key: 'title', value: 'An edited thesis title' })
  assert.deepEqual(state.autofilled, { year: true })

  // Editing a field the extractor never claimed leaves the map untouched by
  // identity, so the chips do not re-render on every keystroke.
  const before = state.autofilled
  state = uploadReducer(state, { type: 'set-field', key: 'authors', value: 'Dela Cruz, J.' })
  assert.equal(state.autofilled, before)

  state = uploadReducer(state, { type: 'set-autofilled', keys: undefined })
  assert.deepEqual(state.autofilled, {})
})

test('set-form drops the autofill claims whose value it changed', () => {
  // A Select is edited through set-form, so without this the extractor went on
  // being credited for a department or program the uploader had since changed
  // — and the chips had to be left off those fields entirely to avoid lying.
  let state = createUploadState('CCSICT')
  state = uploadReducer(state, {
    type: 'set-form',
    value: (form) => ({ ...form, department: 'CCSICT', program_id: 'p-bscs', title: 'An Extracted Title' }),
  })
  state = uploadReducer(state, { type: 'set-autofilled', keys: ['title', 'department', 'program_id'] })

  // Picking a different program clears its claim and nothing else.
  state = uploadReducer(state, {
    type: 'set-form',
    value: (form) => ({ ...form, program_id: 'p-blis', specialization_id: '', track: 'BLIS' }),
  })
  assert.deepEqual(state.autofilled, { title: true, department: true })

  // Re-selecting the same value changes nothing, so the map keeps its identity
  // and the chips do not re-render.
  const before = state.autofilled
  state = uploadReducer(state, { type: 'set-form', value: (form) => ({ ...form, program_id: 'p-blis' }) })
  assert.equal(state.autofilled, before)

  state = uploadReducer(state, { type: 'set-form', value: (form) => ({ ...form, department: 'CAS' }) })
  assert.deepEqual(state.autofilled, { title: true })
})
