import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/* The typefaces are linked from a third-party origin in index.html and have to
 * be permitted by the production Content-Security-Policy. Nothing else catches
 * a mismatch: dev serves no CSP, and the e2e suites stub the font host, so a
 * blocked face shows up only in the browser of whoever opens the deployed site,
 * as a silent fall back to system fonts. */

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const nginx = readFileSync(new URL('../../nginx/default.conf.template', import.meta.url), 'utf8')

const csp = /Content-Security-Policy "([^"]+)"/.exec(nginx)
assert.ok(csp, 'the nginx template no longer declares a Content-Security-Policy')

/** The origins a CSP directive permits, e.g. directive('font-src'). */
function directive(name) {
  const tokens = csp[1].split(';')
    .map((part) => part.trim().split(/\s+/))
    .find((part) => part[0] === name)
  return tokens ? tokens.slice(1) : []
}

test('every external origin index.html links is allowed by the CSP', () => {
  // href on a stylesheet link is fetched as a style; the faces it references
  // are fetched as fonts, from a different Google origin.
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0])
  assert.ok(stylesheets.length > 0, 'index.html links no stylesheet')

  const externalStyleOrigins = stylesheets
    .map((tag) => /href="(https?:\/\/[^/"]+)/.exec(tag)?.[1])
    .filter(Boolean)
  assert.ok(
    externalStyleOrigins.includes('https://fonts.googleapis.com'),
    'index.html no longer links Google Fonts; drop it from the CSP too',
  )

  const styleSrc = directive('style-src')
  for (const origin of externalStyleOrigins) {
    assert.ok(styleSrc.includes(origin), `style-src does not permit ${origin}`)
  }

  // googleapis serves @font-face rules pointing at gstatic, which never
  // appears in index.html itself, so it has to be asserted directly.
  assert.ok(
    directive('font-src').includes('https://fonts.gstatic.com'),
    'font-src does not permit https://fonts.gstatic.com, which serves the .woff2 files',
  )
})

test('the CSP keeps its restrictive base', () => {
  assert.deepEqual(directive('default-src'), ["'self'"])
  assert.deepEqual(directive('object-src'), ["'none'"])
  assert.deepEqual(directive('frame-ancestors'), ["'none'"])
  // Widening the font origins must not have widened script execution.
  assert.deepEqual(directive('script-src'), ["'self'", 'https://challenges.cloudflare.com'])
  for (const directiveName of ['style-src', 'font-src', 'img-src', 'connect-src']) {
    assert.ok(
      !directive(directiveName).includes("'unsafe-eval'"),
      `${directiveName} permits unsafe-eval`,
    )
  }
})
