import { createServer } from 'vite'

const server = await createServer({
  mode: 'e2e',
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
})

await server.listen()

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  await server.close()
  process.exit(0)
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
process.once('SIGHUP', close)
