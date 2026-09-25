import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@eco/shared': path.resolve(import.meta.dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
