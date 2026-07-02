import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/upload': 'http://localhost:8000',
      '/chat': 'http://localhost:8000',
      '/papers': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
      '/duplication': 'http://localhost:8000',
    }
  }
})
