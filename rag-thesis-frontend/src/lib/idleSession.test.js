import test from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import {
  ABSOLUTE_SESSION_MS,
  formatCountdown,
  IDLE_LIMIT_MS,
  idleLimitForRole,
  LOGIN_NEXT_PARAM,
  loginPathWithNext,
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

test('loginPathWithNext carries a destination worth returning to', () => {
  assert.equal(loginPathWithNext('/chat'), '/login?next=%2Fchat')
  assert.equal(
    loginPathWithNext('/settings?section=security'),
    '/login?next=%2Fsettings%3Fsection%3Dsecurity',
  )
  // Round-trips through the reader, which is the pairing that was broken.
  const round = (here) => safeNextPath(
    new URLSearchParams(loginPathWithNext(here).split('?')[1]).get(LOGIN_NEXT_PARAM),
  )
  assert.equal(round('/archive?q=ocr'), '/archive?q=ocr')
})

test('loginPathWithNext omits destinations that are pointless or loop', () => {
  assert.equal(loginPathWithNext('/'), '/login') // landing: nothing to restore
  assert.equal(loginPathWithNext('/login'), '/login')
  assert.equal(loginPathWithNext('/login?next=%2Fchat'), '/login')
  assert.equal(loginPathWithNext('//evil.example/phish'), '/login')
  assert.equal(loginPathWithNext('https://evil.example/phish'), '/login')
  assert.equal(loginPathWithNext(''), '/login')
  assert.equal(loginPathWithNext(null), '/login')
  assert.equal(loginPathWithNext(undefined), '/login')
  assert.equal(loginPathWithNext(42), '/login')
})

test('both writers and the reader of the destination go through this module', () => {
  // The 401 handler spelled the parameter `returnTo` while Login read `next`,
  // so an expired session dropped the destination and landed on /dashboard.
  // Requiring the import is what keeps the three from drifting again; scanning
  // for the literal cannot, since the prose around it says the key's name.
  const senders = [
    ['../api.js', 'loginPathWithNext'],
    ['../components/IdleSessionGuard.jsx', 'loginPathWithNext'],
    ['../pages/Login.jsx', 'LOGIN_NEXT_PARAM'],
  ]
  for (const [sender, symbol] of senders) {
    const source = readFileSync(new URL(sender, import.meta.url), 'utf8')
    const imports = [...source.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g)]
      .filter(([, , from]) => from.endsWith('idleSession'))
      .flatMap(([, named]) => named.split(',').map((name) => name.trim()))
    assert.ok(
      imports.includes(symbol),
      `${sender} does not import ${symbol} from idleSession`,
    )
    assert.doesNotMatch(source, /returnTo/, `${sender} still names returnTo`)
  }
  assert.equal(LOGIN_NEXT_PARAM, 'next')
})

test('formatCountdown renders m:ss and never goes negative', () => {
  assert.equal(formatCountdown(60_000), '1:00')
  assert.equal(formatCountdown(65_000), '1:05')
  assert.equal(formatCountdown(5_000), '0:05')
  assert.equal(formatCountdown(500), '0:01') // sub-second rounds up, not to 0:00
  assert.equal(formatCountdown(0), '0:00')
  assert.equal(formatCountdown(-10_000), '0:00')
})
