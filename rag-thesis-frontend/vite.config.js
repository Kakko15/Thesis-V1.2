import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:8000'

// `/chat` is both a React page and a backend POST endpoint. Browser navigation
// requests HTML, so keep those inside Vite and let the SPA history fallback
// serve index.html. API requests continue through the backend proxy.
const chatProxy = {
  target: BACKEND,
  changeOrigin: true,
  bypass(req) {
    if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
      return '/index.html'
    }
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // R3F breaks silently if two copies of three end up in the module graph.
  resolve: { dedupe: ['three'] },
  server: {
    proxy: {
      '/upload': BACKEND,
      '/chat': chatProxy,
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
})
