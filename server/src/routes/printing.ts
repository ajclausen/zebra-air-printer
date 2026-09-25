import type { HistorySource, PrintRequest, ReprintRequest } from '@eco/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';
import { requireAdmin } from '../http/guards.js';
import { historyImageParams, historyListQuery, idParams, jobParams, printBody, reprintBody } from '../http/schemas.js';
import { printerHttpError } from '../services/print-service.js';

const PRINT_BODY_LIMIT = 50 * 1024 * 1024;

export function printingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { prints, history, store, status, printer } = ctx;

  app.post<{ Body: PrintRequest }>(
    '/api/print',
    { schema: { body: printBody }, bodyLimit: PRINT_BODY_LIMIT },
    async (request) => prints.print(request.body),
  );

  app.get<{ Querystring: { limit: number; before?: string; source?: HistorySource } }>(
    '/api/history',
    { schema: { querystring: historyListQuery } },
    async (request) => {
      let before: Date | undefined;
      if (request.query.before) {
        before = new Date(request.query.before);
        if (Number.isNaN(before.getTime())) {
          throw new HttpError(400, 'invalid_request', 'querystring/before must be an ISO 8601 date-time');
        }
      }
      return history.list(request.query.limit, before, request.query.source);
    },
  );

  app.get<{ Params: { id: string; index: number } }>(
    '/api/history/:id/images/:index(^\\d+).png',
    { schema: { params: historyImageParams } },
    async (request, reply) => {
      const entry = history.get(request.params.id);
      if (!entry || request.params.index >= entry.imageCount) throw notFound('Image');
      const image = await store.read(entry.id, request.params.index);
      if (!image) throw notFound('Image');
      // Stored images never change for a given history id.
      return reply
        .type('image/png')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(image);
    },
  );

  app.post<{ Params: { id: string }; Body: ReprintRequest | undefined }>(
    '/api/history/:id/reprint',
    {
      schema: { params: idParams, body: reprintBody },
      // The body is optional; treat a missing one as {} so it still goes through validation.
      preValidation: async (request) => {
        request.body ??= {};
      },
    },
    async (request) => prints.reprint(request.params.id, request.body ?? {}),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/history/:id',
    { schema: { params: idParams }, onRequest: requireAdmin(ctx) },
    async (request, reply) => {
      if (!history.delete(request.params.id)) throw notFound('History entry');
      await store.remove(request.params.id);
      return reply.code(204).send();
    },
  );

  app.get('/api/printer', { logLevel: 'warn' }, async () => status.get());

  app.delete<{ Params: { id: number } }>(
    '/api/printer/jobs/:id',
    { schema: { params: jobParams } },
    async (request, reply) => {
      try {
        await printer.cancelJob(request.params.id);
      } catch (err) {
        throw printerHttpError(err);
      } finally {
        status.invalidate();
      }
      return reply.code(204).send();
    },
  );

  app.post('/api/printer/test', { onRequest: requireAdmin(ctx) }, async () => prints.testPrint());
}
