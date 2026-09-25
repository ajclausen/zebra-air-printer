import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, PrintResponse, PrinterStatus } from '@eco/shared';
import { attr, groupsOf, type IppMessage } from '../src/ipp/codec.js';
import { IppClient } from '../src/ipp/client.js';
import { DelimiterTag, Operation, ValueTag } from '../src/ipp/constants.js';
import { IppPrinter } from '../src/printer/ipp-printer.js';
import { startFakeIppServer, type FakeIppServer } from './helpers/fake-ipp-server.js';
import { labelDataUrl, pngChunks } from './helpers/png.js';
import { createTestApp, loginAsAdmin, type TestApp } from './helpers/test-app.js';

/** Flattens one group into name -> [tag, values] for exact comparisons. */
function describeGroup(message: IppMessage, tag: number) {
  const group = groupsOf(message, tag)[0];
  return Object.fromEntries(
    (group?.attributes ?? []).map((a) => [a.name, { tag: a.values[0]!.tag, values: a.values.map((v) => v.data) }]),
  );
}

const printJobs = (ipp: FakeIppServer) => ipp.requests.filter((r) => r.code === Operation.printJob);

describe('printing through LPrint (fake IPP server)', () => {
  let ipp: FakeIppServer;
  let t: TestApp;

  beforeEach(async () => {
    ipp = await startFakeIppServer();
    t = await createTestApp({ printer: new IppPrinter(new IppClient(ipp.uri)) });
  });
  afterEach(async () => {
    await t.close();
    await ipp.close();
  });

  it('sends one Print-Job per image with the exact studio attributes', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'Asset tags', images: [labelDataUrl(), labelDataUrl()], copies: 3, printedBy: ' Andrew ' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<PrintResponse>();
    expect(body.jobIds).toEqual([1, 2]);

    const jobs = printJobs(ipp);
    expect(jobs).toHaveLength(2);
    const first = jobs[0]!;
    expect(first.version).toEqual({ major: 1, minor: 1 });
    expect(describeGroup(first, DelimiterTag.operationAttributes)).toEqual({
      'attributes-charset': { tag: ValueTag.charset, values: ['utf-8'] },
      'attributes-natural-language': { tag: ValueTag.naturalLanguage, values: ['en'] },
      'printer-uri': { tag: ValueTag.uri, values: [ipp.uri] },
      'requesting-user-name': { tag: ValueTag.nameWithoutLanguage, values: ['label-studio'] },
      'job-name': { tag: ValueTag.nameWithoutLanguage, values: ['Asset tags (1/2)'] },
      'document-format': { tag: ValueTag.mimeMediaType, values: ['image/png'] },
    });
    expect(describeGroup(first, DelimiterTag.jobAttributes)).toEqual({
      copies: { tag: ValueTag.integer, values: [3] },
      media: { tag: ValueTag.keyword, values: ['na_index-4x6_4x6in'] },
      'print-scaling': { tag: ValueTag.keyword, values: ['none'] },
      'print-color-mode': { tag: ValueTag.keyword, values: ['bi-level'] },
    });
    // The operation group comes first, then the job group, as RFC 8011 requires.
    expect(first.groups.map((g) => g.tag)).toEqual([DelimiterTag.operationAttributes, DelimiterTag.jobAttributes]);

    // The document is the normalised grayscale PNG with pHYs 7993 px/m.
    const doc = Buffer.from(first.data);
    const phys = pngChunks(doc).find((c) => c.type === 'pHYs')!;
    expect(phys.data.toString('hex')).toBe('00001f3900001f3901');
    expect(describeGroup(jobs[1]!, DelimiterTag.operationAttributes)['job-name']!.values).toEqual(['Asset tags (2/2)']);

    // Stored images and history.
    const stored = path.join(t.dataDir, 'prints', body.historyId, '0.png');
    expect(readFileSync(stored).equals(doc)).toBe(true);
    expect(existsSync(path.join(t.dataDir, 'prints', body.historyId, '1.png'))).toBe(true);

    const history = (await t.app.inject({ method: 'GET', url: '/api/history' })).json<HistoryEntry[]>();
    expect(history).toEqual([
      {
        id: body.historyId,
        name: 'Asset tags',
        designId: null,
        printedBy: 'Andrew',
        labelCount: 2,
        copies: 3,
        jobIds: [1, 2],
        previewUrl: `/api/history/${body.historyId}/images/0.png`,
        createdAt: '2026-09-25T12:00:00.000Z',
      },
    ]);

    const image = await t.app.inject({ method: 'GET', url: `/api/history/${body.historyId}/images/1.png` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect((await t.app.inject({ url: `/api/history/${body.historyId}/images/2.png` })).statusCode).toBe(404);
  });

  it('uses a single job name when there is one image', async () => {
    await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'Box', images: [labelDataUrl()], copies: 1 } });
    expect(describeGroup(printJobs(ipp)[0]!, DelimiterTag.operationAttributes)['job-name']!.values).toEqual(['Box']);
  });

  it('updates the design print count and lastPrintedAt', async () => {
    const design = (
      await t.app.inject({
        method: 'POST',
        url: '/api/designs',
        payload: { name: 'Bin', kind: 'design', orientation: 'portrait', document: { v: 1 } },
      })
    ).json<{ id: string }>();
    t.clock.advance(60_000);
    await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'Bin', images: [labelDataUrl()], copies: 1, designId: design.id },
    });
    const after = (await t.app.inject({ url: `/api/designs/${design.id}` })).json();
    expect(after.printCount).toBe(1);
    expect(after.lastPrintedAt).toBe('2026-09-25T12:01:00.000Z');
  });

  it('rejects wrong dimensions with invalid_image and sends nothing', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'x', images: [labelDataUrl(), labelDataUrl({ width: 1218, height: 812 })], copies: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_image', message: expect.stringMatching(/^Image 2: .*1218x812/) });
    expect(printJobs(ipp)).toHaveLength(0);
    expect((await t.app.inject({ url: '/api/history' })).json()).toEqual([]);
  });

  it('rejects non-PNG data', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'x', images: ['data:image/png;base64,' + Buffer.from('hello').toString('base64')], copies: 1 },
    });
    expect(res.json().error).toBe('invalid_image');
  });

  it.each([
    [{ name: 'x', images: [], copies: 1 }],
    [{ name: 'x', images: ['a'], copies: 0 }],
    [{ name: 'x', images: ['a'], copies: 101 }],
    [{ name: 'x', images: Array.from({ length: 201 }, () => 'a'), copies: 1 }],
    [{ images: ['a'], copies: 1 }],
  ])('validates the request body %#', async (payload) => {
    const res = await t.app.inject({ method: 'POST', url: '/api/print', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('accepts bodies above the default 1 MB limit', async () => {
    // Pseudo-random noise compresses badly, so two images exceed 1 MB.
    const noise = (x: number, y: number): [number, number, number, number] => {
      const v = ((x * 73856093) ^ (y * 19349663)) & 0xff;
      return [v, (v * 7) & 0xff, (v * 13) & 0xff, 255];
    };
    const images = [labelDataUrl({ pixel: noise }), labelDataUrl({ pixel: noise })];
    const payload = { name: 'many', images, copies: 1 };
    expect(JSON.stringify(payload).length).toBeGreaterThan(1024 * 1024);
    const res = await t.app.inject({ method: 'POST', url: '/api/print', payload });
    expect(res.statusCode).toBe(200);
    expect(res.json<PrintResponse>().jobIds).toHaveLength(2);
  });

  it('reports printer refusals and removes the history entry when nothing printed', async () => {
    ipp.printStatus = 0x0400;
    const res = await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'x', images: [labelDataUrl()], copies: 1 } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('printer_error');
    expect((await t.app.inject({ url: '/api/history' })).json()).toEqual([]);
  });

  it('keeps partial history when the printer fails midway', async () => {
    ipp.failPrintAfter = 1;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'x', images: [labelDataUrl(), labelDataUrl()], copies: 1 },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/^Sent 1 of 2 labels/);
    const history = (await t.app.inject({ url: '/api/history' })).json<HistoryEntry[]>();
    expect(history[0]!.jobIds).toEqual([1]);
  });

  it('reprints stored images as a new history entry', async () => {
    const first = (
      await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'Again', images: [labelDataUrl()], copies: 2 } })
    ).json<PrintResponse>();
    const res = await t.app.inject({ method: 'POST', url: `/api/history/${first.historyId}/reprint` });
    expect(res.statusCode).toBe(200);
    const second = res.json<PrintResponse>();
    expect(second.historyId).not.toBe(first.historyId);
    expect(second.jobIds).toEqual([2]);
    const jobs = printJobs(ipp);
    expect(Buffer.from(jobs[1]!.data).equals(Buffer.from(jobs[0]!.data))).toBe(true);
    expect(describeGroup(jobs[1]!, DelimiterTag.jobAttributes).copies!.values).toEqual([2]);

    const withCopies = await t.app.inject({
      method: 'POST',
      url: `/api/history/${first.historyId}/reprint`,
      payload: { copies: 5 },
    });
    expect(withCopies.statusCode).toBe(200);
    expect(describeGroup(printJobs(ipp)[2]!, DelimiterTag.jobAttributes).copies!.values).toEqual([5]);
    expect((await t.app.inject({ method: 'POST', url: '/api/history/nope/reprint' })).statusCode).toBe(404);
  });

  it('reports unreachable LPrint as 503 and in status', async () => {
    await ipp.close();
    const res = await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'x', images: [labelDataUrl()], copies: 1 } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('printer_unreachable');
    const status = (await t.app.inject({ url: '/api/printer' })).json<PrinterStatus>();
    expect(status.state).toBe('unreachable');
    expect(status.message).toMatch(/Cannot reach/);
  });

  it('maps printer status and queue', async () => {
    ipp.printerAttributes = [
      attr.name('printer-name', 'Zebra_ZP_450'),
      attr.enum('printer-state', 5),
      attr.keyword('printer-state-reasons', 'media-empty-error'),
      attr.integer('printer-darkness-configured', 65),
      attr.integer('print-speed-default', 7620),
    ];
    ipp.jobs = [
      [attr.integer('job-id', 8), attr.name('job-name', 'Scan.pdf'), attr.enum('job-state', 3), attr.name('job-originating-user-name', 'iPhone')],
      [attr.integer('job-id', 7), attr.name('job-name', 'Tag'), attr.enum('job-state', 5), attr.name('job-originating-user-name', 'label-studio')],
    ];
    const status = (await t.app.inject({ url: '/api/printer' })).json<PrinterStatus>();
    expect(status).toMatchObject({
      name: 'Zebra_ZP_450',
      state: 'stopped',
      reasons: ['media-empty'],
      darkness: 65,
      speed: 3,
    });
    expect(status.queue.map((j) => [j.id, j.source])).toEqual([
      [7, 'studio'],
      [8, 'airprint'],
    ]);
    const getJobs = ipp.requests.find((r) => r.code === Operation.getJobs)!;
    const ops = describeGroup(getJobs, DelimiterTag.operationAttributes);
    expect(ops['which-jobs']!.values).toEqual(['not-completed']);
    expect(ops['requested-attributes']!.values).toEqual([
      'job-id',
      'job-name',
      'job-state',
      'job-originating-user-name',
      'time-at-creation',
      'date-time-at-creation',
    ]);
  });

  it('caches status for 2 seconds', async () => {
    await t.app.inject({ url: '/api/printer' });
    await t.app.inject({ url: '/api/printer' });
    await t.app.inject({ url: '/api/printer' });
    expect(ipp.requests.filter((r) => r.code === Operation.getPrinterAttributes)).toHaveLength(1);
  });

  it('cancels jobs and maps not-found', async () => {
    expect((await t.app.inject({ method: 'DELETE', url: '/api/printer/jobs/12' })).statusCode).toBe(204);
    const cancel = ipp.requests.find((r) => r.code === Operation.cancelJob)!;
    expect(describeGroup(cancel, DelimiterTag.operationAttributes)['job-id']).toEqual({ tag: ValueTag.integer, values: [12] });
    expect((await t.app.inject({ method: 'DELETE', url: '/api/printer/jobs/404' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: '/api/printer/jobs/abc' })).statusCode).toBe(400);
  });

  it('sets darkness and speed with Set-Printer-Attributes (admin)', async () => {
    const payload = { darkness: 80, speed: 3 };
    expect((await t.app.inject({ method: 'PUT', url: '/api/admin/printer', payload })).statusCode).toBe(401);
    const cookie = await loginAsAdmin(t.app);
    const res = await t.app.inject({ method: 'PUT', url: '/api/admin/printer', payload, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const set = ipp.requests.find((r) => r.code === Operation.setPrinterAttributes)!;
    expect(describeGroup(set, DelimiterTag.printerAttributes)).toEqual({
      'printer-darkness-configured': { tag: ValueTag.integer, values: [80] },
      'print-speed-default': { tag: ValueTag.integer, values: [7620] },
    });
    expect(describeGroup(set, DelimiterTag.operationAttributes)['printer-uri']!.values).toEqual([ipp.uri]);

    await t.app.inject({ method: 'PUT', url: '/api/admin/printer', payload: { speed: null }, headers: { cookie } });
    const reset = ipp.requests.filter((r) => r.code === Operation.setPrinterAttributes)[1]!;
    // Default mode: out-of-band no-value rather than a blind 0.
    expect(describeGroup(reset, DelimiterTag.printerAttributes)).toEqual({
      'print-speed-default': { tag: ValueTag.noValue, values: [null] },
    });

    const bad = await t.app.inject({ method: 'PUT', url: '/api/admin/printer', payload: { speed: 9 }, headers: { cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('reports garbage IPP responses as a readable status, never an error', async () => {
    ipp.rawResponse = Buffer.from('<html>this is not IPP</html>');
    const res = await t.app.inject({ url: '/api/printer' });
    expect(res.statusCode).toBe(200);
    const status = res.json<PrinterStatus>();
    expect(status.state).toBe('unreachable');
    expect(status.message).toMatch(/could not be read/);

    const print = await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'x', images: [labelDataUrl()], copies: 1 } });
    expect(print.statusCode).toBe(502);
    expect(print.json().error).toBe('printer_error');
  });

  it('reports HTTP errors from LPrint separately from unreachable', async () => {
    ipp.httpStatus = 500;
    const status = (await t.app.inject({ url: '/api/printer' })).json<PrinterStatus>();
    expect(status.state).toBe('unreachable');
    expect(status.message).toMatch(/HTTP 500/);

    const print = await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'x', images: [labelDataUrl()], copies: 1 } });
    expect(print.statusCode).toBe(502);
    expect(print.json()).toMatchObject({ error: 'printer_error', message: expect.stringMatching(/HTTP 500/) });
  });

  it('sanitises and limits job names', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/print',
      payload: { name: 'Line\u0007one\nline\ttwo', images: [labelDataUrl()], copies: 1 },
    });
    expect(describeGroup(printJobs(ipp)[0]!, DelimiterTag.operationAttributes)['job-name']!.values).toEqual([
      'Line one line two',
    ]);
  });

  it('sends the admin test label as ZPL', async () => {
    const cookie = await loginAsAdmin(t.app);
    const res = await t.app.inject({ method: 'POST', url: '/api/printer/test', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ historyId: '', jobIds: [1] });
    const job = printJobs(ipp)[0]!;
    expect(describeGroup(job, DelimiterTag.operationAttributes)['document-format']!.values).toEqual([
      'application/vnd.zebra-zpl',
    ]);
    const zpl = Buffer.from(job.data).toString('utf8');
    expect(zpl).toMatch(/^\^XA/);
    expect(zpl).toContain('ECO Label Studio test');
    expect(zpl).toContain('Darkness: 50');
    expect(zpl).toContain('Speed: 4 in/s');
    expect(zpl).toContain('^BC'); // Code 128
    expect(zpl).toContain('^BQ'); // QR
    expect(zpl.trim()).toMatch(/\^XZ$/);
  });
});
