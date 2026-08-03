import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { AA_TEXT_TONE_LIMIT, SURFACE_TONES, TEXT_TONES, textToneKey } from './tokens.js'

const source = readFileSync(new URL('./materialTheme.js', import.meta.url), 'utf8')

test('Material 3 generator owns all critical semantic roles', () => {
  assert.match(source, /@material\/material-color-utilities/)
  for (const role of [
    '--background', '--foreground', '--primary', '--primary-container',
    '--secondary', '--destructive', '--surface-3', '--ring',
    '--text-primary', '--text-secondary', '--text-tertiary',
  ]) assert.ok(source.includes(`'${role}'`), `${role} is missing`)
})

test('tonal surfaces come from defined Material neutral-palette roles', () => {
  assert.match(source, /neutral\.tone\(tone\)/)
  assert.deepEqual(SURFACE_TONES.light, { surface: 98, low: 96, container: 94, high: 92 })
  assert.deepEqual(SURFACE_TONES.dark, { surface: 6, low: 10, container: 12, high: 17 })
  assert.doesNotMatch(source, /primary\.surfaceContainer/)
  assert.match(source, /Number\.isInteger\(value\)/)
})

test('high contrast uses opaque black or white boundaries', () => {
  assert.match(source, /highContrast \? \(dark \? '#FFFFFF' : '#000000'\)/)
  assert.match(source, /highContrast \? 'FF' : '38'/)
})

test('every de-emphasised text tone stays inside the AA limit', () => {
  // Light text darkens as the tone falls, so the limit is a ceiling; dark text
  // brightens as the tone rises, so it is a floor. Anything outside these bounds
  // cannot reach 4.5:1 against the surfaces it is painted on.
  for (const [state, tones] of Object.entries(TEXT_TONES)) {
    const dark = state.startsWith('dark')
    for (const [role, tone] of Object.entries(tones)) {
      const where = `${state}.${role} (tone ${tone})`
      if (dark) {
        assert.ok(tone >= AA_TEXT_TONE_LIMIT.dark, `${where} is below the dark AA floor`)
        assert.ok(tone <= 100, `${where} is not a tone`)
      } else {
        assert.ok(tone <= AA_TEXT_TONE_LIMIT.light, `${where} is above the light AA ceiling`)
        assert.ok(tone >= 0, `${where} is not a tone`)
      }
    }
  }
})

test('secondary text is stronger than tertiary, and high contrast strengthens both', () => {
  // Light tones descend toward black, dark tones ascend toward white, so
  // "stronger" flips direction with the theme.
  assert.ok(TEXT_TONES.light.secondary < TEXT_TONES.light.tertiary)
  assert.ok(TEXT_TONES.dark.secondary > TEXT_TONES.dark.tertiary)
  assert.ok(TEXT_TONES.lightHighContrast.secondary < TEXT_TONES.light.secondary)
  assert.ok(TEXT_TONES.lightHighContrast.tertiary < TEXT_TONES.light.tertiary)
  assert.ok(TEXT_TONES.darkHighContrast.secondary > TEXT_TONES.dark.secondary)
  assert.ok(TEXT_TONES.darkHighContrast.tertiary > TEXT_TONES.dark.tertiary)
})

test('every appearance state resolves to a defined tone set', () => {
  for (const dark of [false, true]) {
    for (const highContrast of [false, true]) {
      const key = textToneKey({ dark, highContrast })
      assert.ok(TEXT_TONES[key], `${key} has no tones`)
    }
  }
  assert.equal(textToneKey(), 'light')
})
