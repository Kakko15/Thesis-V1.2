import assert from 'node:assert/strict'
import test from 'node:test'

import {
  THESIS_CATEGORIES, isFacultyThesis, normalizeDepartments, thesisCategoryLabel,
} from './catalog.js'

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

test('thesis categories are exactly student and faculty', () => {
  assert.deepEqual(THESIS_CATEGORIES.map((category) => category.value), ['student', 'faculty'])
})

test('category labels default unknown or missing values to student', () => {
  assert.equal(thesisCategoryLabel('faculty'), 'Faculty research')
  assert.equal(thesisCategoryLabel('student'), 'Student thesis')
  assert.equal(thesisCategoryLabel(undefined), 'Student thesis')
  assert.equal(thesisCategoryLabel('graduate'), 'Student thesis')
})

test('only an explicit faculty category marks a paper as faculty research', () => {
  assert.equal(isFacultyThesis({ thesis_category: 'faculty' }), true)
  assert.equal(isFacultyThesis({ thesis_category: 'student' }), false)
  // Papers indexed before the category migration carry no field.
  assert.equal(isFacultyThesis({}), false)
  assert.equal(isFacultyThesis(null), false)
})
