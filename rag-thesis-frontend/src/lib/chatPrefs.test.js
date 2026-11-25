import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CHAT_PREFS, LEGACY_STORAGE_KEY, chatPrefsStorageKey, getChatPrefs, setChatPref,
} from './chatPrefs.js'

function memoryStorage() {
  const data = new Map()
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  }
}

let originalDescriptor
beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true })
})
afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
  else delete globalThis.localStorage
})

test('one account’s preference does not reach another account', () => {
  setChatPref('student-1', 'defaultCategory', 'faculty')
  assert.equal(getChatPrefs('student-1').defaultCategory, 'faculty')
  assert.equal(getChatPrefs('faculty-2').defaultCategory, '')
})

test('guests always get the defaults and cannot store anything', () => {
  setChatPref('student-1', 'defaultCategory', 'faculty')
  assert.deepEqual(getChatPrefs(null), DEFAULT_CHAT_PREFS)
  assert.equal(setChatPref(null, 'defaultCategory', 'student').defaultCategory, 'student')
  assert.deepEqual(getChatPrefs(undefined), DEFAULT_CHAT_PREFS)
  assert.equal(chatPrefsStorageKey(null), null)
})

test('the old browser-wide key is discarded, not inherited', () => {
  globalThis.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ defaultCategory: 'faculty' }))
  assert.equal(getChatPrefs('admin-3').defaultCategory, '')
  assert.equal(globalThis.localStorage.getItem(LEGACY_STORAGE_KEY), null)
})

test('stored values merge over the defaults', () => {
  setChatPref('u', 'sendKey', 'ctrlEnter')
  assert.deepEqual(getChatPrefs('u'), { defaultCategory: '', sendKey: 'ctrlEnter' })
  assert.equal(globalThis.localStorage.getItem(chatPrefsStorageKey('u')), JSON.stringify({ defaultCategory: '', sendKey: 'ctrlEnter' }))
})

test('corrupt or non-object stored values fall back to the defaults', () => {
  globalThis.localStorage.setItem(chatPrefsStorageKey('u'), '{not json')
  assert.deepEqual(getChatPrefs('u'), DEFAULT_CHAT_PREFS)
  globalThis.localStorage.setItem(chatPrefsStorageKey('u'), '[1,2]')
  assert.deepEqual(getChatPrefs('u'), DEFAULT_CHAT_PREFS)
  globalThis.localStorage.setItem(chatPrefsStorageKey('u'), 'null')
  assert.deepEqual(getChatPrefs('u'), DEFAULT_CHAT_PREFS)
})

test('unavailable or failing storage never throws', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('denied') },
  })
  assert.deepEqual(getChatPrefs('u'), DEFAULT_CHAT_PREFS)
  assert.equal(setChatPref('u', 'sendKey', 'ctrlEnter').sendKey, 'ctrlEnter')

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    },
  })
  assert.deepEqual(getChatPrefs('u'), DEFAULT_CHAT_PREFS)
  assert.equal(setChatPref('u', 'defaultCategory', 'student').defaultCategory, 'student')
})
