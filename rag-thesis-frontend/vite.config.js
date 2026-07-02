import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/upload': BACKEND,
      '/chat': BACKEND,
      '/papers': BACKEND,
      '/health': BACKEND,
      '/sessions': BACKEND,
      '/duplication': BACKEND,
      '/analytics': BACKEND,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom')) return 'vendor'
          return undefined
        },
      },
    },
  },
})
