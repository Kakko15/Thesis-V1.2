import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ABSOLUTE_SESSION_MS,
  formatCountdown,
  IDLE_LIMIT_MS,
  idleLimitForRole,
  safeNextPath,
} from './idleSession.js'

test('privileged roles idle out faster than standard roles', () => {
  assert.equal(idleLimitForRole(true), IDLE_LIMIT_MS.privileged)
  assert.equal(idleLimitForRole(false), IDLE_LIMIT_MS.standard)
  assert.equal(IDLE_LIMIT_MS.privileged, 15 * 60_000)
  assert.equal(IDLE_LIMIT_MS.standard, 30 * 60_000)
  assert.ok(IDLE_LIMIT_MS.privileged < IDLE_LIMIT_MS.standard)
})

test('absolute session cap is 12 hours and outlives every idle limit', () => {
  assert.equal(ABSOLUTE_SESSION_MS, 12 * 60 * 60_000)
  assert.ok(ABSOLUTE_SESSION_MS > IDLE_LIMIT_MS.standard)
})

test('safeNextPath keeps only same-origin app paths', () => {
  assert.equal(safeNextPath('/chat'), '/chat')
  assert.equal(safeNextPath('/settings?section=security'), '/settings?section=security')
  assert.equal(safeNextPath('https://evil.example/phish'), '/dashboard')
  assert.equal(safeNextPath('//evil.example/phish'), '/dashboard')
  assert.equal(safeNextPath(''), '/dashboard')
  assert.equal(safeNextPath(null), '/dashboard')
  assert.equal(safeNextPath(undefined), '/dashboard')
  assert.equal(safeNextPath(42), '/dashboard')
  assert.equal(safeNextPath('/chat', '/fallback'), '/chat')
})

test('formatCountdown renders m:ss and never goes negative', () => {
  assert.equal(formatCountdown(60_000), '1:00')
  assert.equal(formatCountdown(65_000), '1:05')
  assert.equal(formatCountdown(5_000), '0:05')
  assert.equal(formatCountdown(500), '0:01') // sub-second rounds up, not to 0:00
  assert.equal(formatCountdown(0), '0:00')
  assert.equal(formatCountdown(-10_000), '0:00')
})
