/**
 * Local persistence and ordering for pinned chat conversations.
 */

const STORAGE_PREFIX = 'iskai:pinned-sessions:'

export function pinnedStorageKey(userId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null
}

export function readPinnedIds(storage, userId) {
  const key = pinnedStorageKey(userId)
  if (!key || !storage) return []
  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    const result = []
    for (const item of parsed) {
      const id = String(item || '').trim()
      if (id && !seen.has(id)) {
        seen.add(id)
        result.push(id)
      }
    }
    return result
  } catch {
    return []
  }
}

export function writePinnedIds(storage, userId, ids) {
  const key = pinnedStorageKey(userId)
  if (!key || !storage) return
  try {
    storage.setItem(key, JSON.stringify(ids))
  } catch {
    // Ignore storage quota or private-mode failures.
  }
}

export function togglePinnedId(ids, sessionId) {
  const target = String(sessionId || '').trim()
  if (!target) return Array.isArray(ids) ? ids : []
  const list = Array.isArray(ids) ? ids : []
  return list.includes(target)
    ? list.filter((id) => id !== target)
    : [target, ...list]
}

export function removePinnedId(ids, sessionId) {
  const target = String(sessionId || '').trim()
  const list = Array.isArray(ids) ? ids : []
  return target ? list.filter((id) => id !== target) : list
}

export function orderSessionsByPin(sessions, pinnedIds) {
  const list = Array.isArray(sessions) ? sessions : []
  const pinnedSet = new Set((pinnedIds || []).map((id) => String(id)))
  if (pinnedSet.size === 0) return list
  const pinned = []
  const unpinned = []
  for (const session of list) {
    if (pinnedSet.has(String(session?.id))) pinned.push(session)
    else unpinned.push(session)
  }
  return [...pinned, ...unpinned]
}

/**
 * Anchor coordinates for a floating conversation-actions popover rendered in
 * `document.body` so sidebar overflow scrolling never clips it.
 */
export function computeSessionMenuPosition(triggerRect, viewport = { width: 1280, height: 800 }, menuHeight = 148, menuWidth = 176) {
  if (!triggerRect) return { top: 0, left: 0 }
  const margin = 8
  const spaceBelow = viewport.height - triggerRect.bottom - margin
  const openUpward = spaceBelow < menuHeight && triggerRect.top > menuHeight + margin
  const top = openUpward
    ? Math.max(margin, triggerRect.top - menuHeight - 6)
    : Math.min(viewport.height - menuHeight - margin, triggerRect.bottom + 6)
  const preferredLeft = triggerRect.right - 20
  const left = Math.max(margin, Math.min(preferredLeft, viewport.width - menuWidth - margin))
  return { top: Math.round(top), left: Math.round(left) }
}
