const STORAGE_KEY = 'isu-thesis-chat-prefs-v1'

const DEFAULTS = {
  defaultCategory: '',
  sendKey: 'enter', // 'enter' | 'ctrlEnter'
}

const VALID_CATEGORIES = new Set(['', 'student', 'faculty'])
const VALID_SEND_KEYS = new Set(['enter', 'ctrlEnter'])

export function normalizeChatPrefs(stored = {}) {
  return {
    defaultCategory: VALID_CATEGORIES.has(stored.defaultCategory)
      ? stored.defaultCategory
      : DEFAULTS.defaultCategory,
    sendKey: VALID_SEND_KEYS.has(stored.sendKey) ? stored.sendKey : DEFAULTS.sendKey,
  }
}

export function getChatPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return normalizeChatPrefs(stored)
  } catch {
    return DEFAULTS
  }
}

export function setChatPref(key, value) {
  const next = normalizeChatPrefs({ ...getChatPrefs(), [key]: value })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Keep the current interaction usable when browser storage is unavailable.
  }
  return next
}
