/**
 * WCAG 2.2 AA accessibility gate (roadmap PI-05/PI-06; verification gates §13:
 * "WCAG 2.2 AA; zero serious/critical axe issues").
 *
 * Scans every critical surface — public and authenticated — across the theme
 * and contrast states the appearance dialog actually exposes, at the same
 * mobile/desktop widths as the structural visual matrix.
 *
 * The matrix runs with reduced motion and low visual effects. That is a
 * deliberate determinism choice, not a way to dodge the hard cases: both flags
 * switch the WebGL scenes off (`Hero.jsx`, `Login.jsx`), so no scan depends on
 * headless GPU timing or the sustained-sub-45-FPS degrade path. The decorative
 * layers those flags remove are `aria-hidden` in every case. Real-GPU 3D
 * profiling stays with the manual device matrix, where it belongs.
 *
 * The gate fails on serious/critical impact. Moderate and minor findings are
 * recorded in the report for the follow-up backlog rather than silently
 * dropped. Run with CAPTURE_A11Y_EVIDENCE=1 to write a dated evidence bundle.
 */
import { expect, test } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const AUTH_FIXTURE_KEY = 'isu_e2e_auth_fixture'
const PREFERENCES_KEY = 'isu-thesis-preferences-v2'
// Opts this suite alone into MotionGlobalConfig.skipAnimations (see main.jsx).
// Contrast has to be judged on the settled frame, and Framer keeps animating
// opacity even under reduced motion. Other suites leave it off, because
// collapsing enter/exit transitions changes how dialogs behave.
const SKIP_ANIMATIONS_KEY = 'isu_e2e_skip_animations'
const DESKTOP_WIDTH = 1280
const MOBILE_WIDTH = 360
const BLOCKING_IMPACTS = ['serious', 'critical']

const THEME_STATES = [
  { name: 'light-standard', theme: 'light', contrast: 'standard' },
  { name: 'light-high-contrast', theme: 'light', contrast: 'high' },
  { name: 'dark-standard', theme: 'dark', contrast: 'standard' },
  { name: 'dark-high-contrast', theme: 'dark', contrast: 'high' },
]

/* ------------------------------------------------------------------ */
/* Deterministic session fixtures                                      */
/* ------------------------------------------------------------------ */
const baseProfile = {
  full_name: 'E2E Reviewer',
  email: 'reviewer@example.test',
  department: 'CCSICT',
  status: 'approved',
  avatar_url: null,
}

function fixtureFor(role, features = {}) {
  return {
    user: {
      id: `e2e-${role}`,
      email: baseProfile.email,
      user_metadata: { full_name: baseProfile.full_name },
    },
    profile: { ...baseProfile, role },
    features,
  }
}

const studentFixture = fixtureFor('student', {
  student: { chat: true, archive: true, novelty: false, upload: false },
})
const facultyFixture = fixtureFor('faculty', {
  faculty: { chat: true, archive: true, novelty: true, upload: false },
})
const adminFixture = fixtureFor('admin')
const superadminFixture = fixtureFor('superadmin')

/* ------------------------------------------------------------------ */
/* Populated API fixtures — an empty page hides most of the a11y surface */
/* ------------------------------------------------------------------ */
const PAPERS = [
  {
    id: 'paper-1',
    title: 'A Centralized AI-Powered Thesis Library',
    authors: 'A. Researcher, C. Researcher',
    abstract: 'A closed-domain retrieval-augmented archive for campus research.',
    year: 2026,
    track: 'Data Mining',
    department: 'CCSICT',
    chunk_count: 42,
    created_at: '2026-07-01T00:00:00Z',
    uploader_name: 'E2E Reviewer',
    program_id: 'program-bscs',
    specialization_id: 'specialization-dm',
    legacy_track: null,
    classification_status: 'classified',
    duplication_scan: {
      flagged: true,
      highest_similarity: 88.5,
      matched_chunk_percentage: 12.5,
      matched_chunk_count: 5,
      total_chunks: 42,
      verdict_level: 'review_suggested',
    },
  },
  {
    id: 'paper-2',
    title: 'Campus Network Intrusion Detection Using Ensemble Models',
    authors: 'B. Researcher',
    abstract: 'An ensemble approach to detecting anomalous campus traffic.',
    year: 2025,
    track: 'Network Security',
    department: 'CCSICT',
    chunk_count: 31,
    created_at: '2026-06-02T00:00:00Z',
    uploader_name: 'E2E Reviewer',
    program_id: 'program-bsit',
    specialization_id: 'specialization-netsec',
    legacy_track: null,
    classification_status: 'classified',
    duplication_scan: null,
  },
]

const CATALOG = [{
  id: 'dept-ccsict',
  name: 'CCSICT',
  track_label: 'Program / specialization',
  tracks: ['Data Mining', 'WMAD', 'NETSEC'],
  created_at: '2026-01-01T00:00:00Z',
  programs: [
    {
      id: 'program-bscs',
      code: 'BSCS',
      name: 'Bachelor of Science in Computer Science',
      specializations: [{ id: 'specialization-dm', code: 'DM', name: 'Data Mining' }],
    },
    {
      id: 'program-bsit',
      code: 'BSIT',
      name: 'Bachelor of Science in Information Technology',
      specializations: [
        { id: 'specialization-wmad', code: 'WMAD', name: 'Web and Mobile Application Development' },
        { id: 'specialization-netsec', code: 'NETSEC', name: 'Network Security' },
      ],
    },
  ],
}]

const API_FIXTURES = {
  '/health': { status: 'ok', checks: { api: 'ok', database: 'ok' }, version: 'e2e' },
  '/settings/public': { evaluation_department: 'CCSICT' },
  '/settings/features': {
    student: { chat: true, archive: true, novelty: false, upload: false },
    faculty: { chat: true, archive: true, novelty: true, upload: false },
  },
  '/analytics/summary': {
    total_papers: 50,
    total_tracks: 5,
    total_queries: 1200,
    year_range: { from: 2019, to: 2026 },
  },
  '/analytics/overview': {
    papers: {
      total: 2,
      per_track: { 'Data Mining': 1, 'Network Security': 1 },
      per_year: { 2025: 1, 2026: 1 },
      total_chunks: 73,
    },
    users: { total: 3, per_role: { student: 1, faculty: 1, admin: 1 } },
    usage: {
      chat_queries: 128,
      chat_sessions: 24,
      novelty_scans: 6,
      avg_duplication_percentage: 14.25,
      flagged_scans: 1,
    },
  },
  '/analytics/activity': [{
    id: 1,
    user_id: 'e2e-admin',
    action: 'chat_query',
    department: 'CCSICT',
    detail: { sources_cited: 2 },
    created_at: '2026-07-30T02:00:00Z',
  }],
  '/analytics/users': [{
    id: 'e2e-student',
    email: 'student@example.test',
    full_name: 'E2E Student',
    role: 'student',
    department: 'CCSICT',
    status: 'approved',
    created_at: '2026-06-01T00:00:00Z',
  }],
  '/analytics/logs/system': [{
    id: 1,
    user_id: 'e2e-admin',
    action: 'role_change',
    department: 'CCSICT',
    detail: { new_role: 'faculty' },
    created_at: '2026-07-30T02:00:00Z',
  }],
  '/analytics/me': {
    id: 'e2e-admin',
    email: baseProfile.email,
    full_name: baseProfile.full_name,
    role: 'admin',
    department: 'CCSICT',
    status: 'approved',
    created_at: '2026-06-01T00:00:00Z',
    avatar_url: null,
    program_id: null,
    specialization_id: null,
  },
  '/papers': PAPERS,
  '/upload/tracks': { tracks: ['Data Mining', 'Web Development', 'Network Security'] },
  '/catalog/departments/legacy': CATALOG,
  '/sessions': [{
    id: 'session-1',
    title: 'Anomaly detection studies',
    department: 'CCSICT',
    created_at: '2026-07-28T02:00:00Z',
  }],
  '/duplication/history': [{
    id: 'scan-1',
    filename: 'proposal.txt',
    department: 'CCSICT',
    duplication_percentage: 25,
    highest_similarity: 91.25,
    matched_chunk_percentage: 25,
    matched_chunk_count: 2,
    total_chunks: 8,
    verdict_level: 'review_suggested',
    top_matches: [],
    verdict_summary: 'Two passages should be reviewed by faculty.',
    chat_log: [],
    created_at: '2026-07-20T00:00:00Z',
  }],
  '/maintenance/operations/summary': {
    status: 'healthy',
    healthy_workers: 1,
    registered_workers: 1,
    queued_jobs: 2,
    stale_jobs: 0,
    pending_cleanups: 0,
    failed_jobs: 0,
    scanner_unavailable: 0,
  },
  '/maintenance/workers': {
    workers: [{
      worker_id: 'a1b2c3d4e5f6',
      state: 'idle',
      scanner_status: 'healthy',
      version: '2.1.0',
      current_job_id: null,
      started_at: '2026-07-24T00:00:00Z',
      last_seen_at: '2026-07-24T00:00:00Z',
      stopped_at: null,
    }],
  },
  '/maintenance/upload-jobs': {
    jobs: [{
      id: '11111111-1111-4111-8111-111111111111',
      department: 'CCSICT',
      status: 'queued',
      stage: 'embed',
      progress: 58,
      attempt_count: 1,
      max_attempts: 3,
      failure_category: null,
      cleanup_status: 'not_required',
      created_at: '2026-07-24T00:00:00Z',
      updated_at: '2026-07-24T00:00:00Z',
      completed_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
    }],
  },
  '/maintenance/alerts': {
    alerts: [{
      id: 'alert-1',
      alert_type: 'queue_age',
      severity: 'warning',
      status: 'open',
      safe_details: { stale_jobs: 1 },
      occurrence_count: 1,
      last_seen_at: '2026-07-24T00:00:00Z',
    }],
  },
  '/maintenance/retention/report': {
    applied: false,
    upload_job_events: 4,
    resolved_operational_alerts: 1,
    security_audit_events: 2,
  },
}

async function mockApi(page, unmocked) {
  // Supabase only serves the dashboard's MFA-factor probe here; an unmocked
  // rejection would render the security card in an error state instead of the
  // real one.
  await page.route('**/__e2e_supabase/**', (route) => route.fulfill({
    status: 200,
    json: { data: { all: [], totp: [] }, error: null },
  }))
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/css', body: '',
  }))
  await page.route('**/__e2e_api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace('/__e2e_api', '')
    const body = API_FIXTURES[pathname]
    if (body === undefined) {
      unmocked.push(`${route.request().method()} ${pathname}`)
      await route.fulfill({ status: 501, json: { detail: `Unmocked: ${pathname}` } })
      return
    }
    await route.fulfill({ status: 200, json: body })
  })
}

/* ------------------------------------------------------------------ */
/* Surfaces under test                                                 */
/* ------------------------------------------------------------------ */
const SURFACES = [
  {
    name: 'landing',
    path: '/',
    fixture: null,
    ready: (page) => expect(page.getByRole('heading', { level: 1 })).toBeVisible(),
  },
  {
    name: 'authentication',
    path: '/login',
    fixture: null,
    ready: (page) => expect(page.getByPlaceholder('you@isu.edu.ph')).toBeVisible(),
  },
  {
    name: 'guest-chat',
    path: '/chat',
    fixture: null,
    ready: (page) => expect(page.getByPlaceholder(/Ask IskAI about/)).toBeVisible(),
  },
  {
    name: 'dashboard',
    path: '/dashboard',
    fixture: studentFixture,
    ready: (page) => expect(page.getByRole('heading', { name: 'E2E Reviewer', level: 1 })).toBeVisible(),
  },
  {
    name: 'archive',
    path: '/archive',
    fixture: studentFixture,
    ready: (page) => expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible(),
  },
  {
    name: 'novelty',
    path: '/novelty',
    fixture: facultyFixture,
    ready: (page) => expect(page.getByRole('heading', { name: /Novelty/, level: 1 })).toBeVisible(),
  },
  {
    name: 'upload',
    path: '/upload',
    fixture: adminFixture,
    ready: (page) => expect(page.getByRole('heading', { name: /Upload/, level: 1 })).toBeVisible(),
  },
  {
    name: 'admin-overview',
    path: '/admin',
    fixture: superadminFixture,
    ready: (page) => expect(page.getByRole('heading', { name: /Research/, level: 1 })).toBeVisible(),
  },
  {
    name: 'admin-upload-history',
    path: '/admin',
    fixture: superadminFixture,
    ready: (page) => expect(page.getByRole('tab', { name: 'Upload history' })).toBeVisible(),
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'Upload history' }).click()
      await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()
    },
  },
  {
    name: 'admin-system-management',
    path: '/admin',
    fixture: superadminFixture,
    ready: (page) => expect(page.getByRole('tab', { name: 'System Management' })).toBeVisible(),
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'System Management' }).click()
      await expect(page.getByRole('tab', { name: 'System Management' })).toHaveAttribute('aria-selected', 'true')
    },
  },
  {
    name: 'admin-operations',
    path: '/admin',
    fixture: superadminFixture,
    ready: (page) => expect(page.getByRole('tab', { name: 'Operations' })).toBeVisible(),
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'Operations' }).click()
      await expect(page.getByRole('heading', { name: 'Ingestion operations' })).toBeVisible()
    },
  },
]

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */
// Playwright starts a fresh worker process after every test failure, which
// discards module-level state. Each surface therefore persists its own findings
// shard the moment it finishes scanning, and the merge below rebuilds the whole
// report from disk — so a failing surface still contributes its findings.
const SHARD_DIR = new URL('../test-results/axe-shards/', import.meta.url)

function toFindings(surface, state, width, results) {
  return results.violations.map((violation) => ({
    surface: surface.name,
    path: surface.path,
    state: state.name,
    width,
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    tags: violation.tags,
    nodeCount: violation.nodes.length,
    nodes: violation.nodes.slice(0, 4).map((node) => ({
      target: node.target,
      html: node.html.slice(0, 240),
      failureSummary: node.failureSummary,
    })),
  }))
}

/**
 * Wait for entry animations to reach their final frame.
 *
 * `reducedMotion` in Framer Motion suppresses transform and layout animations
 * but deliberately still animates opacity, so staggered fade-ins keep running
 * even in the reduced configuration this matrix uses. Sampling mid-fade reports
 * whatever partial alpha the element happened to be at — the upload-history
 * pipeline labels measured 1.04:1 that way, a ratio their static classes cannot
 * produce. Contrast must be judged on the settled frame, so this polls until
 * every animated element's opacity stops changing.
 */
async function settleAnimations(page) {
  // Only elements Framer is driving carry an inline opacity, which keeps the
  // sample clear of the decorative CSS keyframes (aurora, marquee, pulse-glow)
  // that loop forever and would never report themselves as settled.
  await page.waitForFunction(() => {
    const sample = () => [...document.querySelectorAll('[style*="opacity"]')]
      .map((element) => getComputedStyle(element).opacity)
      .join(',')
    const before = sample()
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(sample() === before)))
    })
  }, undefined, { timeout: 15_000 })
}

async function scan(page, surface, state, width) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: state.theme, reducedMotion: 'reduce' })
  await page.evaluate(([key, value]) => {
    window.localStorage.setItem(key, value)
  }, [PREFERENCES_KEY, JSON.stringify({
    theme: state.theme,
    palette: 'isu',
    motion: 'reduced',
    effects: 'low',
    contrast: state.contrast,
  })])
  await page.goto(surface.path)
  await surface.ready(page)
  if (surface.prepare) await surface.prepare(page)
  await settleAnimations(page)
  return new AxeBuilder({ page }).analyze()
}

for (const surface of SURFACES) {
  test(`accessibility — ${surface.name}`, async ({ page }) => {
    test.slow()
    const unmocked = []
    await mockApi(page, unmocked)
    // Runs before the app boots, so main.jsx sees the flag on first evaluation.
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, '1')
    }, SKIP_ANIMATIONS_KEY)
    if (surface.fixture) {
      await page.addInitScript(({ key, value }) => {
        window.localStorage.setItem(key, JSON.stringify(value))
      }, { key: AUTH_FIXTURE_KEY, value: surface.fixture })
    }

    // Bootstrap so the origin exists before preferences are written.
    await page.goto('/')

    const surfaceFindings = []
    for (const state of THEME_STATES) {
      surfaceFindings.push(
        ...toFindings(surface, state, DESKTOP_WIDTH, await scan(page, surface, state, DESKTOP_WIDTH)),
      )
    }
    const mobileState = THEME_STATES.find((state) => state.name === 'dark-standard')
    surfaceFindings.push(
      ...toFindings(surface, mobileState, MOBILE_WIDTH, await scan(page, surface, mobileState, MOBILE_WIDTH)),
    )

    // Persist before asserting, so the report survives this surface failing.
    await mkdir(fileURLToPath(SHARD_DIR), { recursive: true })
    await writeFile(
      fileURLToPath(new URL(`${surface.name}.json`, SHARD_DIR)),
      JSON.stringify(surfaceFindings),
      'utf8',
    )

    const blocking = surfaceFindings
      .filter((finding) => BLOCKING_IMPACTS.includes(finding.impact))
      .map((finding) => `${finding.impact}/${finding.id} @ ${finding.state}/${finding.width}px (${finding.nodeCount} nodes)`)

    expect(unmocked, `${surface.name} made unmocked API calls`).toEqual([])
    expect(blocking, `${surface.name} has serious/critical axe violations`).toEqual([])
  })
}

test.afterAll(async () => {
  const shards = await readdir(fileURLToPath(SHARD_DIR)).catch(() => [])
  const findings = []
  for (const shard of shards.filter((name) => name.endsWith('.json')).sort()) {
    findings.push(...JSON.parse(await readFile(fileURLToPath(new URL(shard, SHARD_DIR)), 'utf8')))
  }

  const blocking = findings.filter((finding) => BLOCKING_IMPACTS.includes(finding.impact))
  const advisory = findings.filter((finding) => !BLOCKING_IMPACTS.includes(finding.impact))
  const report = {
    generated_at: new Date().toISOString(),
    axe_core: 'axe-core 4.12.1 via @axe-core/playwright 4.12.1',
    engine: 'chromium (Playwright 1.61.1)',
    matrix: {
      surfaces: SURFACES.map((surface) => surface.name),
      theme_states: THEME_STATES.map((state) => state.name),
      widths: [DESKTOP_WIDTH, MOBILE_WIDTH],
      configuration: 'motion=reduced, effects=low (WebGL scenes deterministically off)',
    },
    scope_note:
      'Automated axe coverage only. Manual screen-reader transcripts and real-GPU '
      + '3D profiling remain open PI-05/PI-06 gates and are not evidenced here.',
    totals: {
      blocking: blocking.length,
      advisory: advisory.length,
    },
    blocking,
    advisory,
  }

  const targets = [new URL('../test-results/', import.meta.url)]
  if (process.env.CAPTURE_A11Y_EVIDENCE === '1') {
    const stamp = new Date().toISOString().slice(0, 10)
    targets.push(new URL(`../../docs/evidence/accessibility/${stamp}/`, import.meta.url))
  }
  for (const directory of targets) {
    await mkdir(fileURLToPath(directory), { recursive: true })
    await writeFile(
      fileURLToPath(new URL('axe-report.json', directory)),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    )
  }
})
