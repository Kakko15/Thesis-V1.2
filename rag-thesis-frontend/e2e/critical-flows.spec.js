import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

const AUTH_FIXTURE_KEY = 'isu_e2e_auth_fixture'

const adminFixture = {
  user: {
    id: 'e2e-admin',
    email: 'admin@example.test',
    user_metadata: { full_name: 'E2E Administrator' },
  },
  profile: {
    role: 'admin',
    full_name: 'E2E Administrator',
    email: 'admin@example.test',
    department: 'CCSICT',
    status: 'approved',
    avatar_url: null,
  },
  features: {},
}

const superadminFixture = {
  ...adminFixture,
  profile: { ...adminFixture.profile, role: 'superadmin' },
}

async function useAuthenticatedSession(page, fixture = adminFixture) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value))
  }, { key: AUTH_FIXTURE_KEY, value: fixture })
}

function keyFor(request) {
  const url = new URL(request.url())
  return `${request.method()} ${url.pathname.replace('/__e2e_api', '') || '/'}`
}

async function mockApi(page, handlers = {}) {
  const unexpected = []
  const defaults = {
    'GET /health': { status: 'ok', checks: { api: 'ok', database: 'ok' }, version: 'e2e' },
    'GET /settings/public': { evaluation_department: 'CCSICT' },
  }

  await page.route('**/__e2e_api/**', async (route) => {
    const key = keyFor(route.request())
    const handler = handlers[key] ?? defaults[key]
    if (!handler) {
      unexpected.push(key)
      await route.fulfill({ status: 501, json: { detail: `Unmocked E2E request: ${key}` } })
      return
    }
    const response = typeof handler === 'function' ? await handler(route.request()) : handler
    await route.fulfill({
      status: response?.__status ?? 200,
      json: response?.__body ?? response,
    })
  })

  return unexpected
}

test('protected routes redirect signed-out visitors to sign in', async ({ page }) => {
  const unexpected = await mockApi(page)

  await page.goto('/upload')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByPlaceholder('you@isu.edu.ph')).toBeVisible()
  expect(unexpected).toEqual([])
})

test('guest RAG answer stays grounded and survives a hard route refresh', async ({ page }) => {
  let chatPayload
  const unexpected = await mockApi(page, {
    'POST /chat': async (request) => {
      chatPayload = request.postDataJSON()
      return {
        answer: 'The archived study uses a retrieval-augmented generation architecture [1].',
        sources: [{
          citation_id: 1,
          id: 'paper-1',
          chunk_id: 42,
          title: 'A Centralized AI-Powered Thesis Library',
          authors: 'A. Researcher, C. Researcher',
          year: 2026,
          track: 'Data Mining',
          department: 'CCSICT',
          similarity: 91.25,
          page_start: 12,
          page_end: 13,
          section: 'Methodology',
          chunk_index: 4,
        }],
        duplication_alert: null,
        session_id: null,
        history_saved: false,
        no_relevant_thesis: false,
      }
    },
  })

  await page.goto('/chat')
  await expect(page.getByText(/Guest Researcher mode/)).toBeVisible()
  const composer = page.getByPlaceholder(/Ask IskAI about CCSICT thesis research/)
  await composer.fill('What methodology does the archived thesis use?')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(/retrieval-augmented generation architecture/)).toBeVisible()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()
  expect(chatPayload.department_filter).toBeNull()
  expect(chatPayload.session_id).toBeNull()
  expect(chatPayload.question).toBe('What methodology does the archived thesis use?')

  await page.reload()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByText(/Guest Researcher mode/)).toBeVisible()
  await expect(page.getByPlaceholder(/Ask IskAI about CCSICT thesis research/)).toBeVisible()
  expect(unexpected).toEqual([])
})

test('guest chat restores the question after an API failure and can retry', async ({ page }) => {
  let attempts = 0
  const unexpected = await mockApi(page, {
    'POST /chat': () => {
      attempts += 1
      if (attempts === 1) {
        return { __status: 503, __body: { detail: 'The thesis archive is temporarily unavailable.' } }
      }
      return {
        answer: 'The retry succeeded using current archive evidence [1].',
        sources: [{ citation_id: 1, id: 'paper-1', title: 'Retry Evidence', department: 'CCSICT' }],
        no_relevant_thesis: false,
        history_saved: false,
      }
    },
  })

  await page.goto('/chat')
  const composer = page.getByPlaceholder(/Ask IskAI about CCSICT thesis research/)
  const question = 'What objectives are documented?'
  await composer.fill(question)
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText('IskAI could not answer')).toBeVisible()
  await expect(composer).toHaveValue(question)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/retry succeeded/i)).toBeVisible()
  expect(attempts).toBe(2)
  expect(unexpected).toEqual([])
})

test('authenticated archive renders legacy-safe records and filters them', async ({ page }) => {
  await useAuthenticatedSession(page)
  const unexpected = await mockApi(page, {
    'GET /papers': [{
      id: 'paper-1',
      title: 'A Centralized AI-Powered Thesis Library',
      authors: 'A. Researcher, C. Researcher',
      abstract: 'A closed-domain RAG archive for campus research.',
      year: 2026,
      track: 'Data Mining',
      department: 'CCSICT',
      duplication_scan: null,
    }],
    'GET /upload/tracks': { tracks: ['Data Mining'] },
    'GET /departments/': [{
      id: 'dept-1', name: 'CCSICT', track_label: 'Academic track', tracks: ['Data Mining'],
    }],
  })

  await page.goto('/archive')
  await expect(page.getByRole('heading', { name: /Thesis Archive/ })).toBeVisible()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()

  await page.getByPlaceholder(/Search titles, authors, abstracts/).fill('missing topic')
  await expect(page.getByText('No matches found')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()
  expect(unexpected).toEqual([])
})

test('faculty novelty scan renders deterministic advisory metrics', async ({ page }) => {
  await useAuthenticatedSession(page, {
    ...adminFixture,
    profile: { ...adminFixture.profile, role: 'faculty' },
    features: { faculty: { chat: true, archive: true, novelty: true, upload: false } },
  })
  const unexpected = await mockApi(page, {
    'GET /duplication/history': [],
    'POST /duplication/scan': {
      id: 'scan-1',
      filename: 'proposal.txt',
      created_at: '2026-07-20T00:00:00Z',
      department: 'CCSICT',
      flagged: true,
      threshold: 85,
      highest_similarity: 91.25,
      matched_chunk_percentage: 25,
      matched_chunk_count: 2,
      total_chunks: 8,
      verdict_level: 'review_suggested',
      verdict_summary: 'Two passages should be reviewed by faculty.',
      top_matches: [],
      matched_chunks: [],
      chat_log: [],
    },
  })

  await page.goto('/novelty')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'proposal.txt', mimeType: 'text/plain', buffer: Buffer.from('A deterministic proposal fixture.'),
  })

  await expect(page.getByText('91.25%')).toBeVisible()
  await expect(page.getByText('25.00%')).toBeVisible()
  await expect(page.getByText('2 / 8')).toBeVisible()
  await expect(page.getByText('Review suggested')).toBeVisible()
  expect(unexpected).toEqual([])
})

test('administrator upload journey resumes a retrying durable job after refresh', async ({ page }) => {
  await useAuthenticatedSession(page)
  let acceptedKey
  let statusChecks = 0
  const unexpected = await mockApi(page, {
    'GET /departments/': [{
      id: 'dept-1', name: 'CCSICT', track_label: 'Academic track', tracks: ['Data Mining'],
    }],
    'POST /upload/extract-metadata': {
      title: 'Deterministic E2E Thesis', authors: 'A. Researcher, C. Researcher', year: 2026,
    },
    'POST /upload/paper': (request) => {
      acceptedKey = request.headers()['idempotency-key']
      return {
        job_id: 'job-1', idempotency_key: acceptedKey,
        status: 'queued', message: 'Queued',
      }
    },
    'GET /upload/status/job-1': () => {
      statusChecks += 1
      if (statusChecks === 1) {
        return {
          status: 'retry_wait', stage: 'embed', progress: 58,
          message: 'A temporary service problem occurred. The job will retry automatically.',
          attempt_count: 1, max_attempts: 3,
          can_cancel: true, cancel_requested: false,
          next_retry_at: '2026-07-23T12:00:00Z',
        }
      }
      return {
        status: 'completed', stage: 'done', progress: 100, message: 'Indexed', chunks: 22,
        attempt_count: 2, max_attempts: 3,
        duplication: {
          flagged: false,
          highest_similarity: 0,
          matched_chunk_percentage: 0,
          matched_chunk_count: 0,
          total_chunks: 22,
          verdict_level: 'clear',
        },
      }
    },
  })

  await page.goto('/upload')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'thesis.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%e2e fixture\n%%EOF'),
  })
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Metadata autofilled')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('combobox', { name: /Academic track/i }).click()
  await page.getByRole('option', { name: 'Data Mining' }).click()
  await page.getByRole('button', { name: 'Review' }).click()
  await expect(page.getByText('Deterministic E2E Thesis')).toBeVisible()
  await page.getByRole('button', { name: /Ingest into archive/ }).click()

  await expect(page.getByText(/Temporary service interruption/)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Cancel upload' })).toBeVisible()
  expect(acceptedKey).toMatch(/^[0-9a-f-]{36}$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Thesis indexed!' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/22 embedded chunks/)).toBeVisible()
  expect(statusChecks).toBeGreaterThanOrEqual(2)
  expect(unexpected).toEqual([])
})

test('superadmin operations view shows workers, alerts, jobs, and retention dry run', async ({ page }) => {
  await useAuthenticatedSession(page, superadminFixture)
  const unexpected = await mockApi(page, {
    'GET /analytics/overview': {},
    'GET /analytics/activity': [],
    'GET /analytics/users': [],
    'GET /maintenance/operations/summary': {
      status: 'healthy', healthy_workers: 1, queued_jobs: 2,
      pending_cleanups: 0, failed_jobs: 0,
    },
    'GET /maintenance/workers': { workers: [{
      worker_id: 'a1b2c3d4e5f6', state: 'idle', scanner_status: 'healthy',
      last_seen_at: '2026-07-24T00:00:00Z',
    }] },
    'GET /maintenance/upload-jobs': { jobs: [{
      id: '11111111-1111-4111-8111-111111111111', department: 'CCSICT',
      status: 'queued', attempt_count: 1, max_attempts: 3,
      updated_at: '2026-07-24T00:00:00Z',
    }] },
    'GET /maintenance/alerts': { alerts: [{
      id: 'alert-1', alert_type: 'queue_age', severity: 'warning', status: 'open',
      last_seen_at: '2026-07-24T00:00:00Z', occurrence_count: 1,
    }] },
    'GET /maintenance/retention/report': {
      applied: false, upload_job_events: 4, resolved_operational_alerts: 1,
      security_audit_events: 2,
    },
    'POST /maintenance/alerts/alert-1/acknowledge': { id: 'alert-1', status: 'acknowledged' },
  })

  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Operations' }).click()
  await expect(page.getByRole('heading', { name: 'Ingestion operations' })).toBeVisible()
  await expect(page.getByText('a1b2c3d4e5f6')).toBeVisible()
  await expect(page.getByText('queue age')).toBeVisible()
  await expect(page.getByText('Retention dry run')).toBeVisible()
  await page.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(page.getByText('Operational alert acknowledged')).toBeVisible()
  expect(unexpected).toEqual([])
})
