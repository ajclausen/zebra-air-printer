import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { RateLimiter } from '../src/auth/rate-limiter.js';
import { cookieFrom, createTestApp, loginAsAdmin, type TestApp } from './helpers/test-app.js';

const DAY = 24 * 60 * 60 * 1000;

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('hunter22');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword('hunter22', hash)).toBe(true);
    expect(await verifyPassword('hunter23', hash)).toBe(false);
    expect(await verifyPassword('hunter22', 'garbage')).toBe(false);
    expect(await hashPassword('hunter22')).not.toBe(hash); // salted
  });
});

describe('RateLimiter', () => {
  it('allows N attempts per window per key', () => {
    let now = 0;
    const limiter = new RateLimiter(5, 60_000, () => now);
    for (let i = 0; i < 5; i++) expect(limiter.attempt('a')).toBe(0);
    expect(limiter.attempt('a')).toBe(60);
    expect(limiter.attempt('b')).toBe(0);
    now = 30_000;
    expect(limiter.attempt('a')).toBe(30);
    now = 60_000;
    expect(limiter.attempt('a')).toBe(0);
  });
});

describe('admin auth API', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.close());

  const state = async (cookie?: string) =>
    (await t.app.inject({ url: '/api/admin/state', headers: cookie ? { cookie } : {} })).json();

  it('starts unconfigured and rejects admin routes', async () => {
    expect(await state()).toEqual({ configured: false, loggedIn: false });
    for (const [method, url] of [
      ['GET', '/api/admin/system'],
      ['GET', '/api/admin/logs?unit=lprint'],
      ['POST', '/api/admin/reboot'],
      ['POST', '/api/admin/services/lprint/restart'],
      ['PUT', '/api/admin/settings'],
      ['POST', '/api/printer/test'],
      ['POST', '/api/designs/abc/restore'],
      ['DELETE', '/api/designs/abc?purge=1'],
      ['DELETE', '/api/history/abc'],
    ] as const) {
      const res = await t.app.inject({ method, url, payload: method === 'PUT' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized', message: 'Admin login required' });
    }
  });

  it('sets up the password once, with a secure session cookie', async () => {
    const short = await t.app.inject({ method: 'POST', url: '/api/admin/setup', payload: { password: 'short' } });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toBe('invalid_request');

    const res = await t.app.inject({ method: 'POST', url: '/api/admin/setup', payload: { password: 'long enough' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, loggedIn: true });
    const cookie = res.cookies.find((c) => c.name === 'eco_admin')!;
    expect(cookie.value).toMatch(/^[\w-]{43}$/); // 32 random bytes, base64url
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie.secure).toBeUndefined(); // plain HTTP in tests
    expect(new Date(cookie.expires!).getTime()).toBe(t.clock.now.getTime() + 30 * DAY);

    // The token is stored hashed, never in the clear.
    const rows = t.ctx.options.db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(cookie.value);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(await state(`eco_admin=${cookie.value}`)).toEqual({ configured: true, loggedIn: true });
    const again = await t.app.inject({ method: 'POST', url: '/api/admin/setup', payload: { password: 'another one' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_configured');
  });

  it('logs in, logs out, and rejects wrong passwords', async () => {
    await loginAsAdmin(t.app, 'the password');
    const wrong = await t.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'nope nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('invalid_password');

    const ok = await t.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'the password' } });
    expect(ok.statusCode).toBe(200);
    const cookie = cookieFrom(ok)!;
    expect((await t.app.inject({ url: '/api/admin/system', headers: { cookie } })).statusCode).toBe(200);

    const out = await t.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } });
    expect(out.json()).toEqual({ configured: true, loggedIn: false });
    expect(out.cookies.find((c) => c.name === 'eco_admin')!.value).toBe('');
    expect((await t.app.inject({ url: '/api/admin/system', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rate limits login to 5 attempts per minute per IP', async () => {
    await loginAsAdmin(t.app, 'the password'); // setup counts as an attempt
    t.clock.advance(61_000);
    const attempt = (password = 'wrong pass') =>
      t.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password } });
    for (let i = 0; i < 5; i++) expect((await attempt()).statusCode).toBe(401);
    const limited = await attempt('the password');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBe('60');

    // Another IP is unaffected.
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'the password' },
      remoteAddress: '10.0.0.9',
    });
    expect(other.statusCode).toBe(200);

    t.clock.advance(60_000);
    expect((await attempt('the password')).statusCode).toBe(200);
  });

  it('expires sessions after 30 days without use, sliding on activity', async () => {
    const cookie = await loginAsAdmin(t.app);
    // Used again after 20 days: still valid, and the expiry slides forward with a fresh cookie.
    t.clock.advance(20 * DAY);
    const renewed = await t.app.inject({ url: '/api/admin/state', headers: { cookie } });
    expect(renewed.json().loggedIn).toBe(true);
    const fresh = renewed.cookies.find((c) => c.name === 'eco_admin')!;
    expect(new Date(fresh.expires!).getTime()).toBe(t.clock.now.getTime() + 30 * DAY);

    t.clock.advance(29 * DAY);
    expect((await state(cookie)).loggedIn).toBe(true);
    t.clock.advance(30 * DAY + 1);
    expect((await state(cookie)).loggedIn).toBe(false);
    expect(t.ctx.options.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('changes the password and signs out other sessions', async () => {
    const mine = await loginAsAdmin(t.app, 'first password');
    const other = cookieFrom(
      await t.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'first password' } }),
    )!;

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/admin/password',
      headers: { cookie: mine },
      payload: { current: 'not it at all', next: 'second password' },
    });
    expect(wrong.statusCode).toBe(403);

    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/admin/password',
      headers: { cookie: mine },
      payload: { current: 'first password', next: 'second password' },
    });
    expect(ok.statusCode).toBe(204);
    expect((await state(mine)).loggedIn).toBe(true);
    expect((await state(other)).loggedIn).toBe(false);

    t.clock.advance(61_000);
    const oldPw = await t.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'first password' } });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await t.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'second password' } });
    expect(newPw.statusCode).toBe(200);
  });

  it('rejects state-changing requests from another origin', async () => {
    const cookie = await loginAsAdmin(t.app);
    const cross = await t.app.inject({
      method: 'POST',
      url: '/api/admin/reboot',
      headers: { cookie, host: 'eco-printer.local', origin: 'https://evil.example' },
    });
    expect(cross.statusCode).toBe(403);
    expect(cross.json().error).toBe('forbidden_origin');

    const nullOrigin = await t.app.inject({
      method: 'DELETE',
      url: '/api/printer/jobs/100',
      headers: { host: 'eco-printer.local', origin: 'null' },
    });
    expect(nullOrigin.statusCode).toBe(403);

    const fetchMeta = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      headers: { host: 'eco-printer.local', 'sec-fetch-site': 'cross-site' },
      payload: {},
    });
    expect(fetchMeta.statusCode).toBe(403);

    const same = await t.app.inject({
      method: 'POST',
      url: '/api/admin/reboot',
      headers: { cookie, host: 'eco-printer.local', origin: 'https://eco-printer.local' },
    });
    expect(same.statusCode).toBe(202);

    // Reads are not origin-checked.
    const read = await t.app.inject({ url: '/api/settings', headers: { origin: 'https://evil.example' } });
    expect(read.statusCode).toBe(200);
  });

  it('allows configured dev origins', async () => {
    await t.close();
    t = await createTestApp({ allowedOrigins: ['http://localhost:5173'] });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/setup',
      headers: { host: 'localhost:5174', origin: 'http://localhost:5173' },
      payload: { password: 'long enough' },
    });
    expect(res.statusCode).toBe(200);
  });
});
