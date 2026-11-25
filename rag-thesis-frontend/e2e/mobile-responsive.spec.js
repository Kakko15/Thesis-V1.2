import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'

const AUTH_FIXTURE_KEY = 'isu_e2e_auth_fixture'
const PREFERENCES_KEY = 'isu-thesis-preferences-v2'
const SKIP_ANIMATIONS_KEY = 'isu_e2e_skip_animations'

const superadminFixture = {
  user: {
    id: 'e2e-superadmin',
    email: 'superadmin@example.test',
    user_metadata: { full_name: 'E2E Reviewer' },
  },
  profile: {
    role: 'superadmin',
    full_name: 'E2E Reviewer',
    email: 'superadmin@example.test',
    department: 'CCSICT',
    status: 'approved',
    avatar_url: null,
  },
  features: {},
}

const PAPERS = [
  {
    id: 'paper-1',
    title: 'A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation',
    authors: 'Ahron John F. Barlis, Carlo Rossi P. Gallardo',
    adviser: 'Dr. Liza M. Bautista',
    abstract: 'A closed-domain retrieval-augmented archive for campus research.',
    year: 2026,
    track: 'BSCS',
    department: 'CCSICT',
    chunk_count: 42,
    created_at: '2026-07-01T00:00:00Z',
    uploader_name: 'E2E Reviewer',
    program_id: 'program-bscs',
    specialization_id: null,
    legacy_track: null,
    classification_status: 'classified',
    duplication_scan: {
      flagged: true,
      highest_similarity: 88.5,
      matched_chunk_percentage: 11.9,
      matched_chunk_count: 5,
      total_chunks: 42,
      verdict_level: 'review_suggested',
    },
  },
  {
    id: 'paper-2',
    title: 'BLIS BEYOND GRADUATION: MAPPING CAREER PATHS THROUGH ALUMNI PROFILING AT ISABELA STATE UNIVERSITY – ECHAGUE',
    authors: 'Marvin M. Ualat, Mark Christian U. Padre',
    abstract: 'A descriptive cross-sectional tracer study of BLIS graduates.',
    year: 2026,
    track: 'BLIS',
    department: 'CCSICT',
    chunk_count: 31,
    created_at: '2026-06-02T00:00:00Z',
    uploader_name: 'E2E Reviewer',
    program_id: 'program-blis',
    specialization_id: null,
    legacy_track: null,
    classification_status: 'classified',
    duplication_scan: null,
  },
]

const API_FIXTURES = {
  '/health': { status: 'ok', checks: { api: 'ok', database: 'ok' }, version: 'e2e' },
  '/settings/public': { evaluation_department: 'CCSICT' },
  '/settings/features': {
    student: { chat: true, archive: true, novelty: false, upload: false },
    faculty: { chat: true, archive: true, novelty: true, upload: false },
  },
  '/settings/malware-scanning': { enabled: true, configured: true, status: 'enabled' },
  '/analytics/summary': {
    total_papers: 50, total_tracks: 5, total_queries: 1200, year_range: { from: 2019, to: 2026 },
  },
  '/analytics/overview': {
    papers: { total: 2, per_track: { BSCS: 1, BLIS: 1 }, per_year: { 2025: 1, 2026: 1 }, total_chunks: 73 },
    users: { total: 3, per_role: { student: 1, faculty: 1, admin: 1 } },
    usage: { chat_queries: 128, chat_sessions: 24, novelty_scans: 6, avg_duplication_percentage: 14.25, flagged_scans: 1 },
  },
  '/analytics/activity': [{
    id: 1, user_id: 'e2e-superadmin', action: 'chat_query', department: 'CCSICT',
    detail: { sources_cited: 2 }, created_at: '2026-07-30T02:00:00Z',
  }],
  '/analytics/users': [{
    id: 'e2e-student', email: 'student@example.test', full_name: 'E2E Student', role: 'student',
    department: 'CCSICT', status: 'approved', created_at: '2026-06-01T00:00:00Z',
  }],
  '/analytics/logs/system': [{
    id: 1, user_id: 'e2e-superadmin', action: 'role_change', department: 'CCSICT',
    detail: { new_role: 'faculty' }, created_at: '2026-07-30T02:00:00Z',
  }],
  '/analytics/me': {
    id: 'e2e-superadmin', email: 'superadmin@example.test', full_name: 'E2E Reviewer', role: 'superadmin',
    department: 'CCSICT', status: 'approved', created_at: '2026-06-01T00:00:00Z',
    avatar_url: null, program_id: null, specialization_id: null,
  },
  '/papers': PAPERS,
  '/upload/tracks': { tracks: ['BSCS', 'BLIS', 'Web and Mobile Application Development'] },
  '/catalog/departments/legacy': [{
    id: 'dept-ccsict', name: 'CCSICT', track_label: 'Program / specialization',
    tracks: ['BSCS', 'BLIS', 'Web and Mobile Application Development'],
    created_at: '2026-01-01T00:00:00Z',
    programs: [
      { id: 'program-bscs', code: 'BSCS', name: 'Bachelor of Science in Computer Science', specializations: [] },
      { id: 'program-blis', code: 'BLIS', name: 'Bachelor of Library and Information Science', specializations: [] },
    ],
  }],
  '/sessions': [{
    id: 'session-1', title: 'Compare the two 2026 CCSICT studies', department: 'CCSICT', created_at: '2026-07-28T02:00:00Z',
  }],
  '/sessions/session-1/messages': [{
    id: 'msg-1',
    session_id: 'session-1',
    question: 'Compare the two 2026 CCSICT studies',
    answer: 'The BSCS study engineered a RAG thesis library [1], while the BLIS study traced alumni career paths [2].',
    sources: [
      { citation_id: 1, id: 'paper-1', chunk_id: 1, title: PAPERS[0].title, authors: PAPERS[0].authors, year: 2026, track: 'BSCS', department: 'CCSICT', similarity: 91.2, page_start: 53, page_end: 55, section: 'Methods', chunk_index: 22 },
      { citation_id: 2, id: 'paper-2', chunk_id: 2, title: PAPERS[1].title, authors: PAPERS[1].authors, year: 2026, track: 'BLIS', department: 'CCSICT', similarity: 88.4, page_start: 39, page_end: 41, section: 'METHODOLOGY', chunk_index: 12 },
    ],
    duplication_alert: null,
    created_at: '2026-07-28T02:01:00Z',
  }],
  '/duplication/history': [{
    id: 'scan-1', filename: 'proposal.txt', department: 'CCSICT', duplication_percentage: 25,
    highest_similarity: 91.25, matched_chunk_percentage: 25, matched_chunk_count: 2, total_chunks: 8,
    verdict_level: 'review_suggested',
    top_matches: [{ id: 'paper-1', title: PAPERS[0].title, authors: PAPERS[0].authors, year: 2026, track: 'BSCS', department: 'CCSICT', match_count: 2, similarity: 91.25 }],
    verdict_summary: 'Two passages should be reviewed by faculty.',
    chat_log: [],
    created_at: '2026-07-20T00:00:00Z',
  }],
  '/maintenance/operations/summary': { status: 'healthy', healthy_workers: 1, registered_workers: 1, queued_jobs: 2, stale_jobs: 0, pending_cleanups: 0, failed_jobs: 0, scanner_unavailable: 0 },
  '/maintenance/workers': { workers: [{ worker_id: 'a1b2c3d4e5f6', state: 'idle', scanner_status: 'healthy', version: '2.1.0', current_job_id: null, started_at: '2026-07-24T00:00:00Z', last_seen_at: '2026-07-24T00:00:00Z', stopped_at: null }] },
  '/maintenance/upload-jobs': { jobs: [{ id: '11111111-1111-4111-8111-111111111111', department: 'CCSICT', status: 'queued', stage: 'embed', progress: 58, attempt_count: 1, max_attempts: 3, failure_category: null, cleanup_status: 'not_required', created_at: '2026-07-24T00:00:00Z', updated_at: '2026-07-24T00:00:00Z', completed_at: null, cancel_requested_at: null, cancelled_at: null }] },
  '/maintenance/alerts': { alerts: [{ id: 'alert-1', alert_type: 'queue_age', severity: 'warning', status: 'open', safe_details: { stale_jobs: 1 }, occurrence_count: 1, last_seen_at: '2026-07-24T00:00:00Z' }] },
  '/maintenance/retention/report': { applied: false, upload_job_events: 4, resolved_operational_alerts: 1, security_audit_events: 2 },
}

const ROUTES = [
  { name: 'landing', path: '/', auth: false, ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'login', path: '/login', auth: false, ready: (p) => expect(p.getByRole('textbox', { name: 'Email *' })).toBeVisible() },
  { name: 'signup', path: '/login', auth: false, ready: (p) => expect(p.getByRole('tab', { name: 'Create account' })).toBeVisible(), prepare: async (p) => { await p.getByRole('tab', { name: 'Create account' }).click(); await expect(p.getByRole('textbox', { name: 'Full name *' })).toBeVisible() } },
  { name: 'legal', path: '/legal/agreement', auth: false, ready: (p) => expect(p.getByRole('heading', { name: 'Terms of Agreement', level: 1 })).toBeVisible() },
  { name: 'chat-guest', path: '/chat', auth: false, ready: (p) => expect(p.getByPlaceholder(/Ask IskAI about/)).toBeVisible() },
  { name: 'chat-auth', path: '/chat', auth: true, ready: (p) => expect(p.getByPlaceholder(/Ask IskAI about/)).toBeVisible() },
  { name: 'dashboard', path: '/dashboard', auth: true, ready: (p) => expect(p.getByRole('heading', { name: 'E2E Reviewer', level: 1 })).toBeVisible() },
  { name: 'archive', path: '/archive', auth: true, ready: (p) => expect(p.getByText(/A Centralized AI-Powered Thesis Library/).first()).toBeVisible() },
  { name: 'novelty', path: '/novelty', auth: true, ready: (p) => expect(p.getByRole('heading', { name: /Novelty/, level: 1 })).toBeVisible() },
  { name: 'novelty-report', path: '/novelty', auth: true, ready: (p) => expect(p.getByRole('button', { name: /^proposal\.txt/ })).toBeVisible(), prepare: async (p) => { await p.getByRole('button', { name: /^proposal\.txt/ }).click(); await expect(p.getByRole('tab', { name: /Matches/ })).toBeVisible() } },
  { name: 'upload', path: '/upload', auth: true, ready: (p) => expect(p.getByRole('heading', { name: /Upload/, level: 1 })).toBeVisible() },
  { name: 'upload-batch', path: '/upload/batch', auth: true, ready: (p) => expect(p.getByRole('heading', { name: /Batch/, level: 1 })).toBeVisible() },
  { name: 'settings', path: '/settings', auth: true, ready: (p) => expect(p.getByRole('heading', { name: 'Basic info' })).toBeVisible() },
  { name: 'admin-overview', path: '/admin', auth: true, ready: (p) => expect(p.getByRole('heading', { name: /Research/, level: 1 })).toBeVisible() },
  { name: 'admin-history', path: '/admin', auth: true, ready: (p) => expect(p.getByRole('tab', { name: 'Upload history' })).toBeVisible(), prepare: async (p) => { await p.getByRole('tab', { name: 'Upload history' }).click(); await expect(p.getByText(/A Centralized AI-Powered Thesis Library/).first()).toBeVisible() } },
  { name: 'admin-system', path: '/admin', auth: true, ready: (p) => expect(p.getByRole('tab', { name: 'System Management' })).toBeVisible(), prepare: async (p) => { await p.getByRole('tab', { name: 'System Management' }).click(); await expect(p.getByRole('tab', { name: 'System Management' })).toHaveAttribute('aria-selected', 'true') } },
  { name: 'admin-ops', path: '/admin', auth: true, ready: (p) => expect(p.getByRole('tab', { name: 'Operations' })).toBeVisible(), prepare: async (p) => { await p.getByRole('tab', { name: 'Operations' }).click(); await expect(p.getByRole('heading', { name: 'Ingestion operations' })).toBeVisible() } },
]

test('mobile responsiveness across all pages (360px and 390px)', async ({ page }) => {
  test.slow()
  const auditDir = process.env.CAPTURE_MOBILE_AUDIT_DIR || ''
  if (auditDir) await mkdir(auditDir, { recursive: true })

  await page.route('**/__e2e_supabase/**', (route) => route.fulfill({
    status: 200, json: { data: { all: [], totp: [] }, error: null },
  }))
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/css', body: '',
  }))
  await page.route('**/__e2e_api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace('/__e2e_api', '')
    const body = API_FIXTURES[pathname]
    if (body === undefined) {
      await route.fulfill({ status: 200, json: [] })
      return
    }
    await route.fulfill({ status: 200, json: body })
  })

  await page.addInitScript(({ skipKey, prefKey }) => {
    window.localStorage.setItem(skipKey, '1')
    window.localStorage.setItem(prefKey, JSON.stringify({
      theme: 'light', palette: 'isu', motion: 'reduced', effects: 'low', contrast: 'standard',
    }))
  }, { skipKey: SKIP_ANIMATIONS_KEY, prefKey: PREFERENCES_KEY })

  const findings = []
  await page.goto('/')

  for (const width of [360, 390]) {
    const height = width === 360 ? 740 : 844
    await page.setViewportSize({ width, height })

    for (const route of ROUTES) {
      await page.evaluate(({ key, auth, fixture }) => {
        if (auth) window.localStorage.setItem(key, JSON.stringify(fixture))
        else window.localStorage.removeItem(key)
      }, { key: AUTH_FIXTURE_KEY, auth: route.auth, fixture: superadminFixture })

      await page.goto(route.path)
      await route.ready(page)
      if (route.prepare) await route.prepare(page)
      await page.waitForTimeout(150)

      const metrics = await page.evaluate(() => {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const docOverflow = document.documentElement.scrollWidth - vw
        const clipped = []

        const isInsideHorizontalScroller = (el) => {
          let cur = el.parentElement
          while (cur && cur !== document.body) {
            const style = getComputedStyle(cur)
            if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && cur.scrollWidth > cur.clientWidth + 2) {
              return true
            }
            cur = cur.parentElement
          }
          return false
        }

        const isHiddenAncestor = (el) => {
          let cur = el
          while (cur && cur !== document.body) {
            const s = getComputedStyle(cur)
            if (s.display === 'none' || s.visibility === 'hidden' || Number.parseFloat(s.opacity) === 0) return true
            if (cur.classList.contains('sr-only') || cur.classList.contains('skip-link')) return true
            cur = cur.parentElement
          }
          return false
        }

        for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="tab"], [role="combobox"], h1, h2')) {
          if (isHiddenAncestor(el)) continue
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (isInsideHorizontalScroller(el)) continue
          if (r.right > vw + 2 || r.left < -2) {
            clipped.push({
              tag: el.tagName.toLowerCase(),
              text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 40),
              left: Math.round(r.left),
              right: Math.round(r.right),
              vw,
            })
          }
        }

        // Check mobile bottom nav overlap with composer on /chat
        let chatOverlap = 0
        let chatHeadingClipped = false
        const nav = document.querySelector('nav[aria-label="Mobile navigation"]')
        const composer = document.querySelector('textarea[placeholder*="Ask IskAI"]')
        if (nav && composer) {
          const navRect = nav.getBoundingClientRect()
          const compForm = composer.closest('form') || composer
          const compRect = compForm.getBoundingClientRect()
          chatOverlap = Math.round(compRect.bottom - navRect.top)
        }
        const transcript = document.querySelector('[role="region"][aria-label="Conversation transcript"]')
        const welcomeHeading = transcript?.querySelector('h2')
        if (transcript && welcomeHeading) {
          const tRect = transcript.getBoundingClientRect()
          const hRect = welcomeHeading.getBoundingClientRect()
          chatHeadingClipped = hRect.top < tRect.top - 1
        }

        // Check User Directory first cell isn't crushed into narrow vertical wrap
        let crushedUserCell = false
        const firstUserCell = document.querySelector('[aria-label="User directory"] tbody td')
        if (firstUserCell && firstUserCell.getBoundingClientRect().width < 150) {
          crushedUserCell = true
        }

        return { vw, vh, docOverflow, clipped: clipped.slice(0, 8), chatOverlap, chatHeadingClipped, crushedUserCell }
      })

      if (
        metrics.docOverflow > 1
        || metrics.clipped.length > 0
        || metrics.chatOverlap > 0
        || metrics.chatHeadingClipped
        || metrics.crushedUserCell
      ) {
        findings.push({ route: route.name, width, ...metrics })
      }

      if (auditDir && width === 390) {
        await page.screenshot({ path: `${auditDir}/${route.name}.png`, fullPage: false })
      }
    }
  }

  expect(findings).toEqual([])

  // Verify the mobile Chat Filters drawer toggle opens and closes cleanly on 390px.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/chat')
  const filterToggle = page.getByRole('button', { name: 'Toggle chat filters' })
  await expect(filterToggle).toBeVisible()
  await expect(filterToggle).toHaveAttribute('aria-expanded', 'false')
  await filterToggle.click()
  await expect(filterToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('combobox', { name: 'Filter research by publication recency' })).toBeVisible()
})
