import test from 'node:test'
import assert from 'node:assert/strict'
import { createUploadState, isCurrentPoll, uploadReducer, UPLOAD_STEPS } from './uploadState.js'

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

test('stale polling responses are rejected after reset, replacement, or unmount', () => {
  const current = { mounted: true, generation: 3, currentGeneration: 3, jobId: 'job-1', currentJobId: 'job-1' }
  assert.equal(isCurrentPoll(current), true)
  assert.equal(isCurrentPoll({ ...current, currentGeneration: 4 }), false)
  assert.equal(isCurrentPoll({ ...current, currentJobId: 'job-2' }), false)
  assert.equal(isCurrentPoll({ ...current, mounted: false }), false)
})
