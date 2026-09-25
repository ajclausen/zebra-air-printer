import { describe, expect, it, vi } from 'vitest';
import type { PrinterStatus } from '@eco/shared';
import { loadConfig } from '../src/config.js';
import { ValueTag } from '../src/ipp/constants.js';
import { IppClient } from '../src/ipp/client.js';
import { IppPrinter, speedAttribute } from '../src/printer/ipp-printer.js';
import { jobName, MAX_JOB_NAME_BYTES, truncateUtf8 } from '../src/printer/job-name.js';
import type { Printer } from '../src/printer/printer.js';
import { NMCLI_WIFI_ARGS, SystemInfoService } from '../src/system/system-info.js';
import { labelDataUrl } from './helpers/png.js';
import { createTestApp } from './helpers/test-app.js';

describe('speed reset', () => {
  it('writes no-value by default and 0 in zero mode', () => {
    expect(speedAttribute(null, 'no-value')).toEqual({
      name: 'print-speed-default',
      values: [{ tag: ValueTag.noValue, data: null }],
    });
    expect(speedAttribute(null, 'zero').values).toEqual([{ tag: ValueTag.integer, data: 0 }]);
    expect(speedAttribute(4, 'no-value').values).toEqual([{ tag: ValueTag.integer, data: 10160 }]);
  });

  it('is selected with ECO_PRINTER_SPEED_RESET', () => {
    expect(loadConfig({}).speedReset).toBe('no-value');
    expect(loadConfig({ ECO_PRINTER_SPEED_RESET: 'zero' }).speedReset).toBe('zero');
    expect(() => loadConfig({ ECO_PRINTER_SPEED_RESET: 'maybe' })).toThrow(/no-value/);
  });
});

describe('IppPrinter.getStatus', () => {
  it('never throws, even on unexpected errors, and reports them', async () => {
    const client = new IppClient('ipp://127.0.0.1:1/ipp/print/x');
    vi.spyOn(client, 'getPrinterAttributes').mockRejectedValue(new TypeError('boom'));
    vi.spyOn(client, 'getJobs').mockRejectedValue(new TypeError('boom'));
    const onUnexpectedError = vi.fn();
    const status = await new IppPrinter(client, { onUnexpectedError }).getStatus();
    expect(status.state).toBe('unreachable');
    expect(status.message).toBe('Could not read the printer status.');
    expect(onUnexpectedError).toHaveBeenCalled();
  });

  it('reports a closed port as unreachable', async () => {
    const status = await new IppPrinter(new IppClient('ipp://127.0.0.1:1/ipp/print/x')).getStatus();
    expect(status.state).toBe('unreachable');
    expect(status.message).toMatch(/Cannot reach the printer service/);
  });
});

describe('job names', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(jobName('a\u0000b\u001bc\u009fd')).toBe('a b c d');
    expect(jobName('\n\t')).toBe('Label');
    expect(jobName('Box', 1, 3)).toBe('Box (2/3)');
  });

  it('fits in 200 UTF-8 bytes including the suffix without splitting characters', () => {
    const long = 'é'.repeat(150) + '🙂'.repeat(20); // 300 + 80 bytes
    const name = jobName(long, 11, 200);
    expect(name.endsWith(' (12/200)')).toBe(true);
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(MAX_JOB_NAME_BYTES);
    expect(name).not.toContain('�');
    expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);

    const emoji = truncateUtf8('ab🙂', 5); // 🙂 is 4 bytes and would not fit whole
    expect(emoji).toBe('ab');
    expect(truncateUtf8('x'.repeat(10), 200)).toBe('x'.repeat(10));
  });
});

describe('nmcli', () => {
  it('lists cached Wi-Fi results without triggering a rescan', async () => {
    const calls: string[][] = [];
    const service = new SystemInfoService({
      run: async (file, args) => {
        if (file === 'nmcli') calls.push(args);
        return { stdout: '', stderr: '' };
      },
      readText: async () => null,
      dataDir: '/',
      tlsDir: '/nonexistent',
      healthDir: '/nonexistent',
      studioVersion: '0',
      diskUsage: async () => ({ totalBytes: 0, freeBytes: 0 }),
    });
    await service.collect();
    expect(calls).toEqual([['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi', 'list', '--rescan', 'no']]);
    expect(NMCLI_WIFI_ARGS.slice(-2)).toEqual(['--rescan', 'no']);
  });
});

/** A printer whose printPng waits until released, to hold a print in flight. */
function gatedPrinter() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let nextId = 1;
  const printer: Printer = {
    getStatus: async () => ({ state: 'idle', darkness: null, speed: null }) as PrinterStatus,
    printPng: async () => {
      await gate;
      return nextId++;
    },
    printZpl: async () => nextId++,
    cancelJob: async () => {},
    configure: async () => {},
  };
  return { printer, release };
}

describe('print service lifecycle', () => {
  it('drain waits for in-flight prints and then refuses new ones', async () => {
    const { printer, release } = gatedPrinter();
    const t = await createTestApp({ printer });
    try {
      const inFlight = t.ctx.prints.print({ name: 'slow', images: [labelDataUrl()], copies: 1 });
      await vi.waitUntil(() => t.ctx.prints.pending === 1);

      let drained: boolean | undefined;
      const draining = t.ctx.prints.drain(5000).then((d) => (drained = d));
      await new Promise((r) => setTimeout(r, 20));
      expect(drained).toBeUndefined();

      const refused = await t.app.inject({ method: 'POST', url: '/api/print', payload: { name: 'x', images: [labelDataUrl()], copies: 1 } });
      expect(refused.statusCode).toBe(503);
      expect(refused.json().error).toBe('shutting_down');

      release();
      await expect(inFlight).resolves.toMatchObject({ jobIds: [1] });
      await draining;
      expect(drained).toBe(true);
      // The history row was written before the DB could be closed.
      expect(t.ctx.history.list(10)).toHaveLength(1);
    } finally {
      release();
      await t.close();
    }
  });

  it('drain gives up after the timeout', async () => {
    const { printer, release } = gatedPrinter();
    const t = await createTestApp({ printer });
    try {
      void t.ctx.prints.print({ name: 'stuck', images: [labelDataUrl()], copies: 1 }).catch(() => {});
      await vi.waitUntil(() => t.ctx.prints.pending === 1);
      expect(await t.ctx.prints.drain(30)).toBe(false);
    } finally {
      release();
      await new Promise((r) => setTimeout(r, 20));
      await t.close();
    }
  });

  it('yields to the event loop between image decodes', async () => {
    const t = await createTestApp();
    try {
      const images = [labelDataUrl(), labelDataUrl(), labelDataUrl()];
      // Record, as each image is read, whether an immediate queued before the print has run.
      let immediateRan = false;
      const seenAtRead: boolean[] = [];
      const tracked = new Proxy(images, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) seenAtRead[Number(key)] = immediateRan;
          return Reflect.get(target, key, receiver);
        },
      });
      setImmediate(() => (immediateRan = true));
      await t.ctx.prints.print({ name: 'batch', images: tracked, copies: 1 });
      // Image 0 is decoded synchronously; the loop must yield before reading image 1.
      expect(seenAtRead).toEqual([false, true, true]);
    } finally {
      await t.close();
    }
  });
});
