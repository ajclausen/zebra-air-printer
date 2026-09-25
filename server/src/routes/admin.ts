import type { AdminState, PrinterSettingsInput, ServiceName, StudioSettings } from '@eco/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../auth/admin-auth.js';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import {
  clearSessionCookie,
  hasAdminSession,
  rateLimitPasswordAttempts,
  requireAdmin,
  setSessionCookie,
} from '../http/guards.js';
import {
  changePasswordBody,
  logsQuery,
  newPasswordBody,
  passwordBody,
  printerSettingsBody,
  serviceParams,
  settingsBody,
} from '../http/schemas.js';
import { printerHttpError } from '../services/print-service.js';
import type { LogUnit } from '../system/system-control.js';

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { auth, settings, printer, status, systemInfo, systemControl } = ctx;
  const admin = requireAdmin(ctx);
  const limited = rateLimitPasswordAttempts(ctx);
  const deferDelay = ctx.options.deferredCommandDelayMs ?? 500;

  const state = (request: FastifyRequest, reply: FastifyReply): AdminState => ({
    configured: auth.isConfigured(),
    loggedIn: hasAdminSession(ctx, request, reply),
  });

  /** Runs a command after the response has been sent (restarting ourselves, rebooting). */
  const afterResponse = (label: string, command: () => Promise<void>) => {
    setTimeout(() => {
      command().catch((err: unknown) => app.log.error({ err }, `${label} failed`));
    }, deferDelay).unref();
  };

  // --- Session ---------------------------------------------------------------

  app.get('/api/admin/state', async (request, reply) => state(request, reply));

  app.post<{ Body: { password: string } }>(
    '/api/admin/setup',
    { schema: { body: newPasswordBody }, preHandler: limited },
    async (request, reply): Promise<AdminState> => {
      if (auth.isConfigured()) throw new HttpError(409, 'already_configured', 'An admin password is already set');
      const session = await auth.setup(request.body.password);
      if (!session) throw new HttpError(409, 'already_configured', 'An admin password is already set');
      setSessionCookie(request, reply, session);
      return { configured: true, loggedIn: true };
    },
  );

  app.post<{ Body: { password: string } }>(
    '/api/admin/login',
    { schema: { body: passwordBody }, preHandler: limited },
    async (request, reply): Promise<AdminState> => {
      if (!auth.isConfigured()) throw new HttpError(409, 'not_configured', 'Set an admin password first');
      const session = await auth.login(request.body.password);
      if (!session) throw new HttpError(401, 'invalid_password', 'Wrong password');
      setSessionCookie(request, reply, session);
      return { configured: true, loggedIn: true };
    },
  );

  app.post('/api/admin/logout', async (request, reply): Promise<AdminState> => {
    auth.logout(request.cookies[SESSION_COOKIE]);
    clearSessionCookie(request, reply);
    return { configured: auth.isConfigured(), loggedIn: false };
  });

  app.post<{ Body: { current: string; next: string } }>(
    '/api/admin/password',
    { schema: { body: changePasswordBody }, preHandler: [admin, limited] },
    async (request, reply) => {
      const ok = await auth.changePassword(request.body.current, request.body.next, request.cookies[SESSION_COOKIE]!);
      if (!ok) throw new HttpError(403, 'invalid_password', 'Current password is wrong');
      return reply.code(204).send();
    },
  );

  // --- Settings --------------------------------------------------------------

  app.get('/api/settings', { logLevel: 'warn' }, async () => settings.get());

  app.put<{ Body: StudioSettings }>(
    '/api/admin/settings',
    { schema: { body: settingsBody }, preHandler: admin },
    async (request) => {
      const saved = settings.save({ ...request.body, studioName: request.body.studioName.trim() || 'ECO Label Studio' });
      ctx.retention.prune().catch((err: unknown) => app.log.error({ err }, 'retention prune failed'));
      return saved;
    },
  );

  // --- Printer ---------------------------------------------------------------

  app.put<{ Body: PrinterSettingsInput }>(
    '/api/admin/printer',
    { schema: { body: printerSettingsBody }, preHandler: admin },
    async (request) => {
      try {
        await printer.configure(request.body);
      } catch (err) {
        throw printerHttpError(err);
      } finally {
        status.invalidate();
      }
      return status.get();
    },
  );

  // --- System ----------------------------------------------------------------

  app.get('/api/admin/system', { preHandler: admin }, async () => systemInfo.collect());

  app.post<{ Params: { name: ServiceName } }>(
    '/api/admin/services/:name/restart',
    { schema: { params: serviceParams }, preHandler: admin },
    async (request, reply) => {
      const { name } = request.params;
      request.log.warn({ service: name }, 'admin requested service restart');
      if (name === 'eco-studio') {
        // Restarting ourselves: answer first, then let systemd stop us.
        afterResponse('restart eco-studio', () => systemControl.restart(name));
        return reply.code(202).send();
      }
      try {
        await systemControl.restart(name);
      } catch (err) {
        throw new HttpError(502, 'restart_failed', `Could not restart ${name}: ${(err as Error).message}`);
      } finally {
        if (name === 'lprint') status.invalidate();
      }
      return reply.code(202).send();
    },
  );

  app.post('/api/admin/reboot', { preHandler: admin }, async (request, reply) => {
    request.log.warn('admin requested reboot');
    afterResponse('reboot', () => systemControl.reboot());
    return reply.code(202).send();
  });

  app.get<{ Querystring: { unit: LogUnit; lines: number } }>(
    '/api/admin/logs',
    { schema: { querystring: logsQuery }, preHandler: admin },
    async (request) => {
      try {
        return { lines: await systemControl.logs(request.query.unit, request.query.lines) };
      } catch (err) {
        throw new HttpError(503, 'logs_unavailable', `Could not read the journal: ${(err as Error).message}`);
      }
    },
  );
}
