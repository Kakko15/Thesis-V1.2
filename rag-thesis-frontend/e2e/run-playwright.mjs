import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const root = new URL('..', import.meta.url)
const server = spawn(process.execPath, ['e2e/vite-server.mjs'], {
  cwd: root,
  stdio: ['pipe', 'inherit', 'inherit'],
})

let serverExited = false
server.once('exit', () => { serverExited = true })

async function waitForServer() {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('The E2E web server stopped before becoming ready')
    try {
      const response = await fetch('http://127.0.0.1:4173')
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the E2E web server')
}

async function stopServer() {
  if (serverExited) return
  server.stdin.write('close\n')
  server.stdin.end()
  await Promise.race([once(server, 'exit'), delay(5_000)])
  if (!serverExited) server.kill()
}

let exitCode = 1
try {
  await waitForServer()
  const playwright = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_REUSE_SERVER: '1' },
      stdio: 'inherit',
    },
  )
  const [code] = await once(playwright, 'exit')
  exitCode = code ?? 1
} finally {
  await stopServer()
}

process.exitCode = exitCode
