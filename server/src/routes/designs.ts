import type { DesignInput, DesignKind } from '@eco/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { notFound, unauthorized } from '../errors.js';
import { hasAdminSession, requireAdmin } from '../http/guards.js';
import { designInputBody, designListQuery, idParams, purgeQuery } from '../http/schemas.js';

const DESIGN_BODY_LIMIT = 20 * 1024 * 1024;

type IdParams = { id: string };

export function designRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { designs } = ctx;

  app.get<{ Querystring: { kind?: DesignKind; q?: string; category?: string; deleted?: '0' | '1' } }>(
    '/api/designs',
    { schema: { querystring: designListQuery } },
    async (request) =>
      designs.list({
        kind: request.query.kind,
        q: request.query.q?.trim() || undefined,
        category: request.query.category || undefined,
        includeDeleted: request.query.deleted === '1',
      }),
  );

  app.get<{ Params: IdParams }>('/api/designs/:id', { schema: { params: idParams } }, async (request) => {
    const design = designs.get(request.params.id);
    if (!design) throw notFound('Design');
    return design;
  });

  app.post<{ Body: DesignInput }>(
    '/api/designs',
    { schema: { body: designInputBody }, bodyLimit: DESIGN_BODY_LIMIT },
    async (request, reply) => reply.code(201).send(designs.create(request.body)),
  );

  app.put<{ Params: IdParams; Body: DesignInput }>(
    '/api/designs/:id',
    { schema: { params: idParams, body: designInputBody }, bodyLimit: DESIGN_BODY_LIMIT },
    async (request) => {
      const design = designs.update(request.params.id, request.body);
      if (!design) throw notFound('Design');
      return design;
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/designs/:id/duplicate',
    { schema: { params: idParams } },
    async (request, reply) => {
      const copy = designs.duplicate(request.params.id);
      if (!copy) throw notFound('Design');
      return reply.code(201).send(copy);
    },
  );

  app.delete<{ Params: IdParams; Querystring: { purge?: '0' | '1' } }>(
    '/api/designs/:id',
    { schema: { params: idParams, querystring: purgeQuery } },
    async (request, reply) => {
      if (request.query.purge === '1') {
        if (!hasAdminSession(ctx, request, reply)) throw unauthorized();
        if (!designs.purge(request.params.id)) throw notFound('Design');
      } else if (!designs.softDelete(request.params.id)) {
        throw notFound('Design');
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/designs/:id/restore',
    { schema: { params: idParams }, preHandler: requireAdmin(ctx) },
    async (request) => {
      const design = designs.restore(request.params.id);
      if (!design) throw notFound('Design');
      return design;
    },
  );
}
