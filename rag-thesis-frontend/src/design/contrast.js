/**
 * WCAG 2.x relative luminance and contrast ratio.
 *
 * Kept separate from the theme generator so the accessibility contract can be
 * asserted in unit tests without importing the Material package, whose bundled
 * entry point does not resolve under bare Node ESM.
 */

const channel = (value) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Parse `#rrggbb` (case-insensitive) into 0-255 channels. */
export function rgbFromHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new TypeError(`Not a six-digit hex colour: ${hex}`)
  const int = Number.parseInt(match[1], 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

export function relativeLuminance(hex) {
  const [r, g, b] = rgbFromHex(hex).map(channel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Composite a translucent colour over an opaque one. CSS blends in gamma-encoded
 * sRGB, so this deliberately interpolates the raw channels rather than the
 * linearised ones.
 */
export function blend(foreground, alpha, background) {
  const f = rgbFromHex(foreground)
  const b = rgbFromHex(background)
  const hex = f
    .map((value, i) => Math.round(value * alpha + b[i] * (1 - alpha)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}
