import type { Plugin } from 'vite';
import { createMockApiHandler } from './state';

/**
 * Dev-only mock of the Label Studio API (server/src equivalent lives elsewhere).
 * Enabled via VITE_MOCK_API=1 — see vite.config.ts. Registered in
 * configureServer so it runs before Vite's own middleware and can answer every
 * `/api/*` and `/ca.crt` request without a real backend.
 */
export function mockApiPlugin(): Plugin {
  const handler = createMockApiHandler();
  return {
    name: 'eco-mock-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
  };
}
