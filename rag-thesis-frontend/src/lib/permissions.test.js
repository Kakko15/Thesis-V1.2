import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_ROLE_FEATURES, canUseFeature } from './permissions.js'

test('administrators are never gated by the feature policy', () => {
  for (const role of ['admin', 'superadmin']) {
    for (const feature of ['chat', 'archive', 'novelty', 'upload']) {
      assert.equal(canUseFeature(role, {}, feature), true)
      assert.equal(canUseFeature(role, null, feature), true)
    }
  }
})

test('an unresolved policy falls back to the documented server defaults', () => {
  // The policy is fetched over the network. While it is null, denying every
  // feature made ProtectedRoute redirect students and faculty away from
  // /chat, /archive, /novelty, and /upload.
  assert.equal(canUseFeature('student', null, 'chat'), true)
  assert.equal(canUseFeature('student', null, 'archive'), true)
  assert.equal(canUseFeature('faculty', null, 'novelty'), true)
  assert.equal(canUseFeature('faculty', null, 'chat'), true)
  // The fallback must not widen access beyond the server defaults.
  assert.equal(canUseFeature('student', null, 'novelty'), false)
  assert.equal(canUseFeature('student', null, 'upload'), false)
  assert.equal(canUseFeature('faculty', null, 'upload'), false)
})

test('a real policy always wins over the defaults', () => {
  const policy = { student: { chat: false, archive: true, novelty: true, upload: true } }
  assert.equal(canUseFeature('student', policy, 'chat'), false)
  assert.equal(canUseFeature('student', policy, 'novelty'), true)
  assert.equal(canUseFeature('student', policy, 'upload'), true)
  // An empty policy grants nothing; it is a policy, not a missing one.
  assert.equal(canUseFeature('student', {}, 'chat'), false)
  assert.equal(canUseFeature('faculty', {}, 'novelty'), false)
})

test('unknown and absent roles are denied', () => {
  assert.equal(canUseFeature(null, null, 'chat'), false)
  assert.equal(canUseFeature('guest', null, 'chat'), false)
  assert.equal(canUseFeature('student', null, 'unknown_feature'), false)
})

test('the default policy is frozen against accidental mutation', () => {
  assert.throws(() => { DEFAULT_ROLE_FEATURES.student = {} }, TypeError)
  assert.throws(() => { DEFAULT_ROLE_FEATURES.student.upload = true }, TypeError)
  assert.equal(canUseFeature('student', null, 'upload'), false)
})
