import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'

import {
  authOptions,
  friendlyAuthError,
  isRateLimitError,
  isStrongPassword,
  isValidEmail,
  maskEmail,
  passwordStrength,
  retryAfterSeconds,
  shouldSubmitAuthFormOnEnter,
  useResendTimer,
} from './authUtils.js'

test('validates email and masks it without exposing the full local part', () => {
  assert.equal(isValidEmail('student@isu.edu.ph'), true)
  assert.equal(isValidEmail('not-an-email'), false)
  assert.equal(maskEmail('student@isu.edu.ph'), 'st•••@isu.edu.ph')
})

test('email helpers tolerate absent values and short or domainless addresses', () => {
  assert.equal(isValidEmail(undefined), false)
  assert.equal(isValidEmail('  student@isu.edu.ph  '), true)
  assert.equal(maskEmail('k@isu.edu.ph'), 'k•••@isu.edu.ph')
  assert.equal(maskEmail('no-domain'), 'no-domain')
  assert.equal(maskEmail(null), null)
  assert.equal(maskEmail(''), '')
})

test('requires all displayed production password rules', () => {
  assert.equal(isStrongPassword('Strong1!'), true)
  assert.equal(isStrongPassword('weakpass'), false)
  assert.equal(passwordStrength('Strong1!'), 4)
})

test('password checks treat a missing password as failing every rule', () => {
  assert.equal(isStrongPassword(undefined), false)
  assert.equal(isStrongPassword(null), false)
  assert.equal(passwordStrength(''), 0)
  assert.equal(passwordStrength('lowercase'), 1)
})

test('maps common auth failures and parses retry timing', () => {
  const cases = [
    ['Invalid login credentials', /Incorrect email/],
    ['Email not confirmed', /verified/],
    ['User already registered', /could not be completed/],
    ['Signups not allowed for otp', /could not be sent/],
    ['Invalid TOTP', /code didn’t match/],
    ['OTP_expired', /expired/],
    ['Too many requests; retry after 42 seconds', /Too many authentication attempts/],
    ['Captcha verification failed', /security check expired or failed/i],
    ['Captcha verification process failed', /security is misconfigured/i],
    ['New password should be at least 8 characters', /at least 8 characters/],
    ['New password must be different from the old password', /different from the old/],
    ['Auth session missing', /link has expired/],
    ['Failed to fetch', /Network hiccup/],
    [{}, /could not complete account creation/],
    ['Unknown provider failure', /Authentication failed/],
  ]
  for (const [message, expected] of cases) assert.match(friendlyAuthError({ message }), expected)
  assert.equal(retryAfterSeconds({ message: 'Try again after 42 seconds' }), 42)
})

test('friendly auth errors read every Supabase error shape', () => {
  assert.equal(friendlyAuthError(null), 'Something went wrong.')
  assert.equal(friendlyAuthError(undefined), 'Something went wrong.')
  assert.match(friendlyAuthError({ error_description: 'Email not confirmed' }), /verified/)
  assert.match(friendlyAuthError({ msg: 'Invalid login credentials' }), /Incorrect email/)
  // A bare string error is used as the message itself.
  assert.match(friendlyAuthError('Failed to fetch'), /Network hiccup/)
  // Non-string payloads are serialised before matching.
  assert.match(friendlyAuthError({ message: { code: 'otp_expired' } }), /code has expired/)
})

test('friendly auth errors survive payloads that cannot be serialised', () => {
  const circular = {}
  circular.self = circular
  assert.equal(friendlyAuthError({ message: circular }), 'Authentication failed. Please try again.')
  // BigInt makes JSON.stringify throw; String() still yields readable text.
  assert.equal(friendlyAuthError({ message: 42n }), 'Authentication failed. Please try again.')
})

test('detects Supabase throttling from message or error_description', () => {
  assert.equal(isRateLimitError({ message: 'Email rate limit exceeded' }), true)
  assert.equal(isRateLimitError({ error_description: 'Too Many Requests' }), true)
  assert.equal(
    isRateLimitError({ message: 'For security purposes, you can only request this after 37 seconds.' }),
    true,
  )
  assert.equal(isRateLimitError({ message: 'Invalid login credentials' }), false)
  assert.equal(isRateLimitError({}), false)
  assert.equal(isRateLimitError(null), false)
  assert.equal(isRateLimitError(undefined), false)
})

test('retry timing falls back to zero when no wait is reported', () => {
  assert.equal(retryAfterSeconds({ message: 'Try again after 1 second' }), 1)
  assert.equal(retryAfterSeconds({ message: 'Too many requests' }), 0)
  assert.equal(retryAfterSeconds({}), 0)
  assert.equal(retryAfterSeconds(null), 0)
})

test('passes CAPTCHA tokens only when a challenge supplied one', () => {
  assert.deepEqual(authOptions({ shouldCreateUser: false }, 'token-123'), {
    shouldCreateUser: false,
    captchaToken: 'token-123',
  })
  assert.deepEqual(authOptions({ shouldCreateUser: false }), { shouldCreateUser: false })
  assert.deepEqual(authOptions(), {})
  assert.deepEqual(authOptions(undefined, 'token-456'), { captchaToken: 'token-456' })
})

/* useResendTimer ---------------------------------------------------------- */

function TimerProbe({ initial }) {
  // Spread so an omitted prop exercises the hook's own default.
  const [seconds] = useResendTimer(...(initial === undefined ? [] : [initial]))
  return React.createElement('span', null, `cooldown:${seconds}`)
}

test('useResendTimer starts from the requested cooldown under the real React renderer', () => {
  assert.equal(renderToString(React.createElement(TimerProbe, { initial: 60 })), '<span>cooldown:60</span>')
  assert.equal(renderToString(React.createElement(TimerProbe, {})), '<span>cooldown:0</span>')
})

/**
 * Minimal hook host. There is no DOM in this test runner, so react-dom cannot
 * commit effects; instead this installs a tiny dispatcher implementing the two
 * hooks useResendTimer uses (useState with stable setters, useEffect with
 * dependency comparison and cleanup) and re-renders on every state update.
 */
function renderHook(hook) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const states = []
  const setters = []
  const effects = []
  let result
  let renders = 0

  const render = () => {
    let stateIndex = 0
    let effectIndex = 0
    const dispatcher = {
      useState(initial) {
        const index = stateIndex++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        setters[index] ||= (next) => {
          states[index] = typeof next === 'function' ? next(states[index]) : next
          render()
        }
        return [states[index], setters[index]]
      },
      useEffect(create, deps) {
        const index = effectIndex++
        const previous = effects[index]
        if (previous && previous.deps.every((dep, i) => Object.is(dep, deps[i]))) return
        previous?.cleanup?.()
        effects[index] = { deps, cleanup: create() }
      },
    }
    const saved = internals.H
    internals.H = dispatcher
    try {
      result = hook()
    } finally {
      internals.H = saved
    }
    renders++
  }

  render()
  return {
    get current() { return result },
    get renders() { return renders },
    unmount() { for (const effect of effects) effect?.cleanup?.() },
  }
}

test('useResendTimer counts down once per second and stops at zero', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const timer = renderHook(() => useResendTimer(3))
  assert.equal(timer.current[0], 3)

  t.mock.timers.tick(999)
  assert.equal(timer.current[0], 3, 'no tick before a full second has elapsed')
  t.mock.timers.tick(1)
  assert.equal(timer.current[0], 2)
  t.mock.timers.tick(1000)
  assert.equal(timer.current[0], 1)
  t.mock.timers.tick(1000)
  assert.equal(timer.current[0], 0)

  const rendersAtZero = timer.renders
  t.mock.timers.tick(5000)
  assert.equal(timer.current[0], 0, 'the countdown never goes negative')
  assert.equal(timer.renders, rendersAtZero, 'no timer is scheduled once the cooldown is over')
})

test('useResendTimer does not schedule anything for a zero or negative cooldown', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const idle = renderHook(() => useResendTimer())
  const negative = renderHook(() => useResendTimer(-5))
  t.mock.timers.tick(3000)
  assert.equal(idle.current[0], 0)
  assert.equal(negative.current[0], -5)
  assert.equal(idle.renders, 1)
  assert.equal(negative.renders, 1)
})

test('useResendTimer restarts when the setter is used and stops when unmounted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const timer = renderHook(() => useResendTimer(0))
  const [, setCooldown] = timer.current

  setCooldown(2)
  assert.equal(timer.current[0], 2)
  t.mock.timers.tick(1000)
  assert.equal(timer.current[0], 1)

  // Unmounting clears the pending timeout, so the state is never touched again.
  timer.unmount()
  t.mock.timers.tick(5000)
  assert.equal(timer.current[0], 1)
})

/* shouldSubmitAuthFormOnEnter --------------------------------------------- */

function makeForm({ openOverlay = false } = {}) {
  return {
    ownerDocument: {
      querySelector: () => (openOverlay ? {} : null),
    },
  }
}

function makeTarget({ interactive = false, ownerForm = null } = {}) {
  return {
    closest(selector) {
      if (selector === 'form') return ownerForm
      return interactive ? {} : null
    },
  }
}

test('shouldSubmitAuthFormOnEnter allows plain Enter from the form or page body', () => {
  const form = makeForm()
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', target: makeTarget({ ownerForm: form }) }, form), true)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', target: makeTarget() }, form), true)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', target: null }, form), true)
})

test('shouldSubmitAuthFormOnEnter ignores non-Enter, modified, composing, or prevented keys', () => {
  const form = makeForm()
  assert.equal(shouldSubmitAuthFormOnEnter(null, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter' }, null), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Escape' }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', defaultPrevented: true }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', isComposing: true }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', repeat: true }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', shiftKey: true }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', ctrlKey: true }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', metaKey: true }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', altKey: true }, form), false)
})

test('shouldSubmitAuthFormOnEnter does not hijack interactive controls, other forms, or open overlays', () => {
  const form = makeForm()
  const otherForm = makeForm()
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', target: makeTarget({ interactive: true }) }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', target: makeTarget({ ownerForm: otherForm }) }, form), false)
  assert.equal(shouldSubmitAuthFormOnEnter({ key: 'Enter', target: makeTarget() }, makeForm({ openOverlay: true })), false)
})
