import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ABSTRACT_MODES, ABSTRACT_MODE_COPY, ABSTRACT_MODE_ORDER, emptyAbstractVariants,
  isAbstractMode, receivedAbstract, switchAbstractMode,
} from './abstractMode.js'

const VERBATIM = 'This study developed a centralized thesis library.'
const EXTENDED = 'The study responded to the difficulty researchers face locating prior work.'

test("the manuscript's own abstract leads the control and is the default", () => {
  assert.deepEqual(ABSTRACT_MODE_ORDER, ['document', 'extended'])
  assert.equal(ABSTRACT_MODE_ORDER[0], ABSTRACT_MODES.document)
})

test('each setting says which of the two texts it produces', () => {
  // The provenance wording is what an uploader reads before submitting an
  // AI-written abstract into a column the archive card renders as the
  // thesis's own. It has to distinguish the two.
  assert.notEqual(
    ABSTRACT_MODE_COPY.document.provenance,
    ABSTRACT_MODE_COPY.extended.provenance,
  )
  assert.match(ABSTRACT_MODE_COPY.extended.provenance, /AI/)
})

test('only the two known settings are settings', () => {
  assert.ok(isAbstractMode('document'))
  assert.ok(isAbstractMode('extended'))
  for (const value of ['verbatim', '', null, undefined, 0]) assert.equal(isAbstractMode(value), false)
})

test('switching to the extended text asks for it once and never again', () => {
  const first = switchAbstractMode({
    mode: ABSTRACT_MODES.extended,
    from: ABSTRACT_MODES.document,
    current: VERBATIM,
    variants: { document: VERBATIM, extended: '' },
  })
  assert.equal(first.fetch, true)
  assert.equal(first.abstract, '')

  const known = switchAbstractMode({
    mode: ABSTRACT_MODES.extended,
    from: ABSTRACT_MODES.document,
    current: VERBATIM,
    variants: { document: VERBATIM, extended: EXTENDED },
  })
  assert.equal(known.fetch, false)
  assert.equal(known.abstract, EXTENDED)
})

test("returning to the manuscript's own abstract never calls anything", () => {
  const back = switchAbstractMode({
    mode: ABSTRACT_MODES.document,
    from: ABSTRACT_MODES.extended,
    current: EXTENDED,
    variants: { document: VERBATIM, extended: EXTENDED },
  })
  assert.equal(back.fetch, false)
  assert.equal(back.abstract, VERBATIM)
  // Even with nothing to go back to: a manuscript whose abstract page was
  // never found must not buy a generation by switching away from one.
  const empty = switchAbstractMode({
    mode: ABSTRACT_MODES.document,
    from: ABSTRACT_MODES.extended,
    current: EXTENDED,
    variants: emptyAbstractVariants(),
  })
  assert.equal(empty.fetch, false)
  assert.equal(empty.abstract, '')
})

test('an edit made in one setting survives a trip through the other', () => {
  const trimmed = `${EXTENDED} Trimmed by the uploader.`
  const away = switchAbstractMode({
    mode: ABSTRACT_MODES.document,
    from: ABSTRACT_MODES.extended,
    current: trimmed,
    variants: { document: VERBATIM, extended: EXTENDED },
  })
  assert.equal(away.abstract, VERBATIM)
  const back = switchAbstractMode({
    mode: ABSTRACT_MODES.extended,
    from: ABSTRACT_MODES.document,
    current: away.abstract,
    variants: away.variants,
  })
  assert.equal(back.abstract, trimmed)
  assert.equal(back.fetch, false)
})

test('a reply files itself under the text it actually carries', () => {
  const generated = receivedAbstract(
    { document: VERBATIM, extended: '' },
    { abstract: EXTENDED, extended: true },
  )
  assert.equal(generated.mode, ABSTRACT_MODES.extended)
  assert.equal(generated.variants.extended, EXTENDED)
  assert.equal(generated.variants.document, VERBATIM)
})

test('a fallback reply returns the control to the setting it belongs to', () => {
  // The endpoint answers 200 with the verbatim abstract when generation fails.
  // Filing that under `extended` would claim a model wrote the manuscript's
  // own sentences, and would burn the one generation this file gets.
  const fallback = receivedAbstract(
    { document: VERBATIM, extended: '' },
    { abstract: VERBATIM, extended: false },
  )
  assert.equal(fallback.mode, ABSTRACT_MODES.document)
  assert.equal(fallback.extended, false)
  assert.equal(fallback.variants.extended, '')
  assert.equal(fallback.abstract, VERBATIM)
})

test('a malformed reply is read as a fallback, not as a generation', () => {
  const reply = receivedAbstract(emptyAbstractVariants(), {})
  assert.equal(reply.mode, ABSTRACT_MODES.document)
  assert.equal(reply.abstract, '')
  assert.equal(reply.extended, false)
})
