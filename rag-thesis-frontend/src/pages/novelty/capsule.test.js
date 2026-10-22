import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPSULE_FIELDS, EMPTY_CAPSULE, applyExtractedCapsule, capsuleError, capsuleFileError, capsulePayload,
  isCapsuleScan, loadCapsuleDraft, overwrittenFields, saveCapsuleDraft, screenedSections,
} from './capsule.js'

const METHOD = 'YOLO object detection trained on a locally gathered dataset, evaluated with mAP.'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
    removeItem: (key) => { delete data[key] },
  }
}

test('the capsule form mirrors the server: a title and one substantial section', () => {
  assert.match(capsuleError(EMPTY_CAPSULE), /working title/)
  assert.match(capsuleError({ title: 'A Smart Intruder Detection System' }), /at least one of the rationale/)
  assert.match(capsuleError({ title: 'A Smart Intruder Detection System', rationale: 'Too short.' }), /at least one/)
  assert.equal(capsuleError({ title: 'A Smart Intruder Detection System', methodology: METHOD }), '')
  assert.match(capsuleError({ title: 'Valid title', methodology: 'x'.repeat(6001) }), /Methodology is longer than 6,000/)
  // Whitespace does not count toward the minimum.
  assert.match(capsuleError({ title: '   ab   ', methodology: METHOD }), /working title/)
})

test('only the title and substantial sections are screened', () => {
  assert.deepEqual(
    screenedSections({ title: 'A Smart Intruder Detection System', rationale: 'short', methodology: METHOD }),
    ['title', 'methodology'],
  )
})

test('the payload carries exactly the four capsule fields, trimmed', () => {
  assert.deepEqual(
    capsulePayload({ title: '  Title here  ', methodology: METHOD, timeline: '6 months', budget: 'PHP 5,000' }),
    { title: 'Title here', rationale: '', objectives: '', methodology: METHOD },
  )
  assert.deepEqual(CAPSULE_FIELDS.map((field) => field.key), ['title', 'rationale', 'objectives', 'methodology'])
})

test('the draft survives a reload, is cleared when empty, and fails soft', () => {
  const storage = memoryStorage()
  saveCapsuleDraft({ title: 'Draft title', methodology: METHOD }, storage)
  assert.deepEqual(loadCapsuleDraft(storage), { title: 'Draft title', rationale: '', objectives: '', methodology: METHOD })
  saveCapsuleDraft(EMPTY_CAPSULE, storage)
  assert.deepEqual(storage.data, {})

  // Corrupt or hostile stored values come back as an empty capsule.
  assert.deepEqual(loadCapsuleDraft(memoryStorage({ 'isu-novelty-capsule-draft-v1': '{not json' })), { ...EMPTY_CAPSULE })
  assert.deepEqual(
    loadCapsuleDraft(memoryStorage({ 'isu-novelty-capsule-draft-v1': JSON.stringify({ title: 42, rationale: 'ok' }) })),
    { title: '', rationale: 'ok', objectives: '', methodology: '' },
  )
  // Storage that throws (private mode, blocked site data) never breaks the form.
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() {} }
  assert.deepEqual(loadCapsuleDraft(throwing), { ...EMPTY_CAPSULE })
  assert.doesNotThrow(() => saveCapsuleDraft({ title: 'x' }, throwing))
  assert.deepEqual(loadCapsuleDraft(undefined), { ...EMPTY_CAPSULE })
})

test('a capsule scan is recognised by its per-section result', () => {
  assert.equal(isCapsuleScan({ capsule_sections: [] }), true)
  assert.equal(isCapsuleScan({ capsule_sections: null }), false)
  assert.equal(isCapsuleScan({}), false)
  assert.equal(isCapsuleScan(null), false)
})

test('a capsule file must be PDF, Word or text, and a legacy .doc says how to fix it', () => {
  assert.equal(capsuleFileError({ name: 'Capsule.DOCX', size: 1000 }), '')
  assert.equal(capsuleFileError({ name: 'capsule.pdf', size: 1000 }), '')
  assert.equal(capsuleFileError({ name: 'capsule.txt', size: 1000 }), '')
  assert.match(capsuleFileError({ name: 'capsule.doc', size: 1000 }), /Save the capsule as a \.docx/)
  assert.match(capsuleFileError({ name: 'capsule.pptx', size: 1000 }), /PDF, a Word/)
  assert.match(capsuleFileError({ name: 'capsule.pdf', size: 26 * 1024 * 1024 }), /25 MB/)
  assert.equal(capsuleFileError(null), 'No file.')
})

test('an upload fills what the file supplied and keeps the rest of what was typed', () => {
  const typed = { title: 'Typed title', rationale: 'Typed rationale', objectives: '', methodology: '' }
  const extracted = { title: 'File title', rationale: '', objectives: 'File objectives', methodology: 'File method' }
  const { capsule, filled } = applyExtractedCapsule(typed, extracted)
  assert.deepEqual(capsule, { title: 'File title', rationale: 'Typed rationale', objectives: 'File objectives', methodology: 'File method' })
  assert.deepEqual(filled, ['title', 'objectives', 'methodology'])
  // Only a typed field the file would change counts as overwritten.
  assert.deepEqual(overwrittenFields(typed, extracted), ['title'])
  assert.deepEqual(overwrittenFields(typed, { title: 'Typed title' }), [])
  assert.deepEqual(overwrittenFields(EMPTY_CAPSULE, extracted), [])
  // Over-long extracted text is cut to what the form and server accept.
  assert.equal(applyExtractedCapsule({}, { methodology: 'x'.repeat(7000) }).capsule.methodology.length, 6000)
})
