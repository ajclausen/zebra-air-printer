import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';

export function miscRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', { logLevel: 'warn' }, async () => ({ ok: true, version: ctx.options.version }));

  app.get('/ca.crt', async (_request, reply) => {
    let pem: Buffer;
    try {
      pem = await readFile(path.join(ctx.options.tlsDir, 'ca.crt'));
    } catch {
      throw notFound('CA certificate');
    }
    return reply
      .type('application/x-x509-ca-cert')
      .header('content-disposition', 'inline; filename="eco-label-studio-ca.crt"')
      .header('cache-control', 'no-cache')
      .send(pem);
  });
}
