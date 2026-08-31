import test from 'node:test'
import assert from 'node:assert/strict'
import {
  messageNoticeLabel,
  NO_EVIDENCE_LABEL,
  SYSTEM_NOTICE_LABEL,
} from './messageNotice.js'

test('a grounded answer gets no chip', () => {
  assert.equal(messageNoticeLabel({ answer: 'Grounded [1].', sources: [{ id: 'p1' }] }), null)
})

test('the live no-evidence flag reports the specific result', () => {
  assert.equal(messageNoticeLabel({ no_relevant_thesis: true }), NO_EVIDENCE_LABEL)
})

test('a restored notice row is recognised from the API kind', () => {
  // Finding 9: loadSession discarded this, so a reloaded capacity apology
  // looked exactly like a real answer.
  assert.equal(messageNoticeLabel({ messageKind: 'notice' }), SYSTEM_NOTICE_LABEL)
})

test('a restored answer row is left alone', () => {
  assert.equal(messageNoticeLabel({ messageKind: 'answer' }), null)
})

test('the specific label wins when both signals are present', () => {
  assert.equal(
    messageNoticeLabel({ no_relevant_thesis: true, messageKind: 'notice' }),
    NO_EVIDENCE_LABEL,
  )
})

test('a restored notice does not claim the archive was searched and empty', () => {
  // `notice` also covers refusals, the capacity apology and the guest
  // allowance message, none of which are "no qualifying evidence".
  assert.notEqual(messageNoticeLabel({ messageKind: 'notice' }), NO_EVIDENCE_LABEL)
})

test('missing or partial messages do not throw', () => {
  assert.equal(messageNoticeLabel(undefined), null)
  assert.equal(messageNoticeLabel(null), null)
  assert.equal(messageNoticeLabel({}), null)
})
