import assert from 'node:assert/strict'
import test from 'node:test'

import { contentKeys, slotKeys } from './keys.js'

test('content keys stay with an item when earlier entries are trimmed', () => {
  // The novelty chat log is trimmed to its newest entries server-side, which
  // shifts every remaining item down one position. An index key would hand a
  // surviving message the identity of the one that used to sit there.
  const before = contentKeys(['user|first', 'ai|second', 'user|third'], 'chat')
  const afterTrim = contentKeys(['ai|second', 'user|third'], 'chat')

  assert.equal(afterTrim[0], before[1])
  assert.equal(afterTrim[1], before[2])
})

test('content keys stay unique when the same value repeats', () => {
  const keys = contentKeys(['yes', 'no', 'yes', 'yes'], 'word')

  assert.equal(new Set(keys).size, 4)
  assert.notEqual(keys[0], keys[2])
})

test('content keys follow an item through a reorder', () => {
  const original = contentKeys(['alpha', 'beta', 'gamma'], 'item')
  const reordered = contentKeys(['gamma', 'alpha', 'beta'], 'item')

  assert.equal(reordered[0], original[2])
  assert.equal(reordered[1], original[0])
})

test('content keys handle non-string values without collapsing them', () => {
  const keys = contentKeys([{ a: 1 }, { a: 2 }, { a: 1 }], 'obj')

  assert.equal(new Set(keys).size, 3)
})

test('slot keys are unique, stable and match the requested count', () => {
  const first = slotKeys(4, 'skeleton')
  const second = slotKeys(4, 'skeleton')

  assert.equal(first.length, 4)
  assert.equal(new Set(first).size, 4)
  assert.deepEqual(first, second)
  assert.notEqual(first[0], slotKeys(4, 'other')[0])
})
