const STORAGE_KEY = 'isu-thesis-chat-prefs-v1'

const DEFAULTS = {
  defaultCategory: '',
  sendKey: 'enter', // 'enter' | 'ctrlEnter'
}

export function getChatPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULTS, ...stored }
  } catch {
    return DEFAULTS
  }
}

export function setChatPref(key, value) {
  const next = { ...getChatPrefs(), [key]: value }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
