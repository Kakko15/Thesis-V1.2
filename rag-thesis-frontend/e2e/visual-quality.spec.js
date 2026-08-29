import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const VIEWPORTS = [360, 768, 1280, 1536]
const ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/login', name: 'authentication' },
  { path: '/chat', name: 'guest-chat' },
]
const evidenceDir = fileURLToPath(new URL('../../docs/evidence/visual-baselines/', import.meta.url))

async function mockPublicApi(page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }))
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.turnstile = {
      render: (element, options) => {
        element.textContent = 'Security verification test';
        options.callback?.('e2e-turnstile-token');
        return 'e2e-turnstile-widget';
      },
      remove: () => {},
    };`,
  }))
  await page.route('**/__e2e_api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace('/__e2e_api', '')
    const responses = {
      '/analytics/summary': {
        total_papers: 50, total_tracks: 5, total_queries: 1200,
        year_range: { from: 2019, to: 2026 },
      },
      '/settings/public': { evaluation_department: 'CCSICT' },
      '/upload/tracks': { tracks: ['Data Mining', 'WMAD', 'NETSEC'] },
      '/catalog/departments/legacy': [{
        id: 'dept-ccsict', name: 'CCSICT', track_label: 'Program / specialization',
        tracks: ['Data Mining', 'WMAD', 'NETSEC'], programs: [],
      }],
    }
    await route.fulfill({ status: 200, json: responses[pathname] ?? [] })
  })
}

test('public critical surfaces pass the four-viewport structural quality matrix', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await mockPublicApi(page)
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  if (process.env.CAPTURE_VISUAL_EVIDENCE === '1') await mkdir(evidenceDir, { recursive: true })

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ROUTES) {
      await page.goto(route.path)
      await expect(page.locator('main')).toBeVisible()
      await expect(page.locator('h1'), `${route.name} must finish rendering its page heading`).toHaveCount(1)
      const audit = await page.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
        }
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean)
        const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
        const unnamedControls = [...document.querySelectorAll('button, a, input, select, textarea')]
          .filter(visible)
          .filter((element) => !(
            element.getAttribute('aria-label')
            || element.getAttribute('aria-labelledby')
            || element.getAttribute('title')
            || element.getAttribute('placeholder')
            || element.labels?.length
            || element.textContent.trim()
            || (element.tagName === 'INPUT' && element.type === 'hidden')
          ))
          .map((element) => element.outerHTML.slice(0, 160))
        const imagesWithoutAlt = [...document.querySelectorAll('img')]
          .filter(visible)
          .filter((image) => !image.hasAttribute('alt'))
          .map((image) => image.src)
        return {
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          duplicateIds,
          unnamedControls,
          imagesWithoutAlt,
          h1Count: document.querySelectorAll('h1').length,
        }
      })

      expect(audit.horizontalOverflow, `${route.name} overflow at ${width}px`).toBeLessThanOrEqual(1)
      expect(audit.duplicateIds, `${route.name} duplicate IDs at ${width}px`).toEqual([])
      expect(audit.unnamedControls, `${route.name} unnamed controls at ${width}px`).toEqual([])
      expect(audit.imagesWithoutAlt, `${route.name} images missing alt at ${width}px`).toEqual([])
      expect(audit.h1Count, `${route.name} h1 count at ${width}px`).toBe(1)

      const captureRoute = route.name === 'landing' || width === 360 || width === 1536
      if (process.env.CAPTURE_VISUAL_EVIDENCE === '1' && captureRoute) {
        await page.screenshot({
          path: `${evidenceDir}/${route.name}-${width}.png`,
          animations: 'disabled',
        })
      }
    }
  }
  expect(consoleErrors).toEqual([])
})
