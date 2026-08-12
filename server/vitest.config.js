import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.js'],
    // One shared process so the in-memory replica set starts once, not per file.
    pool: 'forks',
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
