import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeChatPrefs, setChatPref } from './chatPrefs.js'

test('chat preferences reject stale or malformed persisted values', () => {
  assert.deepEqual(normalizeChatPrefs({ defaultCategory: 'private', sendKey: 'space' }), {
    defaultCategory: '',
    sendKey: 'enter',
  })
  assert.deepEqual(normalizeChatPrefs({ defaultCategory: 'faculty', sendKey: 'ctrlEnter' }), {
    defaultCategory: 'faculty',
    sendKey: 'ctrlEnter',
  })
})

test('chat preference updates survive unavailable local storage', () => {
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('storage disabled') },
  }
  try {
    assert.deepEqual(setChatPref('sendKey', 'ctrlEnter'), {
      defaultCategory: '',
      sendKey: 'ctrlEnter',
    })
  } finally {
    globalThis.localStorage = previous
  }
})
