// Builds the Fastify application (routes, validation, error handling, static files).
// Listening and TLS live in server.ts so tests can drive this with app.inject().

import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { ApiError } from '@eco/shared';
import { createContext, type AppContext, type ContextOptions } from './context.js';
import { HttpError } from './errors.js';
import { isAllowedOrigin } from './http/guards.js';
import { adminRoutes } from './routes/admin.js';
import { designRoutes } from './routes/designs.js';
import { miscRoutes } from './routes/misc.js';
import { printingRoutes } from './routes/printing.js';

export interface BuildAppOptions extends ContextOptions {
  fastify?: FastifyServerOptions;
}

export interface App {
  app: FastifyInstance;
  ctx: AppContext;
}

const apiError = (error: string, message: string): ApiError => ({ error, message });

function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).headers(err.headers).send(err.toJSON());
    }
    if (err.validation) {
      return reply.code(400).send(apiError('invalid_request', err.message));
    }
    switch (err.code) {
      case 'FST_ERR_CTP_BODY_TOO_LARGE':
        return reply.code(413).send(apiError('payload_too_large', 'Request body is too large'));
      case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
        return reply.code(415).send(apiError('unsupported_media_type', 'Send JSON with Content-Type: application/json'));
    }
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send(apiError('bad_request', err.message));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send(apiError('internal_error', 'Something went wrong on the server'));
  });
}

function registerStatic(app: FastifyInstance, staticDir: string | null): void {
  const indexFile = staticDir ? path.join(staticDir, 'index.html') : null;
  const hasWebApp = indexFile !== null && existsSync(indexFile);

  if (hasWebApp) {
    app.register(fastifyStatic, {
      root: staticDir!,
      prefix: '/',
      index: ['index.html'],
      cacheControl: false,
      setHeaders(reply, filePath) {
        // Vite puts content-hashed files under assets/; everything else must revalidate.
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (!isApi && hasWebApp && (request.method === 'GET' || request.method === 'HEAD')) {
      // SPA fallback: client-side routes such as /admin load the app shell.
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send(apiError('not_found', `${request.method} ${request.url} not found`));
  });
}

export async function buildApp(options: BuildAppOptions): Promise<App> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    ...options.fastify,
  });
  const ctx = createContext(options, {
    info: (obj, msg) => app.log.info(obj, msg),
    warn: (obj, msg) => app.log.warn(obj, msg),
    error: (obj, msg) => app.log.error(obj, msg),
  });

  await app.register(fastifyCookie);
  // JSON only: text/plain is a "simple" CORS content type a cross-site form could send.
  app.removeContentTypeParser('text/plain');
  registerErrorHandling(app);

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/') && !isAllowedOrigin(request, options.allowedOrigins)) {
      throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed');
    }
  });

  miscRoutes(app, ctx);
  designRoutes(app, ctx);
  printingRoutes(app, ctx);
  adminRoutes(app, ctx);
  registerStatic(app, options.staticDir);

  await app.ready();
  return { app, ctx };
}
