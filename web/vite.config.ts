import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mockApiPlugin } from './mock/plugin';

/** Where the real Label Studio server listens in development. */
const DEV_SERVER = 'http://localhost:5174';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMock = env.VITE_MOCK_API === '1';

  return {
    plugins: [react(), tailwindcss(), useMock && mockApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        // Use the contract source directly so the web app never depends on a stale shared/dist.
        '@eco/shared': path.resolve(import.meta.dirname, '../shared/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      proxy: useMock
        ? undefined
        : {
            '/api': { target: DEV_SERVER, changeOrigin: true },
            '/ca.crt': { target: DEV_SERVER, changeOrigin: true },
          },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/fabric')) return 'fabric';
            if (id.includes('node_modules/bwip-js')) return 'bwip';
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
            return undefined;
          },
        },
      },
    },
  };
});
