import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nextCommandIndex } from './commandPalette.js'

test('arrow keys move through the list and wrap at both ends', () => {
  assert.equal(nextCommandIndex('ArrowDown', 0, 3), 1)
  assert.equal(nextCommandIndex('ArrowDown', 2, 3), 0)
  assert.equal(nextCommandIndex('ArrowUp', 0, 3), 2)
  assert.equal(nextCommandIndex('ArrowUp', 2, 3), 1)
})

test('Home and End jump to the first and last command', () => {
  assert.equal(nextCommandIndex('Home', 2, 4), 0)
  assert.equal(nextCommandIndex('End', 0, 4), 3)
})

test('a stale index is clamped when the filtered list shrinks', () => {
  assert.equal(nextCommandIndex('ArrowDown', 9, 2), 0)
  assert.equal(nextCommandIndex('Tab', 9, 2), 1)
  assert.equal(nextCommandIndex('ArrowDown', -1, 2), 1)
})

test('an empty list has nothing to select', () => {
  assert.equal(nextCommandIndex('ArrowDown', 0, 0), -1)
})
