import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ABSTRACT_IDEAL_WORDS, ABSTRACT_MAX_CHARS, EXTENDED_IDEAL_WORDS, abstractStats,
} from './abstractStats.js'

const words = (count) => Array.from({ length: count }, (_, i) => `w${i}`).join(' ')

test('an empty abstract measures zero and reports no opinion about it', () => {
  for (const value of ['', '   \n\n  ', undefined, null, 42, {}]) {
    const stats = abstractStats(value)
    assert.equal(stats.words, 0)
    assert.equal(stats.tone, 'empty')
  }
  // A whitespace-only value still has characters; only the word count is zero.
  assert.equal(abstractStats('  ').chars, 2)
  assert.equal(abstractStats(undefined).chars, 0)
})

test('words are counted across the line breaks a reflowed abstract carries', () => {
  const stats = abstractStats('This study developed\na centralized   thesis\n\nlibrary.')
  assert.equal(stats.words, 7)
})

test('the tone follows the word band, and the character ceiling outranks it', () => {
  assert.equal(abstractStats(words(ABSTRACT_IDEAL_WORDS.min - 1)).tone, 'brief')
  assert.equal(abstractStats(words(ABSTRACT_IDEAL_WORDS.min)).tone, 'ideal')
  assert.equal(abstractStats(words(ABSTRACT_IDEAL_WORDS.max)).tone, 'ideal')
  assert.equal(abstractStats(words(ABSTRACT_IDEAL_WORDS.max + 1)).tone, 'long')
  // Long enough in words to read as 'long', but close enough to the API's
  // ceiling that the truncation is the thing worth saying.
  assert.equal(abstractStats('x'.repeat(ABSTRACT_MAX_CHARS * 0.9)).tone, 'limit')
})

test('the ratio is clamped, so an over-long paste cannot overflow the meter', () => {
  assert.equal(abstractStats('x'.repeat(ABSTRACT_MAX_CHARS / 2)).ratio, 0.5)
  assert.equal(abstractStats('x'.repeat(ABSTRACT_MAX_CHARS * 2)).ratio, 1)
  assert.equal(abstractStats('').ratio, 0)
})

test('an abstract the uploader asked a model to extend is judged on its own band', () => {
  const long = words(ABSTRACT_IDEAL_WORDS.max + 100)
  // The same text: 'long' as a manuscript abstract, 'ideal' as an extended one.
  assert.equal(abstractStats(long).tone, 'long')
  assert.equal(abstractStats(long, { extended: true }).tone, 'ideal')
  // The wider band still has both edges, and the ceiling still outranks it.
  assert.equal(abstractStats(words(50), { extended: true }).tone, 'brief')
  assert.equal(abstractStats(words(EXTENDED_IDEAL_WORDS.max + 1), { extended: true }).tone, 'long')
  assert.equal(
    abstractStats('x'.repeat(ABSTRACT_MAX_CHARS), { extended: true }).tone,
    'limit',
  )
})
