import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against the shared sources so `npm test` works without building shared first.
    alias: { '@eco/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
