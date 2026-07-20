import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:8000'

// Keep initial page loads quiet while FastAPI is still starting/reloading.
// This endpoint always answers from Vite, so readiness polling never creates
// browser-console 502 errors. Real API requests begin only after /health is OK.
function backendReadiness() {
  return {
    name: 'backend-readiness',
    configureServer(server) {
      server.middlewares.use('/__backend-ready', async (_req, res) => {
        let ready = false
        try {
          const response = await fetch(`${BACKEND}/health`, {
            signal: AbortSignal.timeout(1000),
          })
          ready = response.ok
        } catch {
          // The frontend polls this safe endpoint until FastAPI is ready.
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ ready }))
      })
    },
  }
}

// `/chat` and `/upload` are both React pages and backend API prefixes. Browser
// navigation requests HTML, so keep those inside Vite and let the SPA history
// fallback serve index.html. JSON and multipart API requests still proxy to
// FastAPI.
const spaAwareApiProxy = {
  target: BACKEND,
  changeOrigin: true,
  bypass(req) {
    if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
      return '/index.html'
    }
  },
}

function e2eApiGuard() {
  return {
    name: 'e2e-api-guard',
    configureServer(server) {
      server.middlewares.use('/__e2e_api', (_req, res) => {
        res.statusCode = 501
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ detail: 'Unmocked E2E API request' }))
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [backendReadiness(), ...(mode === 'e2e' ? [e2eApiGuard()] : []), react(), tailwindcss()],
  define: mode === 'e2e' ? {
    'import.meta.env.VITE_API_URL': JSON.stringify('/__e2e_api'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:4173/__e2e_supabase'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('deterministic-e2e-anon-key'),
  } : undefined,
  // R3F breaks silently if two copies of three end up in the module graph.
  resolve: { dedupe: ['three'] },
  server: {
    proxy: {
      '/upload': spaAwareApiProxy,
      '/chat': spaAwareApiProxy,
      '/papers': BACKEND,
      '/health': BACKEND,
      '/sessions': BACKEND,
      '/duplication': BACKEND,
      '/analytics': BACKEND,
      '/departments': BACKEND,
      '/settings': BACKEND,
    },
  },
  build: {
    // The optional WebGL scene is lazy-loaded after capability/visibility
    // checks; its Three.js dependency is never part of the initial app bundle.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // NOTE: no manual groups for lazy-only libs (three.js, recharts) —
          // rolldown groups capture dependency subtrees, which drags shared
          // deps (scheduler, clsx) into the group and makes the entry eagerly
          // preload the whole thing. The lazy() route/scene boundaries already
          // keep them out of the initial load; rolldown auto-splits them.
          if (id.includes('framer-motion')) return 'motion'
          // scheduler is shared by react-dom (eager) and react-reconciler (three
          // chunk) — keep it in vendor or the entry would eagerly pull three.
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom') || id.includes('scheduler')) return 'vendor'
          return undefined
        },
      },
    },
  },
}))
