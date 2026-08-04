/**
 * Bundle-size budget, checked in CI after `npm run build`.
 *
 * The decorative WebGL scene (~229 kB gzipped) and the admin charting library
 * (~103 kB gzipped) are both fine as long as they stay *lazy*. The failure mode
 * worth guarding is not that they grow — it is that someone converts a
 * `lazy(() => import(...))` into a static import, at which point they join the
 * payload every visitor downloads before the app is interactive, and nothing in
 * the build output looks obviously wrong.
 *
 * So this checks three things:
 *
 *   1. The eager payload — the entry chunk plus everything the built
 *      index.html preloads — against a total gzipped budget. That set is the
 *      browser's own definition of "needed before first interaction", read from
 *      the HTML rather than guessed.
 *   2. Named caps for the two known-heavy lazy chunks, so they cannot creep.
 *   3. That those two chunks are absent from the eager set. This is the check
 *      that actually catches an accidental static import; the size checks alone
 *      would still pass.
 *
 * Exits 1 on any violation and prints every one, so a single run tells you
 * everything that needs fixing. Sizes are gzip level 9, matching how Vite
 * reports them.
 */

import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(FRONTEND_DIR, 'dist')
const INDEX_HTML = join(DIST_DIR, 'index.html')

/** Total gzipped size of everything the browser fetches before interaction. */
const EAGER_BUDGET_KB = 330

/** Chunks allowed to be large, by filename prefix, as long as they stay lazy. */
const LAZY_CHUNK_BUDGETS_KB = {
  useSceneRuntime: 250,
  OverviewCharts: 115,
}

/** Any other single chunk exceeding this is a new problem worth a look. */
const DEFAULT_CHUNK_BUDGET_KB = 150

/** These must never appear in the eager set. */
const MUST_STAY_LAZY = ['useSceneRuntime', 'OverviewCharts']

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10

function gzipSize(assetPath) {
  return gzipSync(readFileSync(assetPath), { level: 9 }).length
}

function chunkPrefix(filename) {
  // "OverviewCharts-BabClVLq.js" -> "OverviewCharts"
  return basename(filename).replace(/-[A-Za-z0-9_-]{6,}\.(js|css)$/, '')
}

function readEagerAssets(html) {
  const hrefs = new Set()
  const patterns = [
    /<script[^>]+type="module"[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
    /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g,
  ]
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) hrefs.add(match[1])
  }
  return [...hrefs]
}

function main() {
  if (!existsSync(INDEX_HTML)) {
    console.error(`Bundle budget: no build found at ${INDEX_HTML}. Run \`npm run build\` first.`)
    process.exit(1)
  }

  const html = readFileSync(INDEX_HTML, 'utf8')
  const eagerHrefs = readEagerAssets(html)
  if (eagerHrefs.length === 0) {
    // A parser that silently matches nothing would report a 0 kB payload and
    // pass every budget, which is worse than failing.
    console.error('Bundle budget: parsed no eager assets out of index.html. The build output format changed.')
    process.exit(1)
  }

  const violations = []
  const eagerPrefixes = new Set()
  let eagerBytes = 0

  for (const href of eagerHrefs) {
    const assetPath = join(DIST_DIR, href.replace(/^\//, ''))
    if (!existsSync(assetPath)) {
      violations.push(`index.html preloads ${href}, which is not in dist/`)
      continue
    }
    eagerBytes += gzipSize(assetPath)
    eagerPrefixes.add(chunkPrefix(href))
  }

  console.log(`Eager payload: ${kb(eagerBytes)} kB gzipped across ${eagerHrefs.length} files (budget ${EAGER_BUDGET_KB} kB)`)
  for (const href of eagerHrefs.sort()) {
    const assetPath = join(DIST_DIR, href.replace(/^\//, ''))
    if (existsSync(assetPath)) {
      console.log(`  ${String(kb(gzipSize(assetPath))).padStart(7)} kB  ${basename(href)}`)
    }
  }

  if (kb(eagerBytes) > EAGER_BUDGET_KB) {
    violations.push(
      `eager payload is ${kb(eagerBytes)} kB gzipped, over the ${EAGER_BUDGET_KB} kB budget`,
    )
  }

  for (const name of MUST_STAY_LAZY) {
    if (eagerPrefixes.has(name)) {
      violations.push(
        `${name} is in the eager payload. It must stay behind a lazy import — `
        + 'check for a static `import` that replaced a `lazy(() => import(...))`.',
      )
    }
  }

  // Every emitted chunk against its cap.
  for (const filename of readdirSync(join(DIST_DIR, 'assets'))) {
    if (!/\.(js|css)$/.test(filename)) continue
    const assetPath = join(DIST_DIR, 'assets', filename)
    if (!statSync(assetPath).isFile()) continue
    const prefix = chunkPrefix(filename)
    const budget = LAZY_CHUNK_BUDGETS_KB[prefix] ?? DEFAULT_CHUNK_BUDGET_KB
    const size = kb(gzipSize(assetPath))
    if (size > budget) {
      violations.push(`${filename} is ${size} kB gzipped, over its ${budget} kB budget`)
    }
  }

  if (violations.length > 0) {
    console.error('\nBundle budget exceeded:')
    for (const violation of violations) console.error(`  - ${violation}`)
    console.error(
      '\nIf an increase is genuinely intended, raise the budget in '
      + 'scripts/check-bundle-budget.mjs in the same commit, so the change is reviewable.',
    )
    process.exit(1)
  }

  console.log('\nBundle budget OK.')
}

main()
