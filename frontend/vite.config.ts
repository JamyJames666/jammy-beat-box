import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // In dev, proxy /api to the running bot so you can use `npm run dev`
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    // Output directly into the existing static/ folder — no changes to web-server.ts needed
    outDir: '../static',
    emptyOutDir: true,
  },
})
