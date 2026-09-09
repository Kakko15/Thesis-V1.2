import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampPage,
  getPaginationPages,
  paginateItems,
  totalPageCount,
} from './pagination.js'

test('totalPageCount computes correct page count and clamps safely', () => {
  assert.equal(totalPageCount(0, 5), 1)
  assert.equal(totalPageCount(1, 5), 1)
  assert.equal(totalPageCount(5, 5), 1)
  assert.equal(totalPageCount(6, 5), 2)
  assert.equal(totalPageCount(12, 5), 3)
  assert.equal(totalPageCount(17, 10), 2)
  assert.equal(totalPageCount(-5, 5), 1)
  assert.equal(totalPageCount(10, 0), 10)
})

test('clampPage keeps page within [1, totalPages]', () => {
  assert.equal(clampPage(0, 5), 1)
  assert.equal(clampPage(-10, 5), 1)
  assert.equal(clampPage(3, 5), 3)
  assert.equal(clampPage(5, 5), 5)
  assert.equal(clampPage(10, 5), 5)
  assert.equal(clampPage('3', 5), 3)
  assert.equal(clampPage(NaN, 5), 1)
})

test('getPaginationPages handles edge cases and small total pages', () => {
  assert.deepEqual(getPaginationPages(1, 0), [])
  assert.deepEqual(getPaginationPages(1, -5), [])
  assert.deepEqual(getPaginationPages(1, 1), [1])
  assert.deepEqual(getPaginationPages(1, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(getPaginationPages(3, 7), [1, 2, 3, 4, 5, 6, 7])
})

test('getPaginationPages mirrors Google sliding window and matches reference design', () => {
  // Near start: matches Challenge #085 Row 1: < 1 2 3 [4] 5 ... 274 >
  assert.deepEqual(
    getPaginationPages(4, 274),
    [1, 2, 3, 4, 5, '...', 274],
  )
  assert.deepEqual(
    getPaginationPages(1, 274),
    [1, 2, 3, 4, 5, '...', 274],
  )

  // In the middle: matches Challenge #085 Row 2: < 1 ... 244 [245] 246 ... 274 >
  assert.deepEqual(
    getPaginationPages(245, 274),
    [1, '...', 244, 245, 246, '...', 274],
  )
  assert.deepEqual(
    getPaginationPages(10, 20),
    [1, '...', 9, 10, 11, '...', 20],
  )

  // Near the end: last 4 pages
  assert.deepEqual(
    getPaginationPages(271, 274),
    [1, '...', 270, 271, 272, 273, 274],
  )
  assert.deepEqual(
    getPaginationPages(274, 274),
    [1, '...', 270, 271, 272, 273, 274],
  )
})

test('paginateItems correctly slices arrays with clamping', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
  assert.deepEqual(paginateItems(items, 1, 5), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(paginateItems(items, 2, 5), ['f', 'g', 'h', 'i', 'j'])
  assert.deepEqual(paginateItems(items, 3, 5), ['k', 'l'])
  // Out of range page clamps to page 3
  assert.deepEqual(paginateItems(items, 99, 5), ['k', 'l'])
  // Empty or invalid
  assert.deepEqual(paginateItems(null, 1, 5), [])
  assert.deepEqual(paginateItems([], 1, 5), [])
})
