import test from 'node:test'
import assert from 'node:assert/strict'
import { createUploadState, uploadFieldError, uploadReducer } from './uploadState.js'

test('upload reducer stores the simple flag and value actions', () => {
  let state = createUploadState('CCSICT')
  const file = { name: 'next.pdf' }
  state = uploadReducer(state, { type: 'set-pending-file', file })
  assert.equal(state.pendingFile, file)
  state = uploadReducer(state, { type: 'set-errors', errors: { title: 'Bad' } })
  assert.deepEqual(state.errors, { title: 'Bad' })
  state = uploadReducer(state, { type: 'set-submitting', value: true })
  assert.equal(state.submitting, true)
  state = uploadReducer(state, { type: 'set-parsing', value: true })
  assert.equal(state.parsing, true)
  state = uploadReducer(state, { type: 'set-extending-abstract', value: true })
  assert.equal(state.extendingAbstract, true)
  state = uploadReducer(state, { type: 'set-poll-error', value: 'Network down' })
  assert.equal(state.pollError, 'Network down')
})

test('upload reducer returns the same state for unknown actions', () => {
  const state = createUploadState('CCSICT')
  assert.equal(uploadReducer(state, { type: 'no-such-action' }), state)
})

test('set-form accepts both a replacement object and an updater function', () => {
  let state = createUploadState('CCSICT')
  state = uploadReducer(state, { type: 'set-autofilled', keys: ['title', 'department'] })
  state = uploadReducer(state, { type: 'set-form', value: (form) => ({ ...form, department: 'CBA' }) })
  assert.equal(state.form.department, 'CBA')
  assert.deepEqual(state.autofilled, { title: true })
  const replacement = { ...state.form, title: 'Replaced title' }
  state = uploadReducer(state, { type: 'set-form', value: replacement })
  assert.equal(state.form, replacement)
  assert.deepEqual(state.autofilled, {})
})

test('uploadFieldError treats missing values as empty', () => {
  assert.equal(uploadFieldError('title', {}), 'Please enter the thesis title')
  assert.equal(uploadFieldError('title'), 'Please enter the thesis title')
  assert.equal(uploadFieldError('year', {}), 'Please enter the completion year')
  assert.equal(uploadFieldError('authors', {}), 'Please enter the author name(s)')
  assert.equal(uploadFieldError('authors'), 'Please enter the author name(s)')
})
