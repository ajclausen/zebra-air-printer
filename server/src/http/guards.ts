import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { SESSION_COOKIE, type Session } from '../auth/admin-auth.js';
import type { AppContext } from '../context.js';
import { HttpError, unauthorized } from '../errors.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Same-origin check for state-changing requests. Browsers always send Origin on
 * cross-origin and non-GET fetches; requests without Origin (curl, health checks) are
 * allowed because they cannot carry a SameSite=Strict cookie from another site.
 */
export function isAllowedOrigin(request: FastifyRequest, allowedOrigins: string[]): boolean {
  if (!STATE_CHANGING.has(request.method)) return true;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false; // includes Origin: null
  }
}

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, session: Session): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.protocol === 'https',
    path: '/',
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.protocol === 'https',
    path: '/',
  });
}

/** True when the request carries a valid admin session (renewing the cookie when due). */
export function hasAdminSession(ctx: AppContext, request: FastifyRequest, reply: FastifyReply): boolean {
  const check = ctx.auth.checkSession(request.cookies[SESSION_COOKIE]);
  if (check.renewed) setSessionCookie(request, reply, check.renewed);
  return check.valid;
}

export function requireAdmin(ctx: AppContext): preHandlerHookHandler {
  return async (request, reply) => {
    if (!hasAdminSession(ctx, request, reply)) throw unauthorized();
  };
}

/** Applies the login rate limit (per client IP) to password-checking endpoints. */
export function rateLimitPasswordAttempts(ctx: AppContext): preHandlerHookHandler {
  return async (request) => {
    const retryAfter = ctx.loginLimiter.attempt(request.ip);
    if (retryAfter > 0) {
      throw new HttpError(429, 'rate_limited', `Too many attempts. Try again in ${retryAfter} seconds.`, {
        'retry-after': String(retryAfter),
      });
    }
  };
}
