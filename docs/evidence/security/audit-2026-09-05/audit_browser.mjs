/** Reproduce cross-account cached scan disclosure using synthetic E2E identities.
 * Requires the existing dist-e2e build produced by npm run test:e2e.
 * Every backend/auth response is local; external browser requests are blocked.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const frontend = new URL('../../../../rag-thesis-frontend/', import.meta.url)
const { preview } = await import(new URL('node_modules/vite/dist/node/index.js', frontend))
const { chromium, expect } = await import(new URL('node_modules/@playwright/test/index.mjs', frontend))
const fixtureKey = 'isu_e2e_auth_fixture'
const fixture = (id, name) => ({
  user: { id, email: `${name.toLowerCase()}@example.test`, user_metadata: { full_name: name } },
  profile: { role: 'faculty', full_name: name, department: 'CCSICT', status: 'approved' },
  features: { faculty: { chat: true, archive: true, novelty: true, upload: false } },
})
const alice = fixture('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice')
const bob = fixture('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob')
const server = await preview({
  root: fileURLToPath(frontend), configFile: fileURLToPath(new URL('vite.config.js', frontend)),
  mode: 'e2e', build: { outDir: 'dist-e2e' },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
})
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1536, height: 960 } })
  let scanRequests = 0
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem('isu-thesis-preferences-v2', JSON.stringify({
      theme: 'light', palette: 'isu', motion: 'reduced', effects: 'low', contrast: 'standard',
    }))
  }, { key: fixtureKey, value: alice })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/__e2e_supabase/')) {
      return route.fulfill({ json: {
        access_token: 'synthetic-audit-token', refresh_token: 'synthetic-audit-refresh',
        token_type: 'bearer', expires_in: 3600, user: bob.user,
      } })
    }
    if (url.pathname.startsWith('/__e2e_api/')) {
      const path = url.pathname.replace('/__e2e_api', '')
      let response = []
      if (path === '/health') response = { status: 'ok', checks: { api: 'ok', database: 'ok' } }
      if (path === '/settings/public') response = { evaluation_department: 'CCSICT' }
      if (path === '/analytics/summary') response = { papers: 0, departments: 1, tracks: 0 }
      if (path === '/duplication/history') {
        scanRequests += 1
        response = scanRequests === 1 ? [{
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', filename: 'ALICE-PRIVATE-DRAFT.pdf',
          department: 'CCSICT', duplication_percentage: 0, highest_similarity: 0,
          matched_chunk_percentage: 0, matched_chunk_count: 0, total_chunks: 1,
          verdict_level: 'clear', verdict_summary: 'Alice confidential research notes.',
          top_matches: [], chat_log: [], created_at: '2026-09-05T00:00:00Z',
        }] : []
      }
      return route.fulfill({ json: response })
    }
    if (url.origin === 'http://127.0.0.1:4174') return route.continue()
    return route.abort()
  })
  const navigateWithinApp = async (path) => page.evaluate((target) => {
    history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.goto('http://127.0.0.1:4174/novelty')
  await expect(page.getByText('ALICE-PRIVATE-DRAFT.pdf', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Log out', exact: true }).first().click()
  await expect(page).toHaveURL('http://127.0.0.1:4174/')
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: fixtureKey, value: bob })
  await navigateWithinApp('/login')
  await page.getByRole('textbox', { name: 'Email *' }).fill(bob.user.email)
  await page.getByLabel('Password *', { exact: true }).fill('SyntheticPassword1!')
  await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Email me a code', { exact: true })).toBeVisible()
  await navigateWithinApp('/novelty')
  await expect(page.getByText('Bob', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('ALICE-PRIVATE-DRAFT.pdf', { exact: true })).toBeVisible()
  assert.equal(scanRequests, 1, 'Bob received cached Alice data without a new history request')
  await page.getByText('ALICE-PRIVATE-DRAFT.pdf', { exact: true }).click()
  await expect(page.getByText('Alice confidential research notes.', { exact: true })).toBeVisible()
  // Let the route/report entrance animations settle for legible evidence.
  await page.waitForTimeout(1200)
  await page.screenshot({ path: fileURLToPath(new URL('cross-account-cache.png', import.meta.url)), fullPage: true })
  const result = {
    reproduced: true, authenticated_display_name: 'Bob',
    visible_previous_account_file: 'ALICE-PRIVATE-DRAFT.pdf',
    visible_previous_account_summary: 'Alice confidential research notes.',
    backend_history_requests: scanRequests, identity_and_backend: 'synthetic E2E fixtures',
  }
  await writeFile(new URL('browser-reproduction.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
