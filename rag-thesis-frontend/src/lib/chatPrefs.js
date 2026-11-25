/**
 * Ask IskAI preferences, stored per account in this browser.
 *
 * These used to live under one browser-wide key, so whatever the last person
 * chose followed every account and guest that later used the same browser.
 * Measured 2026-11-25 in user testing: a student set the default category to
 * "Faculty Research" (which held no theses), and the faculty, admin and
 * superadmin accounts signed in afterwards all inherited it, so every chat
 * answered "No relevant thesis was found". On a shared lab PC that silently
 * breaks chat for the next user.
 *
 * Preferences are now keyed by user id. Guests cannot open Settings, so they
 * always get the defaults. The old shared key is discarded rather than copied
 * to whoever signs in next, because its owner is unknown.
 */

export const LEGACY_STORAGE_KEY = 'isu-thesis-chat-prefs-v1'
const STORAGE_PREFIX = 'isu-thesis-chat-prefs-v2:'

export const DEFAULT_CHAT_PREFS = Object.freeze({
  defaultCategory: '',
  sendKey: 'enter', // 'enter' | 'ctrlEnter'
})

export function chatPrefsStorageKey(userId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null
}

function storage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function dropLegacyPrefs(store) {
  try {
    store.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Storage may be unavailable (private mode); nothing to clean up then.
  }
}

export function getChatPrefs(userId) {
  const key = chatPrefsStorageKey(userId)
  const store = storage()
  if (!key || !store) return { ...DEFAULT_CHAT_PREFS }
  dropLegacyPrefs(store)
  try {
    const stored = JSON.parse(store.getItem(key) || '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT_CHAT_PREFS }
    return { ...DEFAULT_CHAT_PREFS, ...stored }
  } catch {
    return { ...DEFAULT_CHAT_PREFS }
  }
}

export function setChatPref(userId, key, value) {
  const next = { ...getChatPrefs(userId), [key]: value }
  const storageKey = chatPrefsStorageKey(userId)
  const store = storage()
  if (storageKey && store) {
    try {
      store.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Quota or private mode: the choice still applies for this page view.
    }
  }
  return next
}
