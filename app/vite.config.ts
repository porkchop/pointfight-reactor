import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `server.host: true` and `preview.host: true` bind to 0.0.0.0 so the phone
// companion page (Phase 2b.1+ /phone route) can reach the laptop over LAN.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
}))
