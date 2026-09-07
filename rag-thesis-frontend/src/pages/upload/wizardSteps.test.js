import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOFILLABLE_KEYS, PIPELINE_STAGES, WIZARD_STEPS,
  autofilledKeys, clampPercent, formatFileSize, isTerminalJob, railMode, stageView, stepInteraction,
  summaryRows,
} from './wizardSteps.js'
import { UPLOAD_STEPS } from './uploadState.js'

test('the wizard names three steps and the worker reports seven stages', () => {
  assert.deepEqual(WIZARD_STEPS.map((step) => step.label), ['Manuscript', 'Metadata', 'Review'])
  assert.equal(PIPELINE_STAGES.length, 7)
  assert.deepEqual(PIPELINE_STAGES.map((stage) => stage.key), [
    'download', 'malware_scan', 'extract', 'chunk', 'embed', 'screen', 'index',
  ])
})

test('clampPercent survives nulls, junk and out-of-range readings', () => {
  assert.equal(clampPercent(undefined), 0)
  assert.equal(clampPercent(null), 0)
  assert.equal(clampPercent('not a number'), 0)
  assert.equal(clampPercent(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampPercent(-20), 0)
  assert.equal(clampPercent(140), 100)
  assert.equal(clampPercent('42.6'), 43)
})

test('stageView maps the staging alias onto the first worker stage', () => {
  // The API reports `store` while the PDF is staged privately; it is not one of
  // the seven worker stages and used to leave the whole timeline inert.
  const view = stageView({ status: 'staging', stage: 'store', progress: 8 })
  assert.equal(view.index, 0)
  assert.equal(view.stages[0].active, true)
  assert.equal(view.stages[0].done, false)
  assert.equal(view.progress, 8)

  const missingStage = stageView({ status: 'queued', progress: 4 })
  assert.equal(missingStage.index, 0)
  assert.equal(missingStage.stages[0].active, true)
})

test('stageView marks earlier stages done and only in-flight statuses active', () => {
  const processing = stageView({ status: 'processing', stage: 'embed', progress: 62 })
  assert.deepEqual(processing.stages.map((stage) => stage.done), [true, true, true, true, false, false, false])
  assert.equal(processing.stages[4].active, true)

  // retry_wait is still in flight — the stage keeps its active treatment.
  assert.equal(stageView({ status: 'retry_wait', stage: 'embed' }).stages[4].active, true)
  // A terminal failure is not: nothing pulses while the job is dead.
  const failed = stageView({ status: 'failed', stage: 'embed' })
  assert.equal(failed.stages[4].active, false)
  assert.equal(failed.stages[3].done, true)
})

test('a completed job reports every stage done and a full bar', () => {
  // The terminal poll does not always carry the last stage, so completion is
  // read from the status rather than from the stage index.
  const view = stageView({ status: 'completed', chunks: 22 })
  assert.ok(view.stages.every((stage) => stage.done))
  assert.ok(view.stages.every((stage) => !stage.active))
  assert.equal(view.progress, 100)
})

test('stageView tolerates no job at all', () => {
  const view = stageView(undefined)
  assert.equal(view.progress, 0)
  assert.equal(view.index, 0)
  assert.ok(view.stages.every((stage) => !stage.done && !stage.active))
})

test('only a step the wizard has moved past is interactive', () => {
  // Guards a Playwright strict-mode trap: accessible names match as substrings,
  // so a focusable rail node named "Review" alongside the footer "Review"
  // button would make getByRole ambiguous. 'done' is the only clickable state.
  assert.equal(stepInteraction(0, 1), 'done')
  assert.equal(stepInteraction(1, 1), 'current')
  assert.equal(stepInteraction(2, 1), 'upcoming')
  assert.notEqual(stepInteraction(2, UPLOAD_STEPS.review), 'done')
})

test('the rail drops its summary once the review panel owns the same data', () => {
  assert.equal(railMode(UPLOAD_STEPS.manuscript), 'summary')
  assert.equal(railMode(UPLOAD_STEPS.metadata), 'summary')
  assert.equal(railMode(UPLOAD_STEPS.review), 'steps')
  assert.equal(railMode(UPLOAD_STEPS.ingesting), 'progress')
  assert.equal(railMode(UPLOAD_STEPS.ingesting, { status: 'processing' }), 'progress')
})

test('the rail steps aside entirely once the job is over', () => {
  // A progress ring reading 100% next to "Thesis indexed!" says nothing, and
  // the outcome reads better across the full width of the card.
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.equal(railMode(UPLOAD_STEPS.ingesting, { status }), 'hidden')
    assert.equal(isTerminalJob({ status }), true)
  }
  assert.equal(isTerminalJob({ status: 'retry_wait' }), false)
  assert.equal(isTerminalJob(undefined), false)
})

test('summaryRows lists only the fields that have been filled in', () => {
  assert.deepEqual(summaryRows(), [])
  assert.deepEqual(summaryRows({ title: '   ' }), [])

  const rows = summaryRows(
    { title: '  A Smart Intruder Detection System ', authors: 'Gumpal, R.', year: 2024, department: 'CCSICT' },
    { categoryLabel: 'Student Thesis', program: { code: 'BSCS' }, specialization: { code: 'DM' } },
  )
  assert.deepEqual(rows.map((row) => row.key), [
    'title', 'authors', 'year', 'category', 'program', 'specialization', 'department',
  ])
  assert.equal(rows[0].value, 'A Smart Intruder Detection System')
  assert.equal(rows[2].value, '2024')
  assert.equal(rows[0].tone, null)
  assert.equal(rows[5].tone, 'gold')
  assert.equal(rows[6].tone, 'neutral')
})

test('summaryRows omits an unpicked program and specialization', () => {
  const rows = summaryRows({ title: 'A Complete Thesis Title', department: 'CCSICT' }, { program: null })
  assert.deepEqual(rows.map((row) => row.key), ['title', 'department'])
})

test('formatFileSize switches to kilobytes below a megabyte', () => {
  // A 400 kB manuscript rounded to "0.00 MB" and read as an empty value.
  assert.equal(formatFileSize(400 * 1024), '400 KB')
  assert.equal(formatFileSize(1.61 * 1024 * 1024), '1.61 MB')
  assert.equal(formatFileSize(200), '1 KB')
  assert.equal(formatFileSize(0), '0 KB')
  assert.equal(formatFileSize(undefined), '0 KB')
  assert.equal(formatFileSize('junk'), '0 KB')
})

test('only fields the extractor actually returned are credited to it', () => {
  assert.deepEqual(autofilledKeys({ title: 'Extracted Title', authors: '', year: 2024 }), ['title', 'year'])
  assert.deepEqual(autofilledKeys({}), [])
  assert.deepEqual(autofilledKeys(), [])
  assert.deepEqual(autofilledKeys({ abstract: 'not autofillable' }), [])
  assert.ok(AUTOFILLABLE_KEYS.includes('department'))
})
