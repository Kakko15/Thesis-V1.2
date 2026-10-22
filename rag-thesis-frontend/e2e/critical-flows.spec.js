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

function parseHex(hex) {
  const value = hex.replace('#', '')
  const channels = value.match(/.{2}/g).map((channel) => Number.parseInt(channel, 16) / 255)
  return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 }
}

function composite(foreground, background) {
  const front = parseHex(foreground)
  const back = parseHex(background)
  return front.rgb.map((channel, index) => channel * front.alpha + back.rgb[index] * (1 - front.alpha))
}

function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(foreground, surface, background) {
  const foregroundRgb = parseHex(foreground).rgb
  const surfaceRgb = composite(surface, background)
  const lighter = Math.max(relativeLuminance(foregroundRgb), relativeLuminance(surfaceRgb))
  const darker = Math.min(relativeLuminance(foregroundRgb), relativeLuminance(surfaceRgb))
  return (lighter + 0.05) / (darker + 0.05)
}

async function semanticTheme(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const token = (name) => root.getPropertyValue(name).trim().toUpperCase()
    return {
      theme: document.documentElement.dataset.theme,
      background: token('--background'),
      foreground: token('--card-foreground'),
      card: token('--card'),
      surfaces: [0, 1, 2, 3].map((level) => token(`--surface-${level}`)),
    }
  })
}

function expectReadableCard(tokens) {
  expect(tokens.card).toMatch(/^#[0-9A-F]{8}$/)
  tokens.surfaces.forEach((surface) => expect(surface).toMatch(/^#[0-9A-F]{6}$/))
  expect(new Set(tokens.surfaces).size).toBe(4)
  expect(contrastRatio(tokens.foreground, tokens.card, tokens.background)).toBeGreaterThanOrEqual(4.5)
}

test('light and dark Material surfaces keep readable semantic contrast', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('isu-thesis-preferences-v2', JSON.stringify({
      theme: 'light', palette: 'isu', motion: 'reduced', effects: 'low', contrast: 'standard',
    }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Appearance and energy settings' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const lightTokens = await semanticTheme(page)
  expectReadableCard(lightTokens)
  expect(lightTokens.card).not.toBe('#000000E6')

  await page.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expectReadableCard(await semanticTheme(page))

  await expect(page.getByRole('heading', { name: 'Appearance and energy' })).toBeVisible()
})

test('protected routes redirect signed-out visitors to sign in', async ({ page }) => {
  const unexpected = await mockApi(page)

  await page.goto('/upload')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('textbox', { name: 'Email *' })).toBeVisible()
  expect(unexpected).toEqual([])
})

test('guest appearance controls open in place without redirecting to sign in', async ({ page }) => {
  const unexpected = await mockApi(page)

  await page.goto('/chat')
  await page.getByRole('button', { name: 'Appearance and energy' }).click()

  await expect(page.getByRole('heading', { name: 'Appearance and energy' })).toBeVisible()
  await expect(page).toHaveURL(/\/chat$/)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Appearance and energy' })).toBeHidden()
  await expect(page).toHaveURL(/\/chat$/)
  expect(unexpected).toEqual([])
})

test('password reset can send a verification code after the security check resolves', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('isu_e2e_turnstile', '1')
    window.turnstile = {
      render: (_element, options) => {
        options.callback?.('e2e-turnstile-token')
        return 'e2e-turnstile-widget'
      },
      remove: () => {},
    }
  })
  let resetRequest
  await page.route('**/__e2e_supabase/**', async (route) => {
    resetRequest = route.request()
    await route.fulfill({ status: 200, json: {} })
  })

  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot password?' }).click()

  const email = page.getByRole('textbox', { name: 'Email *' })
  const send = page.getByRole('button', { name: 'Send verification code' })
  await email.fill('researcher@example.test')
  await expect(send).toBeEnabled()

  await send.click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByLabel('Password reset code')).toBeVisible()
  expect(resetRequest.url()).toContain('/auth/v1/recover')
  expect(resetRequest.postDataJSON()).toMatchObject({
    email: 'researcher@example.test',
    gotrue_meta_security: { captcha_token: 'e2e-turnstile-token' },
  })
})

test('sign-in reports server-side CAPTCHA misconfiguration accurately', async ({ page }) => {
  await page.route('**/__e2e_supabase/**', (route) => route.fulfill({
    status: 400,
    json: {
      code: 400,
      error_code: 'captcha_failed',
      msg: 'captcha verification process failed',
    },
  }))

  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email *' }).fill('researcher@example.test')
  await page.getByLabel('Password *').fill('Example1!')
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByText(/Authentication security is misconfigured/)).toBeVisible()
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
          track: 'Web and Mobile Application Development',
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
  // The banner splits the label from its caveats across two spans, so assert
  // both halves: that guest mode is announced, and that it says history is not
  // kept. Matching one sentence would let either half regress unnoticed.
  await expect(page.getByText(/Guest Researcher/)).toBeVisible()
  await expect(page.getByText(/chats aren.t saved/)).toBeVisible()
  const composer = page.getByPlaceholder(/Ask IskAI about CCSICT thesis research/)
  await composer.fill('What methodology does the archived thesis use?')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(/retrieval-augmented generation architecture/)).toBeVisible()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()
  expect(chatPayload.department_filter).toBeNull()
  // The default chat request carries no category scope, keeping the frozen
  // unfiltered retrieval path in use unless a visitor opts in.
  expect(chatPayload.thesis_category_filter).toBeNull()
  expect(chatPayload.session_id).toBeNull()
  expect(chatPayload.question).toBe('What methodology does the archived thesis use?')

  await page.reload()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByText(/Guest Researcher/)).toBeVisible()
  await expect(page.getByText(/chats aren.t saved/)).toBeVisible()
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

  await expect(page.locator('#main-content').getByText('IskAI could not answer')).toBeVisible()
  await expect(composer).toHaveValue(question)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/retry succeeded/i)).toBeVisible()
  expect(attempts).toBe(2)
  expect(unexpected).toEqual([])
})

test('guest chat can stop waiting without losing the research question', async ({ page }) => {
  let attempts = 0
  const unexpected = await mockApi(page, {
    'POST /chat': async () => {
      attempts += 1
      await new Promise((resolve) => setTimeout(resolve, 10_000))
      return {
        answer: 'This late response should be discarded by the browser.',
        sources: [], no_relevant_thesis: true, history_saved: false,
      }
    },
  })

  await page.goto('/chat')
  const composer = page.getByPlaceholder(/Ask IskAI about CCSICT thesis research/)
  const question = 'Which studies used anomaly detection?'
  await composer.fill(question)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByRole('button', { name: 'Stop waiting for response' }).click()

  const recovery = page.locator('#main-content').getByRole('alert')
  await expect(recovery.getByText('Response stopped')).toBeVisible()
  await expect(recovery.getByText(`“${question}”`)).toBeVisible()
  await expect(composer).toHaveValue('')
  expect(attempts).toBe(1)
  expect(unexpected).toEqual([])
})

test('authenticated archive renders legacy-safe records and filters them', async ({ page }) => {
  await useAuthenticatedSession(page)
  const unexpected = await mockApi(page, {
    'GET /papers': [{
      id: 'paper-1',
      title: 'A Centralized AI-Powered Thesis Library',
      authors: 'A. Researcher, C. Researcher',
      adviser: 'Dr. Liza M. Bautista',
      abstract: 'A closed-domain RAG archive for campus research.',
      year: 2026,
      track: 'Web and Mobile Application Development',
      department: 'CCSICT',
      program_id: 'program-bsit',
      specialization_id: 'specialization-wmad',
      thesis_category: 'student',
      duplication_scan: null,
    }, {
      id: 'paper-2',
      title: 'Adaptive Irrigation Analytics for Isabela Farms',
      authors: 'F. Adviser',
      abstract: 'Faculty research output archived alongside student theses.',
      year: 2025,
      track: '',
      department: 'CCSICT',
      program_id: null,
      specialization_id: null,
      thesis_category: 'faculty',
      duplication_scan: null,
    }],
    'GET /upload/tracks': { tracks: ['Web and Mobile Application Development'] },
    'GET /catalog/departments/legacy': [{
      id: 'dept-1', name: 'CCSICT', track_label: 'Program / specialization',
      tracks: ['Web and Mobile Application Development'],
      programs: [{
        id: 'program-bsit', code: 'BSIT', name: 'Information Technology',
        specializations: [{ id: 'specialization-wmad', code: 'WMAD', name: 'Web and Mobile Application Development' }],
      }],
    }],
  })

  await page.goto('/archive')
  await expect(page.getByRole('heading', { name: /Thesis Archive/ })).toBeVisible()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()

  await page.getByRole('combobox', { name: 'Filter by academic program' }).click()
  await page.getByRole('option', { name: /BSIT/ }).click()
  await page.getByRole('combobox', { name: 'Filter by academic specialization' }).click()
  await page.getByRole('option', { name: /Web and Mobile/ }).click()
  await expect(page.getByText('Showing 1 of 2 indexed theses')).toBeVisible()

  await page.getByPlaceholder(/Search titles, authors, abstracts/).fill('missing topic')
  await expect(page.getByText('No matches found')).toBeVisible()
  await page.locator('#main-content').getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).toBeVisible()

  // The adviser is printed on the card and searchable by name. Searched by
  // surname, not by the word itself: paper-2's authors field is 'F. Adviser'.
  await expect(page.getByText('Adviser: Dr. Liza M. Bautista')).toBeVisible()
  await page.getByPlaceholder(/Search titles, authors, abstracts/).fill('Bautista')
  await expect(page.getByText('Showing 1 of 2 indexed theses')).toBeVisible()
  await expect(page.getByText('Adaptive Irrigation Analytics for Isabela Farms')).not.toBeVisible()
  // 'Clear filters' belongs to the no-matches panel; with results on screen the
  // page offers this control instead.
  await page.getByRole('button', { name: 'Clear active filters' }).click()
  await expect(page.getByText('Adaptive Irrigation Analytics for Isabela Farms')).toBeVisible()

  // The category filter separates faculty research from student theses, and
  // the faculty card carries its gold provenance badge.
  await page.getByRole('radio', { name: 'Faculty Research' }).click()
  await expect(page.getByText('Adaptive Irrigation Analytics for Isabela Farms')).toBeVisible()
  await expect(page.getByText('A Centralized AI-Powered Thesis Library')).not.toBeVisible()
  await expect(page.getByText('Showing 1 of 2 indexed theses')).toBeVisible()
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
  // Single mode is the default, so the page opens on the one-file dropzone.
  await expect(page.getByRole('radio', { name: 'Single' })).toHaveAttribute('aria-checked', 'true')
  await page.locator('input[aria-label="Choose a manuscript to scan"]').setInputFiles({
    name: 'proposal.txt', mimeType: 'text/plain', buffer: Buffer.from('A deterministic proposal fixture.'),
  })

  await expect(page.getByText('91.25%')).toBeVisible()
  await expect(page.getByText('25.00%')).toBeVisible()
  await expect(page.getByText('2 / 8')).toBeVisible()
  await expect(page.getByText('Review suggested')).toBeVisible()
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download report' }).click()
  await expect((await reportDownload).suggestedFilename()).toMatch(/^novelty-report-.*\.json$/)
  expect(unexpected).toEqual([])
})

test('faculty batch novelty scan works through a queue and opens each report', async ({ page }) => {
  await useAuthenticatedSession(page, {
    ...adminFixture,
    profile: { ...adminFixture.profile, role: 'faculty' },
    features: { faculty: { chat: true, archive: true, novelty: true, upload: false } },
  })
  const scanned = []
  const unexpected = await mockApi(page, {
    'GET /duplication/history': [],
    'POST /duplication/scan': (request) => {
      const body = request.postDataBuffer()?.toString('latin1') ?? ''
      const filename = body.match(/filename="([^"]+)"/)?.[1] ?? 'unknown'
      scanned.push(filename)
      // The second manuscript is refused, so the batch has to carry on past it.
      if (filename === 'second.txt') return { __status: 422, __body: { detail: 'Could not read any text from this manuscript.' } }
      return {
        id: `scan-${filename}`,
        filename,
        created_at: '2026-07-20T00:00:00Z',
        department: 'CCSICT',
        flagged: filename === 'first.txt',
        threshold: 85,
        highest_similarity: filename === 'first.txt' ? 91.25 : 40,
        matched_chunk_percentage: filename === 'first.txt' ? 25 : 0,
        matched_chunk_count: filename === 'first.txt' ? 2 : 0,
        total_chunks: 8,
        verdict_level: filename === 'first.txt' ? 'review_suggested' : 'clear',
        verdict_summary: `Summary for ${filename}.`,
        top_matches: [],
        matched_chunks: [],
        chat_log: [],
      }
    },
  })

  await page.goto('/novelty')
  await page.getByRole('radio', { name: 'Batch' }).click()
  await expect(page).toHaveURL(/mode=batch/)
  await page.locator('input[aria-label="Choose manuscripts to scan"]').setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('First deterministic proposal.') },
    { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('Second deterministic proposal.') },
    { name: 'third.txt', mimeType: 'text/plain', buffer: Buffer.from('Third deterministic proposal.') },
  ])
  const queue = page.getByRole('list', { name: 'Manuscripts in this batch' })
  await expect(queue.getByRole('listitem')).toHaveCount(3)

  await page.getByRole('button', { name: 'Scan 3 manuscripts' }).click()
  await expect(page.getByText('3 of 3 scanned')).toBeVisible()
  await expect(page.getByText('· 1 failed')).toBeVisible()
  await expect(page.getByText('Batch finished: 2 scanned, 1 failed')).toBeVisible()
  await expect(queue.getByText('Could not read any text from this manuscript.')).toBeVisible()
  // One after another, in the order they were queued.
  expect(scanned).toEqual(['first.txt', 'second.txt', 'third.txt'])

  // A finished row opens the same report a single scan shows.
  await page.getByRole('button', { name: 'View report for first.txt' }).click()
  await expect(page.getByText('91.25%')).toBeVisible()
  // The AI write-up sits behind its own tab, so the report opens short.
  await expect(page.getByText('Summary for first.txt.')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Explanation' }).click()
  await expect(page.getByText('Summary for first.txt.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'View report for first.txt' })).toContainText('Viewing')

  // The failed file can be retried without re-adding it.
  await page.getByRole('button', { name: 'Retry failed' }).click()
  await expect(page.getByRole('button', { name: 'Scan 1 manuscript' })).toBeEnabled()
  expect(unexpected).toEqual([])
})

test('faculty capsule proposal is checked section by section', async ({ page }) => {
  await useAuthenticatedSession(page, {
    ...adminFixture,
    profile: { ...adminFixture.profile, role: 'faculty' },
    features: { faculty: { chat: true, archive: true, novelty: true, upload: false } },
  })
  let submitted = null
  const unexpected = await mockApi(page, {
    'GET /duplication/history': [],
    'POST /duplication/capsule': (request) => {
      submitted = request.postDataJSON()
      return {
        id: 'capsule-1',
        filename: submitted.title,
        created_at: '2026-09-23T00:00:00Z',
        department: 'CCSICT',
        highest_similarity: 92,
        matched_chunk_percentage: 50,
        matched_chunk_count: 1,
        total_chunks: 2,
        verdict_level: 'review_suggested',
        top_matches: [{ id: 'p1', title: 'SECURE: A Smart Intruder Detection System', authors: 'R. Gumpal', year: 2024, track: 'BSCS', match_count: 1, similarity: 92 }],
        verdict_summary: '### Capsule screening: Review suggested',
        chat_log: [],
        capsule_sections: [
          { key: 'title', label: 'Working title', words: 6, similarity: 92, flagged: true, basis: 'wording',
            closest: { id: 'p1', title: 'SECURE: A Smart Intruder Detection System', authors: 'R. Gumpal', year: 2024, track: 'BSCS' } },
          { key: 'methodology', label: 'Methodology', words: 14, similarity: 0, flagged: false, basis: 'meaning', closest: null },
        ],
      }
    },
  })

  await page.goto('/novelty')
  await page.getByRole('radio', { name: 'Capsule' }).click()
  await expect(page).toHaveURL(/mode=capsule/)
  const form = page.getByRole('form', { name: 'Capsule proposal' })
  await form.getByLabel('Working title').fill('A Smart Intruder Detection System')
  // A title alone is not enough; the form says so instead of spending a request.
  await form.getByRole('button', { name: 'Check capsule' }).click()
  await expect(form.getByText(/at least one of the rationale/)).toBeVisible()
  expect(submitted).toBeNull()

  await form.getByLabel('Methodology').fill('YOLO object detection trained on a locally gathered CCTV dataset, evaluated with mAP.')
  await form.getByRole('button', { name: 'Check capsule' }).click()

  const report = page.getByRole('region', { name: /Novelty report for A Smart Intruder Detection System/ })
  await expect(report.getByText(/Capsule proposal ·/)).toBeVisible()
  await expect(report.getByText('1 / 2')).toBeVisible()
  const sections = report.getByRole('list', { name: 'Capsule sections' })
  await expect(sections.getByRole('listitem')).toHaveCount(2)
  await expect(sections.getByText('Flagged')).toBeVisible()
  await expect(sections.getByText('No archived thesis is closely similar.')).toBeVisible()
  // Exactly the four capsule fields go to the server.
  expect(Object.keys(submitted).sort()).toEqual(['methodology', 'objectives', 'rationale', 'title'])
  expect(unexpected).toEqual([])
})

test('a capsule file fills the form for review and asks before replacing typed text', async ({ page }) => {
  await useAuthenticatedSession(page, {
    ...adminFixture,
    profile: { ...adminFixture.profile, role: 'faculty' },
    features: { faculty: { chat: true, archive: true, novelty: true, upload: false } },
  })
  let uploads = 0
  const unexpected = await mockApi(page, {
    'GET /duplication/history': [],
    'POST /duplication/capsule/extract': () => {
      uploads += 1
      return {
        title: 'SECURE: A Smart Intruder Detection System',
        rationale: 'Property owners lack affordable monitoring that recognises intruders.',
        objectives: '',
        methodology: 'YOLO object detection trained on a locally gathered CCTV dataset.',
        detected_sections: ['title', 'rationale', 'methodology'],
      }
    },
  })

  await page.goto('/novelty?mode=capsule')
  const form = page.getByRole('form', { name: 'Capsule proposal' })
  const choose = form.locator('input[aria-label="Choose a capsule file"]')
  const docx = { name: 'capsule.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK docx') }

  // A legacy .doc is refused in the browser with the way to fix it.
  await choose.setInputFiles({ name: 'capsule.doc', mimeType: 'application/msword', buffer: Buffer.from('doc') })
  await expect(page.getByText(/Save the capsule as a \.docx/)).toBeVisible()
  expect(uploads).toBe(0)

  await choose.setInputFiles(docx)
  await expect(form.getByLabel('Working title')).toHaveValue('SECURE: A Smart Intruder Detection System')
  await expect(form.getByLabel('Methodology')).toHaveValue(/YOLO object detection/)
  await expect(form.getByText(/Filled the working title, rationale and significance and methodology from capsule\.docx/)).toBeVisible()
  // The file had no objectives, so what is there is kept (empty here).
  await expect(form.getByLabel('Research questions / objectives')).toHaveValue('')

  // Typing over a section, then uploading again, asks first.
  await form.getByLabel('Working title').fill('My own working title')
  await choose.setInputFiles(docx)
  await expect(page.getByRole('heading', { name: 'Replace what you typed?' })).toBeVisible()
  await expect(page.getByText(/capsule\.docx has its own working title/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(form.getByLabel('Working title')).toHaveValue('My own working title')
  expect(uploads).toBe(2)
  expect(unexpected).toEqual([])
})

test('administrator upload journey resumes a retrying durable job after refresh', async ({ page }) => {
  await useAuthenticatedSession(page)
  let acceptedKey
  let acceptedBody = ''
  let statusChecks = 0
  // The job must stay in retry_wait until the page has actually been reloaded,
  // so this counts document loads rather than status polls. Keying completion
  // off `statusChecks === 1` made the test a wall-clock race it lost on a loaded
  // CI runner: Upload.jsx polls at +500ms and then every 1500ms, so the reload
  // had to happen inside a 1.5s window. Miss it and the second poll returns
  // completed, Upload.jsx clears sessionStorage.activeUploadJob, and the
  // reloaded page has no job left to resume -- which is the opposite of what
  // this test exists to prove. The listener is attached after the session
  // helper so only navigations from here on are counted: 1 is the goto below,
  // 2 is the reload.
  let pageLoads = 0
  let extendedCalls = 0
  page.on('load', () => { pageLoads += 1 })
  const unexpected = await mockApi(page, {
    'GET /catalog/departments/legacy': [{
      id: 'dept-1', name: 'CCSICT', track_label: 'Program / specialization',
      tracks: ['Web and Mobile Application Development'],
      programs: [{
        id: 'program-bsit', code: 'BSIT', name: 'Bachelor of Science in Information Technology',
        specializations: [{ id: 'specialization-wmad', code: 'WMAD', name: 'Web and Mobile Application Development' }],
      }],
    }],
    'POST /upload/extract-metadata': {
      title: 'Deterministic E2E Thesis', authors: 'A. Researcher, C. Researcher', year: 2026,
      adviser: 'Dr. Liza M. Bautista',
      abstract: 'The abstract exactly as the manuscript prints it.',
    },
    'POST /upload/extended-abstract': () => {
      extendedCalls += 1
      return {
        abstract: 'A longer summary Gemini wrote from the whole manuscript.',
        extended: true,
      }
    },
    'POST /upload/paper': (request) => {
      acceptedKey = request.headers()['idempotency-key']
      acceptedBody = request.postDataBuffer()?.toString('utf8') ?? ''
      return {
        job_id: 'job-1', idempotency_key: acceptedKey,
        status: 'queued', message: 'Queued',
      }
    },
    'GET /upload/status/job-1': () => {
      statusChecks += 1
      if (pageLoads < 2) {
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

  // The abstract control, on the step that reads the manuscript. Switching to
  // the extended text fetches it once; switching back is local, which is what
  // keeps a second flip from spending a second generation.
  await page.getByRole('radio', { name: 'AI extended' }).check()
  await expect(page.getByText('Extended abstract ready')).toBeVisible()
  await page.getByRole('radio', { name: 'In document' }).check()
  await page.getByRole('radio', { name: 'AI extended' }).check()
  expect(extendedCalls).toBe(1)

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('button', { name: /Abstract/ })).toContainText('Written by AI')

  await page.getByRole('combobox', { name: 'Select academic program' }).click()
  await page.getByRole('option', { name: /BSIT/ }).click()
  await page.getByRole('combobox', { name: 'Select academic specialization' }).click()
  await page.getByRole('option', { name: /Web and Mobile/ }).click()
  await page.getByRole('button', { name: 'Review' }).click()
  await expect(page.getByText('Deterministic E2E Thesis')).toBeVisible()
  // The wizard defaults every manuscript to a student thesis.
  await expect(page.getByText('Student Thesis')).toBeVisible()
  // Asserted here and not earlier: the manuscript step's extracted-details
  // card and the metadata form both show the autofilled adviser too.
  await expect(page.getByText('Dr. Liza M. Bautista')).toBeVisible()
  await page.getByRole('button', { name: /Ingest into archive/ }).click()

  await expect(page.getByText(/Temporary service interruption/)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Cancel upload' })).toBeVisible()
  expect(acceptedKey).toMatch(/^[0-9a-f-]{36}$/)
  expect(acceptedBody).toMatch(/name="adviser"\r\n\r\nDr\. Liza M\. Bautista\r\n/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Thesis indexed!' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/22 embedded chunks/)).toBeVisible()
  expect(statusChecks).toBeGreaterThanOrEqual(2)
  expect(unexpected).toEqual([])
})

test('administrator batch upload journey stages several manuscripts and polls them together', async ({ page }) => {
  await useAuthenticatedSession(page)
  let submittedBody = ''
  let submittedRows = null
  let jobPolls = 0
  const unexpected = await mockApi(page, {
    'GET /catalog/departments/legacy': [{
      id: 'dept-1', name: 'CCSICT', track_label: 'Program / specialization',
      tracks: ['Web and Mobile Application Development'],
      programs: [
        {
          id: 'program-bsit', code: 'BSIT', name: 'Bachelor of Science in Information Technology',
          specializations: [{ id: 'specialization-wmad', code: 'WMAD', name: 'Web and Mobile Application Development' }],
        },
        {
          id: 'program-bsis', code: 'BSIS', name: 'Bachelor of Science in Information Systems',
          specializations: [],
        },
      ],
    }],
    // Two manuscripts from two degrees, which is the shape a shelf of theses
    // actually has and the reason the program is read per title page.
    'POST /upload/batch/extract-metadata': {
      files: [
        { index: 0, filename: 'first.pdf', title: 'First Deterministic Thesis', authors: 'A. Researcher', adviser: 'Dr. Liza M. Bautista', year: '2026', department: 'CCSICT', program_code: 'BSIT', specialization_code: 'WMAD' },
        { index: 1, filename: 'second.pdf', title: 'Second Deterministic Thesis', authors: 'B. Researcher', year: '2025', department: 'CCSICT' },
      ],
    },
    'POST /upload/batch': (request) => {
      submittedBody = request.postDataBuffer()?.toString('latin1') ?? ''
      const match = submittedBody.match(/name="rows"\r\n\r\n([\s\S]*?)\r\n--/)
      submittedRows = match ? JSON.parse(match[1]) : null
      return {
        accepted: 2, rejected: 0,
        results: [
          { index: 0, filename: 'first.pdf', idempotency_key: submittedRows?.[0]?.idempotency_key, job_id: 'job-a', status: 'queued', message: 'Queued' },
          { index: 1, filename: 'second.pdf', idempotency_key: submittedRows?.[1]?.idempotency_key, job_id: 'job-b', status: 'queued', message: 'Queued' },
        ],
      }
    },
    'GET /upload/jobs': () => {
      jobPolls += 1
      if (jobPolls === 1) {
        return {
          jobs: [
            { job_id: 'job-a', status: 'processing', stage: 'embed', progress: 58, message: 'Embedding chunks', attempt_count: 1, max_attempts: 3, can_cancel: true, cancel_requested: false },
            { job_id: 'job-b', status: 'queued', stage: 'download', progress: 8, message: 'Queued', attempt_count: 0, max_attempts: 3, can_cancel: true, cancel_requested: false },
          ],
        }
      }
      return {
        jobs: [
          { job_id: 'job-a', status: 'completed', stage: 'done', progress: 100, message: 'Indexed', chunks: 22, attempt_count: 1, max_attempts: 3, can_cancel: false, cancel_requested: false },
          { job_id: 'job-b', status: 'completed', stage: 'done', progress: 100, message: 'Indexed', chunks: 17, attempt_count: 1, max_attempts: 3, can_cancel: false, cancel_requested: false },
        ],
      }
    },
  })

  await page.goto('/upload/batch')
  await expect(page.getByRole('heading', { name: /Batch/, level: 1 })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%e2e first\n%%EOF') },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%e2e second\n%%EOF') },
  ])
  await expect(page.getByText('2 / 20 manuscripts selected')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Metadata autofilled')).toBeVisible()

  await expect(page.getByLabel('Title for first.pdf')).toHaveValue('First Deterministic Thesis')
  await expect(page.getByLabel('Title for second.pdf')).toHaveValue('Second Deterministic Thesis')
  await expect(page.getByLabel('Year for second.pdf')).toHaveValue('2025')
  // Fix one row by hand: the review table is editable per manuscript.
  await page.getByLabel('Authors for second.pdf').fill('B. Researcher, D. Researcher')
  await expect(page.getByLabel('Adviser for first.pdf')).toHaveValue('Dr. Liza M. Bautista')
  await page.getByLabel('Adviser for second.pdf').fill('Engr. Carlo M. Ramos')

  // The first title page named its degree, so that row is already classified.
  await expect(page.getByRole('combobox', { name: 'Program for first.pdf' })).toContainText('BSIT')
  await expect(page.getByRole('combobox', { name: 'Specialization for first.pdf' })).toContainText('WMAD')
  // The second page named none, so its row waits to be told rather than
  // inheriting whatever the manuscript beside it happens to be.
  await expect(page.getByRole('combobox', { name: 'Program for second.pdf' })).toContainText('Select program')

  // The unclassified row blocks only itself, and says so beside that row rather
  // than above the whole table.
  await page.getByRole('button', { name: /Ingest 2 manuscripts/ }).click()
  await expect(page.getByText('Select the academic program')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Program for first.pdf' })).toContainText('BSIT')

  // The bulk control is how a shelf that really does share one degree is set.
  await page.getByRole('combobox', { name: 'Select a program for every manuscript' }).click()
  await page.getByRole('option', { name: /BSIS/ }).click()
  await page.getByRole('button', { name: 'Apply to all rows' }).click()
  await expect(page.getByRole('combobox', { name: 'Program for first.pdf' })).toContainText('BSIS')
  await expect(page.getByRole('combobox', { name: 'Program for second.pdf' })).toContainText('BSIS')
  // BSIS takes no specialization, so neither row asks for one any more.
  await expect(page.getByRole('combobox', { name: 'Specialization for first.pdf' })).toHaveCount(0)

  // Put the first manuscript back under the degree its title page named, so the
  // batch that is submitted really does carry two programs at once.
  await page.getByRole('combobox', { name: 'Program for first.pdf' }).click()
  await page.getByRole('option', { name: /BSIT/ }).click()
  await page.getByRole('combobox', { name: 'Specialization for first.pdf' }).click()
  // The row cells list codes, not the prose names: five degrees down a twenty
  // row table, the code is the part that differs.
  await page.getByRole('option', { name: 'WMAD', exact: true }).click()

  await page.getByRole('button', { name: /Ingest 2 manuscripts/ }).click()

  await expect(page.getByRole('region', { name: 'Batch summary' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Batch indexed!')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/2 of 2 manuscripts are now part of the semantic archive/)).toBeVisible()
  await expect(page.locator('tbody').getByText('Indexed', { exact: true })).toHaveCount(2)
  await expect(page.getByText('22 embedded chunks')).toBeVisible()

  expect(submittedRows).toHaveLength(2)
  expect(submittedRows[0].title).toBe('First Deterministic Thesis')
  expect(submittedRows[1].authors).toBe('B. Researcher, D. Researcher')
  expect(submittedRows[0].adviser).toBe('Dr. Liza M. Bautista')
  expect(submittedRows[1].adviser).toBe('Engr. Carlo M. Ramos')
  expect(submittedRows[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
  expect(submittedRows[1].idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
  expect(submittedRows[0].idempotency_key).not.toBe(submittedRows[1].idempotency_key)
  // The classification travels per row now, not as one field for the request.
  expect(submittedRows[0].program_id).toBe('program-bsit')
  expect(submittedRows[0].specialization_id).toBe('specialization-wmad')
  expect(submittedRows[1].program_id).toBe('program-bsis')
  expect(submittedBody).not.toContain('name="program_id"')
  expect(submittedBody).toContain('filename="first.pdf"')
  expect(submittedBody).toContain('filename="second.pdf"')
  expect(jobPolls).toBeGreaterThanOrEqual(2)
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
