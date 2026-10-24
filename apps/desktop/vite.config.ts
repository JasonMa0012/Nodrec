import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true, port: 1420, host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/target/**'] },
  },
})
