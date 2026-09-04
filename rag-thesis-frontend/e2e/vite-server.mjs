import { build, preview } from 'vite'

// The suite runs against the built bundle rather than the dev server. The dev
// server transformed modules on demand, and that single-threaded work — not the
// browser — was the bottleneck: it capped the benefit of running Playwright on
// more than one worker, since every worker queued behind the same transforms.
//
// The output goes to dist-e2e, never dist: the production `npm run build` is
// what the bundle-size budget measures, and an E2E-mode build must not stand in
// for it. `--mode e2e` keeps `import.meta.env.MODE === 'e2e'`, which is what
// switches the app onto its deterministic test fixtures.
const OUT_DIR = 'dist-e2e'

await build({
  mode: 'e2e',
  logLevel: 'warn',
  build: { outDir: OUT_DIR },
})

const server = await preview({
  mode: 'e2e',
  build: { outDir: OUT_DIR },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  if (typeof server.close === 'function') {
    await server.close()
  } else {
    server.httpServer.close()
  }
  process.exit(0)
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
process.once('SIGHUP', close)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (value) => {
  if (value.trim() === 'close') close()
})
process.stdin.once('end', close)
