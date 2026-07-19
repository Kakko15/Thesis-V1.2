import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso) {
  if (!iso) return ''
  try {
    const value = new Date(iso)
    if (Number.isNaN(value.getTime())) return ''
    return value.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function timeAgo(iso) {
  if (!iso) return ''
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

export function normalizePercent(value) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) return 0
  const percent = number > 0 && number <= 1 ? number * 100 : number
  return Math.min(100, Math.max(0, percent))
}

export function scanMetrics(scan = {}) {
  const record = scan && typeof scan === 'object' && !Array.isArray(scan) ? scan : {}
  const matchedChunks = Math.max(0, Number(record.matched_chunk_count ?? 0) || 0)
  const totalChunks = Math.max(0, Number(record.total_chunks ?? 0) || 0)
  return {
    highest: normalizePercent(record.highest_similarity),
    coverage: normalizePercent(record.matched_chunk_percentage ?? record.duplication_percentage),
    matchedChunks,
    totalChunks,
    verdict: record.verdict_level || (matchedChunks === 0 ? 'clear' : 'review_suggested'),
  }
}

export function verdictLabel(level) {
  if (level === 'high_overlap') return 'High overlap—faculty review required'
  if (level === 'review_suggested') return 'Review suggested'
  return 'Clear'
}

export function extractOwnedAvatarPath(publicUrl, userId) {
  if (!publicUrl || !userId) return null
  if (!publicUrl.includes('://')) {
    return publicUrl.startsWith(`${userId}/`) ? publicUrl : null
  }
  try {
    const pathname = decodeURIComponent(new URL(publicUrl).pathname)
    const marker = '/storage/v1/object/public/avatars/'
    const path = pathname.includes(marker) ? pathname.split(marker)[1] : ''
    return path.startsWith(`${userId}/`) ? path : null
  } catch {
    return null
  }
}
