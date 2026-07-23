import test from 'node:test'
import assert from 'node:assert/strict'

import {
  authOptions,
  friendlyAuthError,
  isStrongPassword,
  isValidEmail,
  maskEmail,
  passwordStrength,
  retryAfterSeconds,
} from './authUtils.js'

test('validates email and masks it without exposing the full local part', () => {
  assert.equal(isValidEmail('student@isu.edu.ph'), true)
  assert.equal(isValidEmail('not-an-email'), false)
  assert.equal(maskEmail('student@isu.edu.ph'), 'st•••@isu.edu.ph')
})

test('requires all displayed production password rules', () => {
  assert.equal(isStrongPassword('Strong1!'), true)
  assert.equal(isStrongPassword('weakpass'), false)
  assert.equal(passwordStrength('Strong1!'), 4)
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
    ['New password should be at least 8 characters', /at least 8 characters/],
    ['New password must be different from the old password', /different from the old/],
    ['Auth session missing', /link has expired/],
    ['Failed to fetch', /Network hiccup/],
    ['Unknown provider failure', /Authentication failed/],
  ]
  for (const [message, expected] of cases) assert.match(friendlyAuthError({ message }), expected)
  assert.equal(retryAfterSeconds({ message: 'Try again after 42 seconds' }), 42)
})

test('passes CAPTCHA tokens only when a challenge supplied one', () => {
  assert.deepEqual(authOptions({ shouldCreateUser: false }, 'token-123'), {
    shouldCreateUser: false,
    captchaToken: 'token-123',
  })
  assert.deepEqual(authOptions({ shouldCreateUser: false }), { shouldCreateUser: false })
})
