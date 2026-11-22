import assert from 'node:assert/strict'
import test from 'node:test'
import { isPublicUnauthenticatedRequest, waitUntilReady } from './backendReadiness.js'

function fakeClock() {
  let time = 0
  return {
    now: () => time,
    sleep: async (ms) => { time += ms },
    advance: (ms) => { time += ms },
  }
}

test('resolves as soon as the probe reports ready', async () => {
  const clock = fakeClock()
  let calls = 0
  await waitUntilReady({
    probe: async () => { calls += 1; return calls === 3 },
    timeoutMs: 10_000, pollMs: 350, now: clock.now, sleep: clock.sleep,
  })
  assert.equal(calls, 3)
  assert.equal(clock.now(), 700)
})

test('treats a failing probe as not ready and keeps polling', async () => {
  const clock = fakeClock()
  let calls = 0
  await waitUntilReady({
    probe: async () => { calls += 1; if (calls < 2) throw new Error('vite reloading'); return true },
    timeoutMs: 10_000, pollMs: 350, now: clock.now, sleep: clock.sleep,
  })
  assert.equal(calls, 2)
})

test('gives up at the deadline and the message names that same window', async () => {
  const clock = fakeClock()
  await assert.rejects(
    waitUntilReady({
      // Each probe itself takes 4.5 s, like a timed-out cold Vite probe.
      probe: async () => { clock.advance(4500); return false },
      timeoutMs: 30_000, pollMs: 350, now: clock.now, sleep: clock.sleep,
    }),
    /within 30 seconds/,
  )
  // Bounded by elapsed time, not by an attempt count: never far past 30 s.
  assert.ok(clock.now() <= 30_000 + 4500, `waited ${clock.now()} ms`)
})

test('only /health skips session and guest headers', () => {
  assert.equal(isPublicUnauthenticatedRequest({ url: '/health' }), true)
  assert.equal(isPublicUnauthenticatedRequest({ url: '/health?x=1' }), true)
  assert.equal(isPublicUnauthenticatedRequest({ url: '/health/worker' }), false)
  assert.equal(isPublicUnauthenticatedRequest({ url: '/settings/features' }), false)
  assert.equal(isPublicUnauthenticatedRequest({}), false)
})
