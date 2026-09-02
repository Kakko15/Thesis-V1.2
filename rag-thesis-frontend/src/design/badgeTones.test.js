import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  BADGE_TONE_ALIASES,
  BADGE_TONE_CLASSES,
  badgeToneClass,
  DEFAULT_BADGE_TONE,
} from './badgeTones.js'
import { blend, contrastRatio } from './contrast.js'

const AA_NORMAL_TEXT = 4.5

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

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
  // Reads the exported values, so no comment-scoping is needed: the prose may
  // name the old failing colours without defeating the check.
  const declared = Object.values(BADGE_TONE_CLASSES).join(' ')
  // text-flame-600 (4.06:1) and text-gold-600 were the measured AA failures.
  assert.doesNotMatch(declared, /text-flame-600/)
  assert.doesNotMatch(declared, /text-gold-600/)
  // The neutral tone used opacity-80, whose result cannot be reasoned about
  // statically because it depends on whatever is painted behind the badge.
  assert.doesNotMatch(declared, /opacity-\d/)
  // Every tone the AA table above measures must still exist by that name.
  for (const { tone } of TONES) {
    assert.ok(tone in BADGE_TONE_CLASSES, `the AA table measures unknown tone ${tone}`)
  }
})

test('every tone resolves to real classes, and an unknown one stays visible', () => {
  assert.ok(Object.keys(BADGE_TONE_ALIASES).length > 0, 'the alias map is empty')
  for (const [name, target] of Object.entries(BADGE_TONE_ALIASES)) {
    assert.ok(target in BADGE_TONE_CLASSES, `alias ${name} points at unknown tone ${target}`)
    // The alias must render the audited tone, which is what extends that
    // tone's measured AA ratio to the semantic name.
    assert.equal(badgeToneClass(name), BADGE_TONE_CLASSES[target])
  }
  for (const [name, classes] of Object.entries(BADGE_TONE_CLASSES)) {
    assert.equal(badgeToneClass(name), classes)
  }
  assert.equal(badgeToneClass(), BADGE_TONE_CLASSES[DEFAULT_BADGE_TONE])

  // The defect: an unrecognised tone returned undefined, so the badge rendered
  // with no background or text colour at all. Anything unknown must still land
  // on a real tone.
  const real = Object.values(BADGE_TONE_CLASSES)
  for (const unknown of ['warn', 'danger', 'error', '', null, undefined, 0, 42, {}]) {
    assert.ok(
      real.includes(badgeToneClass(unknown)),
      `tone ${JSON.stringify(unknown)} resolved to ${JSON.stringify(badgeToneClass(unknown))}`,
    )
  }
})

test('no admin screen passes a Badge tone that is not a tone', () => {
  // The account-status column passed success/warning/critical when the
  // component knew only hue names, and got nothing back.
  const resolvable = new Set([
    ...Object.keys(BADGE_TONE_CLASSES),
    ...Object.keys(BADGE_TONE_ALIASES),
  ])
  const pages = new URL('../pages/', import.meta.url)
  for (const file of ['admin/SystemManagementTab.jsx', 'admin/OperationsTab.jsx']) {
    const source = readFileSync(new URL(file, pages), 'utf8')
    const passed = [
      // tone="neutral"
      ...[...source.matchAll(/<Badge\s+tone="(\w+)"/g)].map(([, name]) => name),
      // tone={cond ? 'flame' : 'forest'} — only the branch results are tones.
      // A literal after === is the state being tested, not a colour, which is
      // why this reads the ? and : positions rather than every quoted word.
      ...[...source.matchAll(/<Badge\s+tone=\{([^}]*)\}/g)]
        .flatMap(([, expression]) => [...expression.matchAll(/[?:]\s*'(\w+)'/g)])
        .map(([, name]) => name),
    ]
    assert.ok(passed.length > 0, `${file} passes no Badge tone this test can read`)
    for (const name of passed) {
      assert.ok(
        resolvable.has(name),
        `${file} passes Badge tone '${name}', which resolves to nothing`,
      )
    }
  }
})

test('the text-safe gold clears AA on every plain light surface', () => {
  const gold = themeColor('gold-text')
  for (const surface of [...LIGHT_SURFACES, '#f9faf5', '#fff8f0', '#eee7de']) {
    const ratio = contrastRatio(gold, surface)
    assert.ok(ratio >= AA_NORMAL_TEXT, `gold-text on ${surface} is ${ratio.toFixed(2)}:1`)
  }
})
