import assert from 'node:assert/strict'
import test from 'node:test'

import { blend, contrastRatio, relativeLuminance, rgbFromHex } from './contrast.js'

test('luminance and ratio match the WCAG reference values', () => {
  assert.equal(relativeLuminance('#ffffff'), 1)
  assert.equal(relativeLuminance('#000000'), 0)
  assert.equal(contrastRatio('#ffffff', '#000000'), 21)
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  // Order must not matter: the lighter colour is always the numerator.
  assert.equal(contrastRatio('#777777', '#ffffff'), contrastRatio('#ffffff', '#777777'))
})

test('hex parsing accepts both notations and rejects anything else', () => {
  assert.deepEqual(rgbFromHex('#0a141e'), [10, 20, 30])
  assert.deepEqual(rgbFromHex('0A141E'), [10, 20, 30])
  assert.throws(() => rgbFromHex('#abc'), TypeError)
  assert.throws(() => rgbFromHex('rebeccapurple'), TypeError)
})

test('blending interpolates in gamma space at the stated alpha', () => {
  assert.equal(blend('#000000', 1, '#ffffff'), '#000000')
  assert.equal(blend('#000000', 0, '#ffffff'), '#ffffff')
  assert.equal(blend('#000000', 0.5, '#ffffff'), '#808080')
})
