import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mockApiPlugin } from './mock/plugin';

/**
 * pdf.js fetches its standard fonts and wasm decoders by URL at runtime
 * (src/import/pdf.ts). Serve them from node_modules in dev and copy them to
 * dist/pdfjs/ in the build.
 */
function pdfjsAssetsPlugin(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const dirs = ['standard_fonts', 'wasm'];
  return {
    name: 'eco-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const [dir, file, ...rest] = (req.url ?? '').split('?')[0]!.split('/').filter(Boolean);
        const filePath = dir && file && !rest.length && dirs.includes(dir) && /^[\w.-]+$/.test(file) ? path.join(root, dir, file) : null;
        if (!filePath || !fs.existsSync(filePath)) return next();
        res.setHeader('Content-Type', file!.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const file of fs.readdirSync(path.join(root, dir))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${file}`, source: fs.readFileSync(path.join(root, dir, file)) });
        }
      }
    },
  };
}

/** Where the real Label Studio server listens in development. */
const DEV_SERVER = 'http://localhost:5174';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMock = env.VITE_MOCK_API === '1';

  return {
    plugins: [react(), tailwindcss(), pdfjsAssetsPlugin(), useMock && mockApiPlugin()],
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
