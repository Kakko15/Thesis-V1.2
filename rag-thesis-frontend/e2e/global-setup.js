import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Clear the accessibility findings shards once per run.
 *
 * The accessibility matrix writes one shard per surface because Playwright
 * starts a fresh worker process after every test failure, which would
 * otherwise discard in-memory results. Clearing the directory here — once,
 * before any worker starts — keeps a renamed or removed surface from leaving
 * a stale shard that would silently pad the merged report.
 */
export default async function globalSetup() {
  await rm(fileURLToPath(new URL('../test-results/axe-shards/', import.meta.url)), {
    recursive: true,
    force: true,
  })
}
