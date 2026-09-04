import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('routine conversation remains a notice but does not show a warning chip', () => {
  assert.equal(
    messageNoticeLabel({ messageKind: 'notice', notice_type: 'conversation' }),
    null,
  )
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

test('the live append carries the API kind under messageKind', () => {
  /* Chat.jsx spreads the response and then overwrites `kind` with the local
   * 'user' | 'ai' role, so the API's answer/notice classification only reaches
   * messageNoticeLabel if it is copied under messageKind — the same name the
   * loadSession restore path uses. Without it, a live capacity apology or
   * refusal renders exactly like a research answer until the page reloads. */
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  assert.match(
    chat, /\.\.\.res, kind: 'ai', messageKind: res\.kind/,
    'Chat.jsx no longer carries the live response kind under messageKind',
  )
})

test('the restored transcript carries the notice presentation type', () => {
  const chat = readFileSync(new URL('../Chat.jsx', import.meta.url), 'utf8')
  assert.match(chat, /notice_type: m\.notice_type/)
})

test('a live notice response labels as a system message', () => {
  assert.equal(
    messageNoticeLabel({ messageKind: 'notice', no_relevant_thesis: false }),
    SYSTEM_NOTICE_LABEL,
  )
})
