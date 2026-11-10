import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createUploadState, emptyUploadForm, isCurrentPoll, uploadFieldError, uploadReducer, uploadRequiredErrors, UPLOAD_STEPS,
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

test('autofill notes are retained separately from successful field claims', () => {
  const state = uploadReducer(createUploadState('CCSICT'), {
    type: 'set-autofilled',
    keys: ['title'],
    notes: { adviser: 'Not autofilled: no adviser was found.' },
  })
  assert.deepEqual(state.autofilled, { title: true })
  assert.deepEqual(state.autofillNotes, { adviser: 'Not autofilled: no adviser was found.' })
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

test('the abstract control and both texts reset with the manuscript', () => {
  let state = createUploadState('CCSICT')
  state = uploadReducer(state, {
    type: 'apply-abstract',
    mode: 'extended',
    variants: { document: 'Own words.', extended: 'A longer summary.' },
    abstract: 'A longer summary.',
  })
  assert.equal(state.abstractMode, 'extended')
  assert.equal(state.form.abstract, 'A longer summary.')
  // Machine-made either way, so the provenance chip is claimed either way.
  assert.equal(state.autofilled.abstract, true)

  // A second manuscript is a second pair of abstracts, and an extended one
  // costs a generation: the setting must not carry over and spend one.
  state = uploadReducer(state, { type: 'set-file', file: { name: 'other.pdf' } })
  assert.equal(state.abstractMode, 'document')
  assert.deepEqual(state.abstractVariants, { document: '', extended: '' })
  assert.equal(state.extendingAbstract, false)
})

test('an abstract nobody could produce is claimed by nobody', () => {
  let state = uploadReducer(createUploadState('CCSICT'), {
    type: 'apply-abstract',
    mode: 'document',
    variants: { document: 'Own words.', extended: '' },
    abstract: 'Own words.',
  })
  assert.equal(state.autofilled.abstract, true)
  state = uploadReducer(state, {
    type: 'apply-abstract', mode: 'extended', variants: state.abstractVariants, abstract: '',
  })
  assert.equal(state.form.abstract, '')
  assert.equal('abstract' in state.autofilled, false)
})

test('a hand-typed abstract drops the provenance chip the control set', () => {
  let state = uploadReducer(createUploadState('CCSICT'), {
    type: 'apply-abstract',
    mode: 'extended',
    variants: { document: '', extended: 'A longer summary.' },
    abstract: 'A longer summary.',
  })
  state = uploadReducer(state, { type: 'set-field', key: 'abstract', value: 'Mine.' })
  assert.equal('abstract' in state.autofilled, false)
  // The setting itself stays put: the text on screen is still the extended
  // one, edited, and switching away has to file it under that setting.
  assert.equal(state.abstractMode, 'extended')
})

test('a fresh upload form carries an empty adviser, and editing it drops its autofill claim', () => {
  assert.equal(emptyUploadForm().adviser, '')
  assert.equal(emptyUploadForm().panel_chair, '')
  assert.equal(emptyUploadForm().panel_members, '')
  let state = createUploadState('CCSICT')
  state = uploadReducer(state, { type: 'set-autofilled', keys: ['adviser', 'panel_chair', 'panel_members', 'title'] })
  state = uploadReducer(state, { type: 'set-field', key: 'adviser', value: 'Dr. Ana Cruz' })
  assert.deepEqual(state.autofilled, { panel_chair: true, panel_members: true, title: true })
  assert.equal(state.form.adviser, 'Dr. Ana Cruz')
})

test('uploadFieldError validates empty and invalid single-field values on blur', () => {
  const empty = emptyUploadForm('CCSICT')
  assert.match(uploadFieldError('title', empty), /enter the thesis title/i)
  assert.match(uploadFieldError('title', { ...empty, title: 'abc' }), /at least 5 characters/)
  assert.equal(uploadFieldError('title', { ...empty, title: 'Valid Thesis Title' }), '')
  assert.match(uploadFieldError('authors', empty), /author name/)
  assert.equal(uploadFieldError('authors', { ...empty, authors: 'J. Dela Cruz' }), '')
  assert.match(uploadFieldError('year', empty), /completion year/)
  assert.match(uploadFieldError('year', { ...empty, year: '1900' }), /valid 4-digit year/)
  assert.equal(uploadFieldError('year', { ...empty, year: '2025' }), '')
  assert.match(uploadFieldError('adviser', empty), /thesis adviser/)
  assert.equal(uploadFieldError('adviser', { ...empty, adviser: 'Dr. Adviser' }), '')
  assert.match(uploadFieldError('panel_chair', empty), /panel chair/)
  assert.equal(uploadFieldError('panel_chair', { ...empty, panel_chair: 'Dr. Chair' }), '')
  assert.match(uploadFieldError('panel_members', empty), /panel members/)
  assert.equal(uploadFieldError('panel_members', { ...empty, panel_members: 'Dr. A; Dr. B' }), '')
  assert.match(uploadFieldError('department', { ...empty, department: '' }), /Select the department/)
  assert.equal(uploadFieldError('department', empty), '')
  assert.match(uploadFieldError('program_id', empty), /Select the academic program/)
  assert.equal(uploadFieldError('program_id', { ...empty, program_id: 'p1' }), '')
  assert.match(uploadFieldError('specialization_id', { ...empty, program_id: 'p1', requires_specialization: true }), /specialization/)
  assert.equal(uploadFieldError('specialization_id', { ...empty, program_id: 'p1', requires_specialization: true, specialization_id: 's1' }), '')
  assert.match(uploadFieldError('abstract', empty), /thesis abstract/)
  assert.equal(uploadFieldError('abstract', { ...empty, abstract: 'Complete abstract.' }), '')
  assert.equal(uploadFieldError('unknown', empty), '')

  const allErrs = uploadRequiredErrors(empty)
  assert.deepEqual(
    Object.keys(allErrs).sort(),
    ['abstract', 'adviser', 'authors', 'panel_chair', 'panel_members', 'program_id', 'title', 'year'],
  )
  assert.deepEqual(
    uploadRequiredErrors({
      ...empty,
      title: 'Valid Thesis Title',
      authors: 'J. Dela Cruz',
      year: '2025',
      adviser: 'Dr. Adviser',
      panel_chair: 'Dr. Chair',
      panel_members: 'Dr. A; Dr. B',
      program_id: 'p1',
      abstract: 'Complete abstract.',
    }),
    {},
  )
})
