import test from 'node:test'
import assert from 'node:assert/strict'

import {
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
  assert.match(friendlyAuthError({ message: 'Invalid login credentials' }), /Incorrect email/)
  assert.equal(retryAfterSeconds({ message: 'Try again after 42 seconds' }), 42)
})
