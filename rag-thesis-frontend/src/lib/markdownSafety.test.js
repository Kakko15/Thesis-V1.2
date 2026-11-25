import { test } from 'node:test'
import assert from 'node:assert/strict'

import { imagePlaceholder, isExternalHref, safeLinkHref } from './markdownSafety.js'

test('web, mail and in-app links survive', () => {
  assert.equal(safeLinkHref('https://isu.edu.ph/library'), 'https://isu.edu.ph/library')
  assert.equal(safeLinkHref('http://example.org'), 'http://example.org/')
  assert.equal(safeLinkHref('mailto:ccsict@isu.edu.ph'), 'mailto:ccsict@isu.edu.ph')
  assert.equal(safeLinkHref('/archive'), '/archive')
  assert.equal(safeLinkHref('#sources'), '#sources')
})

test('script, data and protocol-relative targets are dropped', () => {
  for (const href of [
    'javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox', '//evil.example/x', '/\\evil.example', 'file:///etc/passwd', '', null, undefined,
  ]) {
    assert.equal(safeLinkHref(href), null, String(href))
  }
})

test('unparseable relative strings are dropped rather than guessed', () => {
  assert.equal(safeLinkHref('not a url'), null)
})

test('external links are recognised for new-tab handling', () => {
  assert.equal(isExternalHref('https://x.example'), true)
  assert.equal(isExternalHref('//x.example'), true)
  assert.equal(isExternalHref('/archive'), false)
  assert.equal(isExternalHref(undefined), false)
})

test('images become their alt text, never a fetch', () => {
  assert.equal(imagePlaceholder('chart of results'), '[image: chart of results]')
  assert.equal(imagePlaceholder('  '), '')
  assert.equal(imagePlaceholder(undefined), '')
})
