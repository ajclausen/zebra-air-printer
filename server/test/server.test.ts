import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { FakePrinter } from '../src/printer/fake-printer.js';
import { SystemInfoService } from '../src/system/system-info.js';
import { readText } from '../src/system/exec.js';
import { readFileSync } from 'node:fs';
import { createRedirectHandler, loadTls, mainServerFactory, redirectHostname, reloadTls } from '../src/server.js';

async function startApp(tlsDir: string, dataDir: string) {
  const servers = mainServerFactory(loadTls(tlsDir));
  const { app } = await buildApp({
    db: openDatabase(':memory:'),
    printer: new FakePrinter({ outputDir: path.join(dataDir, 'fake'), logger: { info() {} } }),
    dataDir,
    tlsDir,
    healthDir: dataDir,
    staticDir: null,
    allowedOrigins: [],
    version: '1.2.3',
    run: async () => {
      throw new Error('no');
    },
    readText: async () => null,
    fastify: { serverFactory: servers.factory as never },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, servers, port: (app.server.address() as AddressInfo).port };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function get(url: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; cert?: X509Certificate }>(
    (resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.request(url, { method, headers, rejectUnauthorized: false, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const socket = res.socket as import('node:tls').TLSSocket;
          const raw = typeof socket.getPeerX509Certificate === 'function' ? socket.getPeerX509Certificate() : undefined;
          resolve({ status: res.statusCode!, headers: res.headers, body, cert: raw ?? undefined });
        });
      });
      req.on('error', reject);
      req.end();
    },
  );
}

describe('redirectHostname', () => {
  it('keeps the host name and drops the port', () => {
    expect(redirectHostname('eco-printer.local')).toBe('eco-printer.local');
    expect(redirectHostname('192.168.51.242:80')).toBe('192.168.51.242');
    expect(redirectHostname('[fd00::1]:80')).toBe('[fd00::1]');
    expect(redirectHostname(undefined)).toBe('eco-printer.local');
    expect(redirectHostname('evil.com/<script>')).toBe('eco-printer.local');
  });
});

describe('HTTP to HTTPS redirect', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'eco-redirect-'));
  let close: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    await Promise.all(close.map((c) => c()));
    close = [];
  });
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

  it('redirects everything except /ca.crt and /api/health', async () => {
    const { app, servers } = await startApp(path.join(dataDir, 'no-tls'), dataDir);
    const redirect = http.createServer(createRedirectHandler(servers.handler(), 443));
    const port = await listen(redirect);
    close.push(() => app.close(), () => new Promise((r) => redirect.close(r)));

    const root = await get(`http://127.0.0.1:${port}/`, { host: 'eco-printer.local' });
    expect(root.status).toBe(301);
    expect(root.headers.location).toBe('https://eco-printer.local/');

    const deep = await get(`http://127.0.0.1:${port}/admin/logs?unit=lprint`, { host: '192.168.51.242:80' });
    expect(deep.headers.location).toBe('https://192.168.51.242/admin/logs?unit=lprint');

    const post = await get(`http://127.0.0.1:${port}/api/print`, { host: 'eco-printer.local' }, 'POST');
    expect(post.status).toBe(308);

    const health = await get(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true, version: '1.2.3' });

    const ca = await get(`http://127.0.0.1:${port}/ca.crt`);
    expect(ca.status).toBe(404); // routed to the app (no CA in this temp dir), not redirected
  });

  it('includes a non-default HTTPS port', async () => {
    const handler = createRedirectHandler(() => {}, 8443);
    const server = http.createServer(handler);
    const port = await listen(server);
    close.push(() => new Promise((r) => server.close(r)));
    const res = await get(`http://127.0.0.1:${port}/x`, { host: 'localhost:8080' });
    expect(res.headers.location).toBe('https://localhost:8443/x');
  });
});

let hasOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  hasOpenssl = false;
}

describe.skipIf(!hasOpenssl)('HTTPS listener', () => {
  const tlsDir = mkdtempSync(path.join(os.tmpdir(), 'eco-tls-'));
  const makeCert = (cn: string) =>
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
        '-keyout', path.join(tlsDir, 'server.key'), '-out', path.join(tlsDir, 'server.crt'),
        '-days', '1', '-subj', `/CN=${cn}`,
      ],
      { stdio: 'ignore' },
    );
  beforeAll(() => makeCert('first.test'));
  afterAll(() => rmSync(tlsDir, { recursive: true, force: true }));

  it('serves the app over TLS and reloads the certificate in place', async () => {
    const { app, port } = await startApp(tlsDir, tlsDir);
    try {
      const first = await get(`https://127.0.0.1:${port}/api/health`);
      expect(first.status).toBe(200);
      expect(first.cert?.subject).toContain('CN=first.test');

      makeCert('second.test');
      expect(reloadTls(app.server as unknown as https.Server, tlsDir)).toBe(true);
      const second = await get(`https://127.0.0.1:${port}/api/health`);
      expect(second.cert?.subject).toContain('CN=second.test');

      expect(reloadTls(app.server as unknown as https.Server, path.join(tlsDir, 'missing'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('reports the leaf certificate expiry and fingerprint in system info', async () => {
    const service = new SystemInfoService({
      run: async () => {
        throw new Error('missing');
      },
      readText,
      dataDir: tlsDir,
      tlsDir,
      healthDir: tlsDir,
      studioVersion: '1',
    });
    const info = await service.collect();
    const cert = new X509Certificate(readFileSync(path.join(tlsDir, 'server.crt')));
    expect(info.certificate).toEqual({
      notAfter: new Date(cert.validTo).toISOString(),
      fingerprintSha256: cert.fingerprint256,
    });
  });

  it('sets the Secure cookie flag over HTTPS', async () => {
    const { app, port } = await startApp(tlsDir, tlsDir);
    try {
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = https.request(
          `https://127.0.0.1:${port}/api/admin/setup`,
          { method: 'POST', rejectUnauthorized: false, agent: false, headers: { 'content-type': 'application/json' } },
          resolve,
        );
        req.on('error', reject);
        req.end(JSON.stringify({ password: 'long enough' }));
      });
      res.resume();
      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']?.[0]).toMatch(/eco_admin=.*; Secure/);
    } finally {
      await app.close();
    }
  });
});
