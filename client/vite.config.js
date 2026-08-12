import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev, so the refresh cookie is sent without CORS exemptions.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // The default 5s is too tight for forms with 15+ fields where userEvent
    // simulates real keystrokes per field (e.g. CreateCampPage's ~13s run).
    testTimeout: 20_000,
  },
});
