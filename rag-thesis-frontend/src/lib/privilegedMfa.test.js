import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isPrivilegedMfaRefusal, onPrivilegedMfaRequired, reportPrivilegedMfaRequired,
  resetPrivilegedMfaListeners, shouldPromptForPrivilegedMfa,
} from './privilegedMfa.js'

const refusal = (status, detail) => ({ response: { status, data: { detail } } })

// The exact sentence rag-thesis-backend/dependencies/auth.py raises, pinned
// there by test_the_mfa_refusal_is_worded_identically_by_every_privileged_guard.
const API_WORDING = 'Multi-factor authentication is required for privileged access.'

test('the API refusal for an aal1 privileged session is recognised', () => {
  assert.equal(isPrivilegedMfaRefusal(refusal(403, API_WORDING)), true)
})

test('recognition survives casing and an added clause', () => {
  assert.equal(isPrivilegedMfaRefusal(refusal(403, API_WORDING.toUpperCase())), true)
  assert.equal(
    isPrivilegedMfaRefusal(refusal(403, 'Multi-factor authentication is required for privileged access. Enroll in Settings.')),
    true,
  )
})

test('an ordinary privilege refusal is left alone', () => {
  // Offering a second factor here would send the reader after something that
  // cannot help: no authenticator makes a student an administrator.
  assert.equal(isPrivilegedMfaRefusal(refusal(403, 'Administrator privileges are required for this action.')), false)
  assert.equal(isPrivilegedMfaRefusal(refusal(403, 'Faculty or administrator privileges are required for this action.')), false)
  assert.equal(isPrivilegedMfaRefusal(refusal(403, 'This account is pending approval or has been rejected.')), false)
})

test('only a 403 counts, and a malformed failure never does', () => {
  assert.equal(isPrivilegedMfaRefusal(refusal(401, API_WORDING)), false)
  assert.equal(isPrivilegedMfaRefusal(refusal(500, API_WORDING)), false)
  assert.equal(isPrivilegedMfaRefusal(refusal(403, undefined)), false)
  assert.equal(isPrivilegedMfaRefusal(refusal(403, ['not', 'a', 'string'])), false)
  assert.equal(isPrivilegedMfaRefusal({ message: 'Network Error' }), false)
  assert.equal(isPrivilegedMfaRefusal(null), false)
})

test('every subscriber hears a refusal, and unsubscribing stops it', () => {
  resetPrivilegedMfaListeners()
  let first = 0
  let second = 0
  const off = onPrivilegedMfaRequired(() => { first += 1 })
  onPrivilegedMfaRequired(() => { second += 1 })

  reportPrivilegedMfaRequired()
  assert.deepEqual([first, second], [1, 1])

  off()
  reportPrivilegedMfaRequired()
  assert.deepEqual([first, second], [1, 2])
  resetPrivilegedMfaListeners()
})

test('one failing subscriber does not silence the others', () => {
  // Both the shell gate and the auth context listen; a render-time throw in
  // either must not leave the other believing the session is still usable.
  resetPrivilegedMfaListeners()
  let reached = false
  onPrivilegedMfaRequired(() => { throw new Error('subscriber exploded') })
  onPrivilegedMfaRequired(() => { reached = true })
  reportPrivilegedMfaRequired()
  assert.equal(reached, true)
  resetPrivilegedMfaListeners()
})

test('a subscriber that unsubscribes during the walk cannot disturb it', () => {
  resetPrivilegedMfaListeners()
  let tail = 0
  const off = onPrivilegedMfaRequired(() => off())
  onPrivilegedMfaRequired(() => { tail += 1 })
  reportPrivilegedMfaRequired()
  assert.equal(tail, 1)
  resetPrivilegedMfaListeners()
})

test('dismissing the prompt silences that refusal, not the next one', () => {
  // Closing it means "not now". Walking into the same wall again has to be
  // allowed to say so, or the reader is back to a UI that fails silently.
  assert.equal(shouldPromptForPrivilegedMfa({ refusals: 1, dismissedAt: 0 }), true)
  assert.equal(shouldPromptForPrivilegedMfa({ refusals: 1, dismissedAt: 1 }), false)
  assert.equal(shouldPromptForPrivilegedMfa({ refusals: 2, dismissedAt: 1 }), true)
})

test('no refusal, no prompt', () => {
  assert.equal(shouldPromptForPrivilegedMfa({ refusals: 0, dismissedAt: 0 }), false)
  assert.equal(shouldPromptForPrivilegedMfa(), false)
})

test('the prompt waits for the factor lookup and yields to enrolment', () => {
  // Which recovery applies — challenge or enrol — is unknown until the factor
  // list lands, and the enrolment dialog must not open behind its own prompt.
  assert.equal(shouldPromptForPrivilegedMfa({ refusals: 1, factorsLoading: true }), false)
  assert.equal(shouldPromptForPrivilegedMfa({ refusals: 1, enrolling: true }), false)
})
