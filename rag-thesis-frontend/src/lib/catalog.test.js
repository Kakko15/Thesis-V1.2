import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeDepartments } from './catalog.js'

const departments = [{ id: 'ccsict', name: 'CCSICT' }]

test('normalizes legacy array and versioned catalog responses', () => {
  assert.deepEqual(normalizeDepartments(departments), departments)
  assert.deepEqual(normalizeDepartments({ departments }), departments)
})

test('returns an empty array for invalid catalog responses', () => {
  assert.deepEqual(normalizeDepartments(null), [])
  assert.deepEqual(normalizeDepartments('<!doctype html>'), [])
  assert.deepEqual(normalizeDepartments({ detail: 'Unavailable' }), [])
})

test('removes malformed department entries', () => {
  assert.deepEqual(
    normalizeDepartments([null, 'CCSICT', departments[0], []]),
    departments,
  )
})
