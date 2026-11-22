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

test('only admin and superadmin bypass the feature policy wait', async () => {
  const { bypassesFeaturePolicy } = await import('./permissions.js')
  assert.equal(bypassesFeaturePolicy('admin'), true)
  assert.equal(bypassesFeaturePolicy('superadmin'), true)
  for (const role of ['student', 'faculty', null, undefined, 'guest']) {
    assert.equal(bypassesFeaturePolicy(role), false)
  }
})

test('settleWithin reports a policy that arrived in time', async () => {
  const { settleWithin } = await import('./permissions.js')
  assert.equal(await settleWithin(Promise.resolve({}), 1000), true)
  // A failed fetch has also settled: the null-policy fallback then applies.
  assert.equal(await settleWithin(Promise.reject(new Error('down')), 1000), true)
})

test('settleWithin stops waiting at the bound instead of hanging the route', async () => {
  const { settleWithin, FEATURE_POLICY_WAIT_MS } = await import('./permissions.js')
  let fire
  const fakeSetTimer = (callback) => { fire = callback; return 1 }
  const pending = settleWithin(new Promise(() => {}), FEATURE_POLICY_WAIT_MS, fakeSetTimer, () => {})
  fire()
  assert.equal(await pending, false)
  assert.ok(FEATURE_POLICY_WAIT_MS <= 5000)
})
