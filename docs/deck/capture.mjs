// Capture the deck's screenshots from the running app, in its light or dark theme, at 2560 x 1440.
//
//   node docs/deck/capture.mjs --mode live     [--keys landing,chat_grounded,...] [--base http://localhost:5173]
//   node docs/deck/capture.mjs --mode live --login            # headed: sign in once, saves tmp/deck/auth-state.json
//   node docs/deck/capture.mjs --mode live --keys archive,novelty,admin_overview --novelty-file <pdf>
//   node docs/deck/capture.mjs --mode fixtures [--keys ...]  # :4173 e2e build, fabricated data: layout stand-ins only
//   node docs/deck/capture.mjs --promote chat_grounded,chat_answered [--from live-light]
//
// --theme light|dark (default light) sets the app's own appearance preference and the browser colour
// scheme; captures land in tmp/deck/captures/<mode>-<theme>/.
//
// Live captures go to tmp/deck/captures/live/, fixture captures to tmp/deck/captures/fixture/.
// `--promote` copies chosen captures into docs/deck/assets/captures/ and records them in
// manifest.json with their mode, route, timestamp, commit and sha256; build.py refuses
// fixture-mode entries unless told otherwise, because the final deck shows the real system only.
//
// Playwright is resolved from the frontend's own dependency tree, so nothing is installed here.

import { createRequire } from 'node:module'
import { spawn, execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const FRONTEND = path.join(ROOT, 'rag-thesis-frontend')
const SCRATCH = path.join(ROOT, 'tmp', 'deck')
const ASSETS = path.join(HERE, 'assets', 'captures')
const require = createRequire(path.join(FRONTEND, 'package.json'))
const { chromium } = require('@playwright/test')

const PREFS_KEY = 'isu-thesis-preferences-v2'
const AUTH_FIXTURE_KEY = 'isu_e2e_auth_fixture'
const PREFS = (theme) => ({ theme, palette: 'isu', motion: 'full', effects: 'full', contrast: 'standard' })

// Ask about a family of theses the archive demonstrably holds (the 2026-09-14 live run cited
// the 2024 YOLO-based left-off-object and intruder-detection theses), never the researchers'
// own thesis (docs/DEFENSE_WALKTHROUGH.md 447-462). The pair mirrors content.GUARD_PAIR.
const QUESTIONS = {
  grounded: 'Which CCSICT theses used YOLO-based object detection, and what did each evaluate?',
  refused: 'Write me a chapter 2 on YOLO-based object detection for campus security',
  answered: 'What methodology did the CCSICT theses on YOLO-based object detection use?',
}
const REFUSAL_RE = /cannot write thesis chapters/i
const FALLBACK_RE = /System message · not a research answer/

const FILES = {
  landing: '01-landing.png',
  login: '01-login.png',
  chat_grounded: '04-chat-grounded.png',
  chat_refused: '05-chat-refused.png',
  chat_answered: '05-chat-answered.png',
  chat_fallback: '05-chat-fallback.png',
  archive: '07-archive.png',
  novelty: '07-novelty.png',
  upload: '08-upload.png',
  dashboard: '11-dashboard.png',
  admin_overview: '11-admin-overview.png',
  admin_upload_history: '11-admin-upload-history.png',
  admin_system: '11-admin-system.png',
  admin_operations: '11-admin-operations.png',
}
const ROUTES = {
  landing: '/', login: '/login', chat_grounded: '/chat', chat_refused: '/chat', chat_answered: '/chat', chat_fallback: '/chat',
  archive: '/archive', novelty: '/novelty', upload: '/upload', dashboard: '/dashboard',
  admin_overview: '/admin', admin_upload_history: '/admin', admin_system: '/admin', admin_operations: '/admin',
}
const GUEST_KEYS = ['landing', 'login', 'chat_grounded', 'chat_refused', 'chat_answered']
const AUTHED_KEYS = ['dashboard', 'archive', 'novelty', 'upload', 'admin_overview', 'admin_upload_history', 'admin_system', 'admin_operations']

// --- args -------------------------------------------------------------------------------
const args = process.argv.slice(2)
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const mode = opt('mode', 'live')
const themeName = String(opt('theme', 'light'))
if (!['light', 'dark'].includes(themeName)) throw new Error('--theme must be light or dark')
const base = opt('base', mode === 'fixtures' ? 'http://127.0.0.1:4173' : 'http://localhost:5173')
const keysArg = opt('keys')
const statePath = opt('state', path.join(SCRATCH, 'auth-state.json'))
const noveltyFile = opt('novelty-file')
const pauseMs = Number(opt('pause', '25000'))
const zoom = Number(opt('zoom', '1'))          // CSS zoom for chat captures so question, answer and sources share one frame
const viewportH = Number(opt('height', '720'))
const apiBase = opt('api', 'http://localhost:8000')
const retries = Number(opt('retry-fallback', '3'))   // a grounded question can land on the grounded fallback; try again
const outDir = path.join(SCRATCH, 'captures', `${mode === 'fixtures' ? 'fixture' : 'live'}-${themeName}`)
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m)

// --- helpers ----------------------------------------------------------------------------
async function settleAnimations(page) {
  // Copied from e2e/accessibility.spec.js: wait until every Framer-driven opacity stops moving.
  await page.waitForFunction(() => {
    const sample = () => [...document.querySelectorAll('[style*="opacity"]')]
      .map((element) => getComputedStyle(element).opacity).join(',')
    const before = sample()
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(sample() === before)))
    })
  }, undefined, { timeout: 15_000 }).catch(() => {})
}

async function newContext(browser, { motion = 'reduce', storageState, fixture } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: viewportH },
    deviceScaleFactor: 2,
    colorScheme: themeName,
    reducedMotion: motion,
    ...(storageState && existsSync(storageState) ? { storageState } : {}),
  })
  await context.addInitScript(({ key, prefs, authKey, fixture }) => {
    window.localStorage.setItem(key, JSON.stringify(prefs))
    if (fixture) window.localStorage.setItem(authKey, JSON.stringify(fixture))
  }, { key: PREFS_KEY, prefs: PREFS(themeName), authKey: AUTH_FIXTURE_KEY, fixture })
  return context
}

async function shoot(page, key) {
  await settleAnimations(page)
  await sleep(600)
  const file = path.join(outDir, `${key}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
  log(`captured ${key} -> ${path.relative(ROOT, file)}`)
  return file
}

async function ask(page, question, waitFor) {
  const composer = page.getByPlaceholder(/Ask IskAI about CCSICT thesis research/)
  await composer.waitFor({ timeout: 30_000 })
  if (zoom !== 1) await page.evaluate((z) => { document.body.style.zoom = String(z) }, zoom)
  if (await page.getByText(/Confirm you.re human/).count()) {
    throw new Error('Turnstile gate is showing: start the dev server with VITE_TURNSTILE_SITE_KEY empty')
  }
  await composer.fill(question)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByText(waitFor).first().waitFor({ timeout: 120_000 })
  await sleep(800)
  // Bring the question to the top of the transcript so the exchange reads top-down in the frame.
  await page.getByText(question, { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {})
  await page.evaluate((q) => {
    const el = [...document.querySelectorAll('*')].find((n) => n.childElementCount === 0 && n.textContent.trim() === q)
    if (el) el.scrollIntoView({ block: 'start' })
  }, question)
}

// --- fixture handlers (fabricated, from e2e/critical-flows.spec.js) ------------------------
function fixtureHandlers(key) {
  const paper = {
    id: 'paper-1', title: 'A Centralized AI-Powered Thesis Library', authors: 'A. Researcher, C. Researcher',
    abstract: 'A closed-domain RAG archive for campus research.', year: 2026, track: 'Data Mining', department: 'CCSICT',
    program_id: 'program-bscs', specialization_id: 'specialization-dm', thesis_category: 'student', duplication_scan: null,
  }
  const base = {
    'GET /health': { status: 'ok', checks: { api: 'ok', database: 'ok' }, version: 'e2e' },
    'GET /settings/public': { evaluation_department: 'CCSICT' },
    'GET /catalog/programs': [], 'GET /catalog/specializations': [], 'GET /catalog/departments': [],
    'GET /papers': [paper, { ...paper, id: 'paper-2', title: 'Adaptive Irrigation Analytics for Isabela Farms', authors: 'F. Adviser', year: 2025, track: '', thesis_category: 'faculty' }],
    'GET /duplication/history': [],
    'GET /sessions': [],
  }
  const chatAnswer = {
    answer: 'The archived study uses a retrieval-augmented generation architecture [1].',
    sources: [{ citation_id: 1, id: 'paper-1', chunk_id: 42, title: paper.title, authors: paper.authors, year: 2026, track: 'Data Mining',
      department: 'CCSICT', similarity: 91.25, page_start: 12, page_end: 13, section: 'Methodology', chunk_index: 4 }],
    duplication_alert: null, session_id: null, history_saved: false, no_relevant_thesis: false,
  }
  const chatRefused = { ...chatAnswer, answer: 'I can help you find and understand CCSICT theses, but I cannot write thesis chapters, assignments, proposals, hypotheses, or original content for you.', sources: [], kind: 'notice' }
  const scan = {
    id: 'scan-1', filename: 'proposal.txt', created_at: '2026-07-20T00:00:00Z', department: 'CCSICT', flagged: true, threshold: 85,
    highest_similarity: 91.25, matched_chunk_percentage: 25, matched_chunk_count: 2, total_chunks: 8, verdict_level: 'review_suggested',
    verdict_summary: 'Two passages should be reviewed by faculty.', top_matches: [], matched_chunks: [], chat_log: [],
  }
  return { ...base, 'POST /chat': key === 'chat_refused' ? chatRefused : chatAnswer, 'POST /duplication/scan': scan }
}

async function mockApi(page, handlers) {
  await page.route('**/__e2e_api/**', async (route) => {
    const url = new URL(route.request().url())
    const key = `${route.request().method()} ${url.pathname.replace('/__e2e_api', '') || '/'}`
    const handler = handlers[key]
    if (!handler) {
      await route.fulfill({ status: 200, json: key.startsWith('GET') ? [] : {} })
      return
    }
    await route.fulfill({ status: 200, json: handler })
  })
}

// --- fixture server -----------------------------------------------------------------------
async function withFixtureServer(fn) {
  const child = spawn(process.execPath, ['e2e/vite-server.mjs'], { cwd: FRONTEND, stdio: ['pipe', 'inherit', 'inherit'] })
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:4173/')
      if (res.ok) break
    } catch {}
    await sleep(1000)
  }
  try {
    await fn()
  } finally {
    child.stdin.write('close\n')
    await sleep(1500)
    child.kill()
  }
}

// --- capture plans -----------------------------------------------------------------------
async function captureKey(browser, key) {
  const fixture = mode === 'fixtures'
  const authFixture = fixture && AUTHED_KEYS.includes(key)
    ? { user: { id: 'e2e-admin', email: 'admin@example.test', user_metadata: { full_name: 'E2E Administrator' } },
        profile: { role: key === 'novelty' ? 'faculty' : 'superadmin', full_name: 'E2E Administrator', email: 'admin@example.test', department: 'CCSICT', status: 'approved', avatar_url: null },
        features: key === 'novelty' ? { faculty: { chat: true, archive: true, novelty: true, upload: false } } : {} }
    : undefined
  const context = await newContext(browser, {
    motion: key === 'landing' ? 'no-preference' : 'reduce',
    storageState: !fixture && AUTHED_KEYS.includes(key) ? statePath : undefined,
    fixture: authFixture,
  })
  const page = await context.newPage()
  if (fixture) await mockApi(page, fixtureHandlers(key))
  try {
    switch (key) {
      case 'landing':
        await page.goto(`${base}/`, { waitUntil: 'networkidle' })
        await sleep(3500)  // let the constellation settle into a pleasing frame
        break
      case 'login':
        await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
        break
      case 'chat_grounded':
      case 'chat_answered': {
        // The grounded fallback is real behaviour worth keeping, but slides 4 and 5 want the cited answer.
        const question = key === 'chat_grounded' ? QUESTIONS.grounded : QUESTIONS.answered
        let attempt = 0
        for (;;) {
          await page.goto(`${base}/chat`)
          await ask(page, question, /Evidence sources/)
          if (!(await page.getByText(FALLBACK_RE).count())) break
          attempt += 1
          const file = path.join(outDir, 'chat_fallback.png')
          await page.screenshot({ path: file, animations: 'disabled' })
          log(`${key}: grounded fallback on attempt ${attempt} (kept as chat_fallback.png)`)
          if (attempt >= retries) throw new Error(`still the grounded fallback after ${retries} attempts`)
          await sleep(pauseMs)
        }
        break
      }
      case 'chat_refused':
        await page.goto(`${base}/chat`)
        await ask(page, QUESTIONS.refused, REFUSAL_RE)
        break
      case 'novelty':
        await page.goto(`${base}/novelty`)
        if (!fixture && !noveltyFile) throw new Error('novelty needs --novelty-file <pdf|txt>')
        await page.locator('input[type="file"]').setInputFiles(fixture
          ? { name: 'proposal.txt', mimeType: 'text/plain', buffer: Buffer.from('A deterministic proposal fixture.') }
          : noveltyFile)
        await page.getByText(/Highest passage similarity/).first().waitFor({ timeout: 180_000 })
        break
      case 'admin_overview': case 'admin_upload_history': case 'admin_system': case 'admin_operations': {
        await page.goto(`${base}/admin`, { waitUntil: 'networkidle' })
        const tab = { admin_overview: 'Overview', admin_upload_history: 'Upload history', admin_system: 'System Management', admin_operations: 'Operations' }[key]
        if (await page.getByText(/Verify your administrator session/).count()) throw new Error('2FA gate: complete the security step in the signed-in browser first')
        await page.getByRole('tab', { name: tab }).click()
        await sleep(1200)
        break
      }
      default:
        await page.goto(`${base}${ROUTES[key]}`, { waitUntil: 'networkidle' })
    }
    await shoot(page, key)
  } finally {
    await context.close()
  }
}

async function login(browser) {
  const context = await newContext(browser)
  const page = await context.newPage()
  await page.goto(`${base}/login`)
  log('sign in as the account you want the captures to show; waiting up to 10 minutes...')
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const signedIn = await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token')))
    if (signedIn && !page.url().includes('/login')) break
    await sleep(1500)
  }
  await context.storageState({ path: statePath })
  log(`saved ${path.relative(ROOT, statePath)}`)
  await context.close()
}

async function recordArchiveState() {
  // The landing page's live counters come from this public route; slide 7 quotes it with its read date
  // instead of a number copied from an older walkthrough.
  try {
    const res = await fetch(`${apiBase}/analytics/summary`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const summary = await res.json()
    const now = new Date()
    // read_on is the local calendar day; read_at is the exact UTC instant.
    const state = { ...summary, read_on: now.toLocaleDateString('sv-SE'), read_at: now.toISOString(), source: '/analytics/summary' }
    writeFileSync(path.join(outDir, 'archive_state.json'), JSON.stringify(state, null, 2) + '\n')
    log(`archive state: ${summary.total_papers} papers, ${summary.total_tracks} tracks (read live)`)
  } catch (error) {
    log(`archive state not recorded: ${error.message}`)
  }
}

function promote(keys, from) {
  mkdirSync(ASSETS, { recursive: true })
  const stateSrc = path.join(SCRATCH, 'captures', from, 'archive_state.json')
  if (from.startsWith('live') && existsSync(stateSrc)) {
    copyFileSync(stateSrc, path.join(ASSETS, 'archive_state.json'))
    log('promoted archive_state.json')
  }
  const manifestPath = path.join(ASSETS, 'manifest.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { captures: {} }
  const head = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  for (const key of keys) {
    const src = path.join(SCRATCH, 'captures', from, `${key}.png`)
    if (!existsSync(src)) throw new Error(`no ${from} capture for ${key} at ${src}`)
    const file = FILES[key]
    copyFileSync(src, path.join(ASSETS, file))
    manifest.captures[key] = {
      file, route: ROUTES[key], mode: from.startsWith('live') ? 'live' : 'fixture', theme: from.split('-')[1] || 'dark',
      captured_at: new Date().toISOString(), head,
      sha256: createHash('sha256').update(readFileSync(src)).digest('hex'),
    }
    log(`promoted ${key} (${from}) -> assets/captures/${file}`)
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

// --- main -------------------------------------------------------------------------------
async function main() {
  if (opt('promote')) {
    promote(String(opt('promote')).split(',').filter(Boolean), opt('from', `live-${themeName}`))
    return
  }
  const browser = await chromium.launch({ headless: !opt('login') })
  try {
    if (opt('login')) {
      await login(browser)
      return
    }
    const keys = keysArg ? String(keysArg).split(',').filter(Boolean)
      : mode === 'fixtures' ? [...GUEST_KEYS, 'archive', 'novelty', 'admin_operations'] : GUEST_KEYS
    const run = async () => {
      for (const key of keys) {
        try {
          await captureKey(browser, key)
        } catch (error) {
          log(`FAILED ${key}: ${error.message}`)
        }
        if (mode === 'live' && key.startsWith('chat_')) await sleep(pauseMs)  // free-tier quota is per minute
      }
    }
    if (mode === 'fixtures') await withFixtureServer(run)
    else {
      await run()
      await recordArchiveState()
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
