import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeSessionMenuPosition,
  orderSessionsByPin,
  pinnedStorageKey,
  readPinnedIds,
  removePinnedId,
  togglePinnedId,
  writePinnedIds,
} from './pinnedSessions.js'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  }
}

test('pinnedStorageKey scopes storage per user id', () => {
  assert.equal(pinnedStorageKey('user-1'), 'iskai:pinned-sessions:user-1')
  assert.equal(pinnedStorageKey(''), null)
  assert.equal(pinnedStorageKey(null), null)
})

test('readPinnedIds and writePinnedIds round-trip unique IDs and tolerate corrupt storage', () => {
  const storage = memoryStorage()
  assert.deepEqual(readPinnedIds(storage, 'user-1'), [])
  assert.deepEqual(readPinnedIds(null, 'user-1'), [])
  assert.deepEqual(readPinnedIds(storage, ''), [])

  writePinnedIds(storage, 'user-1', ['s1', 's2'])
  assert.deepEqual(readPinnedIds(storage, 'user-1'), ['s1', 's2'])

  storage.setItem('iskai:pinned-sessions:user-1', '{bad-json')
  assert.deepEqual(readPinnedIds(storage, 'user-1'), [])

  storage.setItem('iskai:pinned-sessions:user-1', JSON.stringify(['s1', '', 's1', 's2', null]))
  assert.deepEqual(readPinnedIds(storage, 'user-1'), ['s1', 's2'])

  storage.setItem('iskai:pinned-sessions:user-1', JSON.stringify({ not: 'an-array' }))
  assert.deepEqual(readPinnedIds(storage, 'user-1'), [])

  const throwingStorage = {
    getItem: () => '[]',
    setItem: () => { throw new Error('QuotaExceededError') },
  }
  assert.doesNotThrow(() => writePinnedIds(throwingStorage, 'user-1', ['s1']))
  assert.doesNotThrow(() => writePinnedIds(storage, '', ['s1']))
})

test('togglePinnedId and removePinnedId update pinned session IDs cleanly', () => {
  assert.deepEqual(togglePinnedId([], 's1'), ['s1'])
  assert.deepEqual(togglePinnedId(['s1'], 's2'), ['s2', 's1'])
  assert.deepEqual(togglePinnedId(['s2', 's1'], 's1'), ['s2'])
  assert.deepEqual(togglePinnedId(null, ''), [])

  assert.deepEqual(removePinnedId(['s1', 's2'], 's1'), ['s2'])
  assert.deepEqual(removePinnedId(['s1'], ''), ['s1'])
  assert.deepEqual(removePinnedId(null, 's1'), [])
})

test('orderSessionsByPin floats pinned sessions first while preserving order', () => {
  const sessions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual(orderSessionsByPin(sessions, []), sessions)
  assert.deepEqual(
    orderSessionsByPin(sessions, ['c', 'a']).map((s) => s.id),
    ['a', 'c', 'b', 'd'],
  )
  assert.deepEqual(orderSessionsByPin(null, ['a']), [])
})

test('computeSessionMenuPosition anchors near trigger and flips upward near bottom', () => {
  assert.deepEqual(computeSessionMenuPosition(null), { top: 0, left: 0 })

  const topPos = computeSessionMenuPosition(
    { top: 100, bottom: 128, left: 260, right: 288 },
    { width: 1280, height: 800 },
  )
  assert.equal(topPos.top, 134)
  assert.equal(topPos.left, 268)

  const flippedPos = computeSessionMenuPosition(
    { top: 720, bottom: 748, left: 1180, right: 1208 },
    { width: 1280, height: 800 },
    148,
    176,
  )
  assert.equal(flippedPos.top, 566)
  assert.equal(flippedPos.left, 1096)
})
