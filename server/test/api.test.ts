import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Design, DesignSummary, PrinterStatus, SystemInfo } from '@eco/shared';
import type { CommandRunner } from '../src/system/exec.js';
import { createTestApp, loginAsAdmin, type TestApp } from './helpers/test-app.js';

const designInput = {
  name: 'Parking permit',
  kind: 'template',
  category: 'Parking',
  orientation: 'landscape',
  thumbnail: 'data:image/png;base64,AAAA',
  variables: [{ key: 'plate', label: 'Plate', defaultValue: 'ABC 123' }],
  document: { version: 1, objects: [{ type: 'text', text: '{{plate}}' }] },
};

describe('designs API', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.close());

  it('creates, reads, lists, updates, and duplicates', async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/designs', payload: designInput });
    expect(created.statusCode).toBe(201);
    const design = created.json<Design>();
    expect(design).toMatchObject({ ...designInput, printCount: 0, deletedAt: null, lastPrintedAt: null });

    expect((await t.app.inject({ url: `/api/designs/${design.id}` })).json()).toEqual(design);

    const list = (await t.app.inject({ url: '/api/designs?kind=template&q=permit' })).json<DesignSummary[]>();
    expect(list.map((d) => d.id)).toEqual([design.id]);
    expect(list[0]).not.toHaveProperty('document');
    expect((await t.app.inject({ url: '/api/designs?kind=design' })).json()).toEqual([]);
    expect((await t.app.inject({ url: '/api/designs?category=Parking' })).json()).toHaveLength(1);

    t.clock.advance(1000);
    const updated = await t.app.inject({
      method: 'PUT',
      url: `/api/designs/${design.id}`,
      payload: { ...designInput, name: 'Permit', category: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Permit', category: null, updatedAt: '2026-09-25T12:00:01.000Z' });

    const dup = await t.app.inject({ method: 'POST', url: `/api/designs/${design.id}/duplicate` });
    expect(dup.statusCode).toBe(201);
    expect(dup.json<Design>().name).toBe('Permit (copy)');
  });

  it('validates bodies and ids', async () => {
    const bad = await t.app.inject({ method: 'POST', url: '/api/designs', payload: { ...designInput, kind: 'other' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_request');
    const missingDoc = { ...designInput } as Record<string, unknown>;
    delete missingDoc.document;
    expect((await t.app.inject({ method: 'POST', url: '/api/designs', payload: missingDoc })).statusCode).toBe(400);
    expect((await t.app.inject({ url: '/api/designs/..%2Fetc' })).statusCode).toBe(400);
    const missing = await t.app.inject({ url: '/api/designs/doesnotexist' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found', message: 'Design not found' });
    const notJson = await t.app.inject({
      method: 'POST',
      url: '/api/designs',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(notJson.statusCode).toBe(415);
    expect(notJson.json().error).toBe('unsupported_media_type');
  });

  it('soft-deletes for everyone; restore and purge need admin', async () => {
    const { id } = (await t.app.inject({ method: 'POST', url: '/api/designs', payload: designInput })).json<Design>();
    expect((await t.app.inject({ method: 'DELETE', url: `/api/designs/${id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ url: '/api/designs' })).json()).toEqual([]);
    const withDeleted = (await t.app.inject({ url: '/api/designs?deleted=1' })).json<DesignSummary[]>();
    expect(withDeleted[0]!.deletedAt).toBe('2026-09-25T12:00:00.000Z');

    expect((await t.app.inject({ method: 'POST', url: `/api/designs/${id}/restore` })).statusCode).toBe(401);
    const cookie = await loginAsAdmin(t.app);
    const restored = await t.app.inject({ method: 'POST', url: `/api/designs/${id}/restore`, headers: { cookie } });
    expect(restored.json<Design>().deletedAt).toBeNull();

    expect((await t.app.inject({ method: 'DELETE', url: `/api/designs/${id}?purge=1` })).statusCode).toBe(401);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/designs/${id}?purge=1`, headers: { cookie } })).statusCode,
    ).toBe(204);
    expect((await t.app.inject({ url: `/api/designs/${id}` })).statusCode).toBe(404);
  });
});

describe('settings, health, CA, and fake printer', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.close());

  it('serves health and public settings; admin updates settings', async () => {
    expect((await t.app.inject({ url: '/api/health' })).json()).toEqual({ ok: true, version: '9.9.9-test' });
    expect((await t.app.inject({ url: '/api/settings' })).json()).toEqual({
      studioName: 'ECO Label Studio',
      historyRetentionDays: 90,
      defaultCopies: 1,
    });
    const cookie = await loginAsAdmin(t.app);
    const next = { studioName: 'Dock 4', historyRetentionDays: 14, defaultCopies: 2 };
    const res = await t.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie }, payload: next });
    expect(res.json()).toEqual(next);
    expect((await t.app.inject({ url: '/api/settings' })).json()).toEqual(next);
    const bad = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { cookie },
      payload: { ...next, defaultCopies: 0 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('serves the CA certificate when present', async () => {
    expect((await t.app.inject({ url: '/ca.crt' })).statusCode).toBe(404);
    mkdirSync(path.join(t.dataDir, 'tls'), { recursive: true });
    writeFileSync(path.join(t.dataDir, 'tls', 'ca.crt'), '-----BEGIN CERTIFICATE-----\n');
    const res = await t.app.inject({ url: '/ca.crt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-x509-ca-cert');
    expect(res.body).toContain('BEGIN CERTIFICATE');
  });

  it('fake printer reports a plausible idle status with a queue and accepts jobs', async () => {
    const status = (await t.app.inject({ url: '/api/printer' })).json<PrinterStatus>();
    expect(status).toMatchObject({ state: 'idle', message: null, darkness: 50, speed: 4 });
    expect(status.queue).toEqual([expect.objectContaining({ id: 100, source: 'airprint', state: 'held' })]);
    expect((await t.app.inject({ method: 'DELETE', url: '/api/printer/jobs/100' })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'DELETE', url: '/api/printer/jobs/100' })).statusCode).toBe(404);
  });

  it('returns ApiError JSON for unknown API routes', async () => {
    const res = await t.app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'GET /api/nope not found' });
  });
});

describe('admin system endpoints', () => {
  it('degrade to nulls when system commands are missing (macOS dev)', async () => {
    const t = await createTestApp();
    try {
      const cookie = await loginAsAdmin(t.app);
      const res = await t.app.inject({ url: '/api/admin/system', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const info = res.json<SystemInfo>();
      expect(info.wifi).toBeNull();
      expect(info.versions).toEqual({ studio: '9.9.9-test', node: process.versions.node, lprint: null });
      expect(info.certificate).toEqual({ notAfter: null, fingerprintSha256: null });
      expect(info.services).toEqual([
        { name: 'lprint', active: 'unknown', sub: 'unknown', since: null, restarts: null },
        { name: 'avahi-daemon', active: 'unknown', sub: 'unknown', since: null, restarts: null },
        { name: 'eco-studio', active: 'unknown', sub: 'unknown', since: null, restarts: null },
      ]);
      expect(info.health.map((h) => [h.name, h.consecutiveFailures])).toEqual([
        ['network', 0],
        ['lprint', 0],
        ['advertise', 0],
        ['studio', 0],
      ]);
      expect(info.memory.totalBytes).toBeGreaterThan(0);
      expect(info.disk.totalBytes).toBeGreaterThan(0);

      const logs = await t.app.inject({ url: '/api/admin/logs?unit=lprint', headers: { cookie } });
      expect(logs.statusCode).toBe(503);
      expect(logs.json().error).toBe('logs_unavailable');

      const restart = await t.app.inject({ method: 'POST', url: '/api/admin/services/lprint/restart', headers: { cookie } });
      expect(restart.statusCode).toBe(502);
      expect(restart.json().error).toBe('restart_failed');
    } finally {
      await t.close();
    }
  });

  it('runs whitelisted commands with the expected arguments', async () => {
    const run: CommandRunner = async (file, args) => {
      if (file === 'journalctl') return { stdout: '2026-09-25T12:00:00+0000 eco-printer lprint[1]: ready\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const t = await createTestApp({ run });
    try {
      const cookie = await loginAsAdmin(t.app);
      const logs = await t.app.inject({ url: '/api/admin/logs?unit=eco-printer-health&lines=25', headers: { cookie } });
      expect(logs.json()).toEqual({ lines: ['2026-09-25T12:00:00+0000 eco-printer lprint[1]: ready'] });
      expect(t.commands.at(-1)).toEqual({
        file: 'journalctl',
        args: ['-u', 'eco-printer-health.service', '-n', '25', '--no-pager', '-o', 'short-iso'],
      });
      expect((await t.app.inject({ url: '/api/admin/logs?unit=sshd', headers: { cookie } })).statusCode).toBe(400);
      expect((await t.app.inject({ url: '/api/admin/logs?unit=lprint&lines=1001', headers: { cookie } })).statusCode).toBe(400);

      const restart = await t.app.inject({ method: 'POST', url: '/api/admin/services/avahi-daemon/restart', headers: { cookie } });
      expect(restart.statusCode).toBe(202);
      expect(t.commands.at(-1)).toEqual({ file: 'systemctl', args: ['restart', 'avahi-daemon.service'] });
      expect(
        (await t.app.inject({ method: 'POST', url: '/api/admin/services/sshd/restart', headers: { cookie } })).statusCode,
      ).toBe(400);

      // Restarting ourselves and rebooting answer first, then run the command.
      const self = await t.app.inject({ method: 'POST', url: '/api/admin/services/eco-studio/restart', headers: { cookie } });
      expect(self.statusCode).toBe(202);
      const reboot = await t.app.inject({ method: 'POST', url: '/api/admin/reboot', headers: { cookie } });
      expect(reboot.statusCode).toBe(202);
      await new Promise((r) => setTimeout(r, 20));
      expect(t.commands.slice(-2)).toEqual([
        { file: 'systemctl', args: ['restart', 'eco-studio.service'] },
        { file: 'systemctl', args: ['reboot'] },
      ]);
    } finally {
      await t.close();
    }
  });
});

describe('static web app', () => {
  let staticDir: string;
  let t: TestApp;
  beforeAll(() => {
    staticDir = mkdtempSync(path.join(os.tmpdir(), 'eco-web-'));
    mkdirSync(path.join(staticDir, 'assets'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(path.join(staticDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(path.join(staticDir, 'favicon.svg'), '<svg/>');
  });
  afterAll(() => rmSync(staticDir, { recursive: true, force: true }));
  beforeEach(async () => {
    t = await createTestApp({ staticDir });
  });
  afterEach(() => t.close());

  it('serves index.html with no-cache and hashed assets with a long cache', async () => {
    const index = await t.app.inject({ url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.body).toContain('root');

    const asset = await t.app.inject({ url: '/assets/index-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    expect((await t.app.inject({ url: '/favicon.svg' })).headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client routes but not for /api', async () => {
    const admin = await t.app.inject({ url: '/admin/logs' });
    expect(admin.statusCode).toBe(200);
    expect(admin.headers['content-type']).toMatch(/text\/html/);
    expect(admin.headers['cache-control']).toBe('no-cache');

    const api = await t.app.inject({ url: '/api/missing' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error).toBe('not_found');
  });
});
