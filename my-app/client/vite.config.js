import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    // Serve the API from the same origin as the app, so the browser never
    // needs to reach port 3001 directly (and never needs CORS).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
    // Allow the hosted domain that fronts port 8080.
    allowedHosts: true,
  },
})
