import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { blend, contrastRatio } from './contrast.js'

const AA_NORMAL_TEXT = 4.5

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const badge = readFileSync(new URL('../components/ui/Badge.jsx', import.meta.url), 'utf8')

/** Read a `--color-*` value straight out of the stylesheet's @theme block. */
function themeColor(name) {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)
  assert.ok(match, `--color-${name} is not defined in index.css`)
  return match[1]
}

// The lightest and darkest surfaces a badge can be painted on. Light values are
// the card over surface-0 and the deepest light surface; dark values mirror them.
const LIGHT_SURFACES = ['#fbfdf7', '#e7e9e4']
const DARK_SURFACES = ['#111411', '#282b28']

/** Each badge tone as it is actually composed: tint at alpha over a surface. */
const TONES = [
  { tone: 'forest', tint: 'forest-600', alpha: 0.12, text: 'forest-900', surfaces: LIGHT_SURFACES },
  { tone: 'forest', tint: 'forest-400', alpha: 0.15, text: 'forest-200', surfaces: DARK_SURFACES },
  { tone: 'gold', tint: 'gold-400', alpha: 0.15, text: 'gold-text', surfaces: LIGHT_SURFACES },
  { tone: 'gold', tint: 'gold-400', alpha: 0.15, text: 'gold-200', surfaces: DARK_SURFACES },
  { tone: 'flame', tint: 'flame-500', alpha: 0.12, text: 'flame-800', surfaces: LIGHT_SURFACES },
  { tone: 'flame', tint: 'flame-500', alpha: 0.15, text: 'flame-200', surfaces: DARK_SURFACES },
]

test('every badge tone clears AA against the tint it is painted on', () => {
  for (const { tone, tint, alpha, text, surfaces } of TONES) {
    const foreground = themeColor(text)
    for (const surface of surfaces) {
      const background = blend(themeColor(tint), alpha, surface)
      const ratio = contrastRatio(foreground, background)
      assert.ok(
        ratio >= AA_NORMAL_TEXT,
        `${tone} badge: ${text} (${foreground}) on ${tint}/${alpha * 100} over ${surface} `
        + `= ${background} is ${ratio.toFixed(2)}:1`,
      )
    }
  }
})

test('badge tones use the verified foregrounds, not the same-family defaults', () => {
  // Scoped to the styles object: the surrounding comments name the old failing
  // colours on purpose, and matching those would defeat the check.
  const styles = /const styles = \{([\s\S]*?)\n\}/.exec(badge)
  assert.ok(styles, 'Badge.jsx no longer declares a styles map')

  // text-flame-600 (4.06:1) and text-gold-600 were the measured AA failures.
  assert.doesNotMatch(styles[1], /text-flame-600/)
  assert.doesNotMatch(styles[1], /text-gold-600/)
  // The neutral tone used opacity-80, whose result cannot be reasoned about
  // statically because it depends on whatever is painted behind the badge.
  assert.doesNotMatch(styles[1], /opacity-\d/)
})

test('the text-safe gold clears AA on every plain light surface', () => {
  const gold = themeColor('gold-text')
  for (const surface of [...LIGHT_SURFACES, '#f9faf5', '#fff8f0', '#eee7de']) {
    const ratio = contrastRatio(gold, surface)
    assert.ok(ratio >= AA_NORMAL_TEXT, `gold-text on ${surface} is ${ratio.toFixed(2)}:1`)
  }
})
