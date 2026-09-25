import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, PrintResponse } from '@eco/shared';
import { attr, type IppAttribute } from '../src/ipp/codec.js';
import { IppClient } from '../src/ipp/client.js';
import { Operation } from '../src/ipp/constants.js';
import { encodePbm, type Bitmap } from '../src/images/pbm.js';
import { FakePrinter } from '../src/printer/fake-printer.js';
import { IppPrinter } from '../src/printer/ipp-printer.js';
import { startFakeIppServer, type FakeIppServer } from './helpers/fake-ipp-server.js';
import { labelDataUrl } from './helpers/png.js';
import { createTestApp, loginAsAdmin, type TestApp } from './helpers/test-app.js';

const HOUR = 60 * 60 * 1000;

const JOB_STATE = { pending: 3, held: 4, processing: 5, canceled: 7, aborted: 8, completed: 9 } as const;

function ippJob(
  id: number,
  state: keyof typeof JOB_STATE,
  options: { name?: string; user?: string; host?: string; created?: Date; impressions?: number } = {},
): IppAttribute[] {
  const attrs = [
    attr.integer('job-id', id),
    attr.name('job-name', options.name ?? `Document ${id}`),
    attr.enum('job-state', JOB_STATE[state]),
    attr.name('job-originating-user-name', options.user ?? 'andrew'),
    attr.dateTime('date-time-at-creation', options.created ?? new Date('2026-09-25T11:59:00Z')),
    attr.integer('job-impressions-completed', options.impressions ?? 0),
  ];
  if (options.host) attrs.push(attr.name('job-originating-host-name', options.host));
  return attrs;
}

function page(width = 812, height = 1218, black = (x: number, y: number) => x < 20 || y < 20): Buffer {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = black(x, y) ? 0 : 255;
  return encodePbm({ width, height, gray } satisfies Bitmap);
}

describe('history ingestion from LPrint', () => {
  let ipp: FakeIppServer;
  let t: TestApp;
  let captureDir: string;

  const history = async (query = '') => (await t.app.inject({ url: `/api/history${query}` })).json<HistoryEntry[]>();
  const writeCapture = (name: string, data: Buffer, ageMs = 0) => {
    mkdirSync(captureDir, { recursive: true });
    const file = path.join(captureDir, name);
    writeFileSync(file, data);
    // Ages are relative to the service's clock (the test clock), not the wall clock.
    const when = new Date(t.clock.now.getTime() - ageMs);
    utimesSync(file, when, when);
    return file;
  };

  beforeEach(async () => {
    ipp = await startFakeIppServer();
    t = await createTestApp({ printer: new IppPrinter(new IppClient(ipp.uri)) });
    captureDir = path.join(t.dataDir, 'captures');
  });
  afterEach(async () => {
    await t.close();
    await ipp.close();
  });

  it('asks LPrint for completed and not-completed jobs as label-studio', async () => {
    await t.ctx.ingest.poll();
    const requests = ipp.requests.filter((r) => r.code === Operation.getJobs);
    const ops = requests.map((r) =>
      Object.fromEntries(r.groups[0]!.attributes.map((a) => [a.name, a.values.map((v) => v.data)])),
    );
    expect(ops.map((o) => o['which-jobs']).sort()).toEqual([['completed'], ['not-completed']]);
    for (const o of ops) {
      expect(o['requesting-user-name']).toEqual(['label-studio']);
      expect(o['requested-attributes']).toEqual(
        expect.arrayContaining([
          'job-id',
          'job-name',
          'job-originating-user-name',
          'job-originating-host-name',
          'job-state',
          'date-time-at-creation',
          'job-impressions-completed',
        ]),
      );
    }
  });

  it('records a new AirPrint job once, then updates its state, label count, and images', async () => {
    ipp.jobs = [ippJob(7, 'processing', { name: 'Invoice.pdf', user: 'maria', host: 'Marias-MacBook.local' })];
    const first = await t.ctx.ingest.poll();
    expect(first).toMatchObject({ listed: true, added: 1 });
    let [entry] = await history();
    expect(entry).toMatchObject({
      name: 'Invoice.pdf',
      source: 'airprint',
      state: 'processing',
      printedBy: 'maria',
      host: 'Marias-MacBook.local',
      labelCount: 0,
      copies: 1,
      jobIds: [7],
      imageCount: 0,
      previewUrl: null,
      createdAt: '2026-09-25T11:59:00.000Z',
      designId: null,
    });

    // Captures appear while printing but are not used until the job is final.
    writeCapture('job-7-page-1.pbm', page());
    writeCapture('job-7-page-2.pbm', page(801, 1200)); // padded to fit
    writeCapture('.job-7-page-3.pbm', Buffer.from('partial')); // still being written
    expect((await t.ctx.ingest.poll()).added).toBe(0);
    expect(await history()).toHaveLength(1);
    expect(existsSync(path.join(captureDir, 'job-7-page-1.pbm'))).toBe(true);

    ipp.jobs = [];
    ipp.completedJobs = [ippJob(7, 'completed', { name: 'Invoice.pdf', user: 'maria', impressions: 2 })];
    await t.ctx.ingest.poll();
    [entry] = await history();
    expect(entry).toMatchObject({ state: 'completed', labelCount: 2, imageCount: 2 });
    expect(entry!.previewUrl).toBe(`/api/history/${entry!.id}/images/0.png`);
    const image = await t.app.inject({ url: `/api/history/${entry!.id}/images/1.png` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(readdirSync(captureDir)).toEqual(['.job-7-page-3.pbm']);

    // Later polls change nothing.
    expect(await t.ctx.ingest.poll()).toMatchObject({ added: 0, updated: 0, imagesStored: 0 });
  });

  it('uses at least one label for a completed job and falls back to "Job N" without a name', async () => {
    ipp.completedJobs = [[attr.integer('job-id', 3), attr.enum('job-state', 9), attr.name('job-originating-user-name', 'x')]];
    await t.ctx.ingest.poll();
    const [entry] = await history();
    expect(entry).toMatchObject({ name: 'Job 3', labelCount: 1, host: null, createdAt: t.clock.now.toISOString() });
  });

  it('treats a reused job id with a different creation time as a new job', async () => {
    ipp.completedJobs = [ippJob(5, 'completed', { name: 'Old', created: new Date('2026-09-20T10:00:00Z') })];
    await t.ctx.ingest.poll();
    ipp.completedJobs = [ippJob(5, 'completed', { name: 'New', created: new Date('2026-09-25T11:00:00Z') })];
    await t.ctx.ingest.poll();
    await t.ctx.ingest.poll();
    expect((await history()).map((e) => [e.name, e.jobIds])).toEqual([
      ['New', [5]],
      ['Old', [5]],
    ]);
  });

  it('tracks state for studio prints (worst state across jobs) and drops their captures', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'Tags', images: [labelDataUrl(), labelDataUrl()], copies: 1 },
    });
    const { historyId, jobIds } = res.json<PrintResponse>();
    expect(jobIds).toEqual([1, 2]);
    const created = new Date(t.clock.now.getTime() + 1000);
    ipp.jobs = [ippJob(2, 'pending', { user: 'label-studio', created })];
    ipp.completedJobs = [ippJob(1, 'completed', { user: 'label-studio', created })];
    writeCapture('job-1-page-1.pbm', page());
    await t.ctx.ingest.poll();
    let entry = (await history())[0]!;
    expect(entry).toMatchObject({ id: historyId, source: 'studio', state: 'pending', imageCount: 2 });
    expect(existsSync(path.join(captureDir, 'job-1-page-1.pbm'))).toBe(false);

    ipp.jobs = [];
    ipp.completedJobs = [
      ippJob(1, 'completed', { user: 'label-studio', created }),
      ippJob(2, 'aborted', { user: 'label-studio', created }),
    ];
    await t.ctx.ingest.poll();
    entry = (await history())[0]!;
    expect(entry.state).toBe('aborted');
    expect(await history('?source=airprint')).toEqual([]); // studio jobs never become AirPrint entries
  });

  it('records source import and filters by ?source=', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'UPS label', images: [labelDataUrl()], copies: 1, source: 'import' },
    });
    await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'Tag', images: [labelDataUrl()], copies: 1 } });
    ipp.completedJobs = [ippJob(40, 'completed', { name: 'Photo.jpg' })];
    await t.ctx.ingest.poll();
    expect((await history('?source=import')).map((e) => e.name)).toEqual(['UPS label']);
    expect((await history('?source=studio')).map((e) => e.name)).toEqual(['Tag']);
    expect((await history('?source=airprint')).map((e) => e.name)).toEqual(['Photo.jpg']);
    expect(await history()).toHaveLength(3);
    expect((await t.app.inject({ url: '/api/history?source=fax' })).statusCode).toBe(400);
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'x', images: [labelDataUrl()], copies: 1, source: 'airprint' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('ignores Label Studio jobs that are not in history (test prints) and deletes their captures', async () => {
    ipp.completedJobs = [ippJob(9, 'completed', { user: 'label-studio' })];
    writeCapture('job-9-page-1.pbm', page());
    await t.ctx.ingest.poll();
    expect(await history()).toEqual([]);
    expect(existsSync(path.join(captureDir, 'job-9-page-1.pbm'))).toBe(false);
  });

  it('does not re-add a deleted AirPrint entry while LPrint still lists the job', async () => {
    ipp.completedJobs = [ippJob(11, 'completed')];
    await t.ctx.ingest.poll();
    const [entry] = await history();
    const cookie = await loginAsAdmin(t.app);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/history/${entry!.id}`, headers: { cookie } })).statusCode).toBe(204);
    await t.ctx.ingest.poll();
    expect(await history()).toEqual([]);
  });

  it('reprints AirPrint entries as studio prints, and refuses entries without images', async () => {
    ipp.completedJobs = [ippJob(21, 'completed', { name: 'Label.pdf', user: 'maria' }), ippJob(22, 'completed', { name: 'Raw' })];
    writeCapture('job-21-page-1.pbm', page());
    await t.ctx.ingest.poll();
    const entries = await history('?source=airprint');
    const withImage = entries.find((e) => e.name === 'Label.pdf')!;
    const without = entries.find((e) => e.name === 'Raw')!;
    expect(withImage.imageCount).toBe(1);

    const res = await t.app.inject({ method: 'POST', url: `/api/history/${withImage.id}/reprint` });
    expect(res.statusCode).toBe(200);
    const reprint = (await history('?source=studio'))[0]!;
    expect(reprint).toMatchObject({ name: 'Label.pdf (reprint)', source: 'studio', printedBy: null, imageCount: 1, copies: 1 });
    const job = ipp.requests.filter((r) => r.code === Operation.printJob).at(-1)!;
    const docFormat = job.groups[0]!.attributes.find((a) => a.name === 'document-format')!.values[0]!.data;
    expect(docFormat).toBe('image/png');

    const missing = await t.app.inject({ method: 'POST', url: `/api/history/${without.id}/reprint` });
    expect(missing.statusCode).toBe(410);
    expect(missing.json().error).toBe('images_missing');
  });

  it('skips quietly when LPrint is unreachable', async () => {
    await ipp.close();
    expect(await t.ctx.ingest.poll()).toMatchObject({ listed: false, added: 0 });
  });

  it('cleans up old and orphaned captures', async () => {
    ipp.jobs = [ippJob(31, 'processing')];
    await t.ctx.ingest.poll(); // job 31 is known (not final)
    const keptKnown = writeCapture('job-31-page-1.pbm', page(8, 8), 2 * HOUR);
    const tooOld = writeCapture('job-31-page-2.pbm', page(8, 8), 25 * HOUR);
    const orphanOld = writeCapture('job-500-page-1.pbm', page(8, 8), 2 * HOUR);
    const orphanNew = writeCapture('job-501-page-1.pbm', page(8, 8), 10 * 60 * 1000);
    const junkOld = writeCapture('notes.txt', Buffer.from('x'), 2 * HOUR);
    const tempNew = writeCapture('.job-502-page-1.pbm', Buffer.from('x'), 2 * HOUR);
    const tempOld = writeCapture('.job-503-page-1.pbm', Buffer.from('x'), 25 * HOUR);
    await t.ctx.ingest.poll();
    expect(existsSync(keptKnown)).toBe(true);
    expect(existsSync(tooOld)).toBe(false);
    expect(existsSync(orphanOld)).toBe(false);
    expect(existsSync(orphanNew)).toBe(true);
    expect(existsSync(junkOld)).toBe(false);
    expect(existsSync(tempNew)).toBe(true);
    expect(existsSync(tempOld)).toBe(false);
  });

  it('prunes AirPrint entries with the retention window', async () => {
    ipp.completedJobs = [ippJob(60, 'completed', { created: new Date('2026-05-01T00:00:00Z') }), ippJob(61, 'completed')];
    await t.ctx.ingest.poll();
    expect(await history()).toHaveLength(2);
    await t.ctx.retention.prune();
    expect((await history()).map((e) => e.jobIds)).toEqual([[61]]);
    // Still listed by LPrint, but not ingested again.
    await t.ctx.ingest.poll();
    expect(await history()).toHaveLength(1);
  });
});

describe('fake printer ingestion (dev)', () => {
  it('shows a captured AirPrint job and completes studio prints', async () => {
    const t = await createTestApp({
      makePrinter: (dataDir, clock) =>
        new FakePrinter({
          outputDir: path.join(dataDir, 'fake-printer'),
          captureDir: path.join(dataDir, 'captures'),
          logger: { info() {} },
          jobDurationMs: 5,
          now: () => clock.now,
        }),
    });
    try {
      await t.ctx.ingest.poll();
      let entries = (await t.app.inject({ url: '/api/history' })).json<HistoryEntry[]>();
      expect(entries.map((e) => [e.name, e.source, e.state, e.imageCount])).toEqual([
        ['Packing slip.pdf', 'airprint', 'pending', 0],
        ['Shipping label.pdf', 'airprint', 'completed', 1],
      ]);

      await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'Dev', images: [labelDataUrl()], copies: 1 } });
      expect(readdirSync(path.join(t.dataDir, 'captures'))).toContain('job-101-page-1.pbm');
      await new Promise((r) => setTimeout(r, 50));
      await t.ctx.ingest.poll();
      entries = (await t.app.inject({ url: '/api/history?source=studio' })).json<HistoryEntry[]>();
      expect(entries[0]).toMatchObject({ name: 'Dev', state: 'completed', imageCount: 1 });
      expect(readdirSync(path.join(t.dataDir, 'captures'))).toEqual([]);
    } finally {
      await t.close();
    }
  });
});
