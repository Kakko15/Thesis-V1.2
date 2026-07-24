import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./materialTheme.js', import.meta.url), 'utf8')

test('Material 3 generator owns all critical semantic roles', () => {
  assert.match(source, /@material\/material-color-utilities/)
  for (const role of [
    '--background', '--foreground', '--primary', '--primary-container',
    '--secondary', '--destructive', '--surface-3', '--ring',
  ]) assert.ok(source.includes(`'${role}'`), `${role} is missing`)
})

test('tonal surfaces come from defined Material neutral-palette roles', () => {
  assert.match(source, /neutral\.tone\(tone\)/)
  assert.match(source, /surface: 98, low: 96, container: 94, high: 92/)
  assert.match(source, /surface: 6, low: 10, container: 12, high: 17/)
  assert.doesNotMatch(source, /primary\.surfaceContainer/)
  assert.match(source, /Number\.isInteger\(value\)/)
})

test('high contrast uses opaque black or white boundaries', () => {
  assert.match(source, /highContrast \? \(dark \? '#FFFFFF' : '#000000'\)/)
  assert.match(source, /highContrast \? 'FF' : '38'/)
})
