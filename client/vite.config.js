import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Without this Vite quietly moves to 5174 when a stale dev server still
    // holds 5173, so you end up editing one app and reloading another. Failing
    // loudly makes the leftover process obvious instead of invisible.
    strictPort: true,
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
    // The default 5s is far too tight for forms with 15+ fields where
    // userEvent simulates a real keystroke per character — CreateCampPage
    // alone spends ~18s typing. Under full-suite contention that stretches
    // further, so the cap is set well above the observed worst case rather
    // than just above it.
    testTimeout: 45_000,
  },
});
