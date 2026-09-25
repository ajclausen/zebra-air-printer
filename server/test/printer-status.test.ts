import { describe, expect, it, vi } from 'vitest';
import type { PrinterStatus } from '@eco/shared';
import { attr, type IppGroup } from '../src/ipp/codec.js';
import { DelimiterTag } from '../src/ipp/constants.js';
import {
  buildStatus,
  inchesToIppSpeed,
  ippSpeedToInches,
  mapJob,
  mapPrinterState,
  normalizeReasons,
  statusMessage,
} from '../src/printer/status.js';
import { StatusCache } from '../src/printer/status-cache.js';

const now = new Date('2026-09-25T12:00:00Z');
const group = (tag: number, ...attributes: IppGroup['attributes']): IppGroup => ({ tag, attributes });

describe('printer state mapping', () => {
  it('maps IPP printer-state enums', () => {
    expect(mapPrinterState(3)).toBe('idle');
    expect(mapPrinterState(4)).toBe('processing');
    expect(mapPrinterState(5)).toBe('stopped');
  });

  it('strips severity suffixes, drops none, and de-duplicates', () => {
    expect(normalizeReasons(['none'])).toEqual([]);
    expect(normalizeReasons(['media-empty-error', 'media-empty-warning', 'offline-report', 'paused'])).toEqual([
      'media-empty',
      'offline',
      'paused',
    ]);
  });

  it.each([
    [['media-empty-error'], 'stopped', /out of labels/],
    [['media-needed'], 'stopped', /out of labels/],
    [['media-jam-error'], 'stopped', /jammed/],
    [['offline-report'], 'stopped', /offline/],
    [['cover-open-error'], 'stopped', /cover is open/],
    [['door-open-error'], 'stopped', /cover is open/],
    [['paused'], 'stopped', /paused/],
    [['media-low-report'], 'idle', /running low/],
    [['marker-supply-empty-error'], 'stopped', /reports a problem \(marker-supply-empty\)/],
    [[], 'stopped', /has stopped/],
  ] as const)('explains %j in plain language', (reasons, state, pattern) => {
    expect(statusMessage(state, [...reasons])).toMatch(pattern);
  });

  it('has no message when idle or processing without reasons', () => {
    expect(statusMessage('idle', ['none'])).toBeNull();
    expect(statusMessage('processing', [])).toBeNull();
  });

  it('prefers the most actionable message when several reasons are present', () => {
    expect(statusMessage('stopped', ['media-empty-error', 'offline-report'])).toMatch(/offline/);
    expect(statusMessage('stopped', ['paused', 'media-jam-error'])).toMatch(/jammed/);
  });

  it('explains unreachable', () => {
    expect(statusMessage('unreachable', [])).toMatch(/Cannot reach the printer service/);
  });
});

describe('speed conversion', () => {
  it('converts hundredths of mm/sec to inches/sec and back', () => {
    expect(ippSpeedToInches(10160)).toBe(4);
    expect(ippSpeedToInches(5080)).toBe(2);
    expect(ippSpeedToInches(0)).toBeNull();
    expect(inchesToIppSpeed(4)).toBe(10160);
    expect(inchesToIppSpeed(6)).toBe(15240);
    expect(inchesToIppSpeed(null)).toBe(0);
  });
});

describe('queue jobs', () => {
  it('marks label-studio jobs as studio and everything else as airprint', () => {
    const studio = mapJob(
      group(
        DelimiterTag.jobAttributes,
        attr.integer('job-id', 12),
        attr.name('job-name', 'Asset tag'),
        attr.enum('job-state', 5),
        attr.name('job-originating-user-name', 'label-studio'),
        attr.dateTime('date-time-at-creation', new Date('2026-09-25T11:59:00Z')),
      ),
    );
    expect(studio).toEqual({
      id: 12,
      name: 'Asset tag',
      user: 'label-studio',
      state: 'processing',
      createdAt: '2026-09-25T11:59:00.000Z',
      source: 'studio',
    });

    const airprint = mapJob(
      group(
        DelimiterTag.jobAttributes,
        attr.integer('job-id', 13),
        attr.enum('job-state', 4),
        attr.name('job-originating-user-name', 'andrew'),
        attr.integer('time-at-creation', 1_790_000_000),
      ),
    );
    expect(airprint).toMatchObject({ id: 13, name: 'Job 13', state: 'held', source: 'airprint' });
    expect(airprint?.createdAt).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it('ignores uptime-relative time-at-creation', () => {
    const job = mapJob(group(DelimiterTag.jobAttributes, attr.integer('job-id', 1), attr.integer('time-at-creation', 42)));
    expect(job?.createdAt).toBeNull();
    expect(job?.source).toBe('airprint');
  });
});

describe('buildStatus', () => {
  it('assembles PrinterStatus from LPrint attributes', () => {
    const printer = group(
      DelimiterTag.printerAttributes,
      attr.name('printer-name', 'Zebra_ZP_450'),
      attr.enum('printer-state', 5),
      attr.keyword('printer-state-reasons', 'media-empty-error'),
      attr.integer('printer-darkness-configured', 70),
      attr.integer('print-speed-default', 10160),
      attr.collection('media-col-ready', [attr.keyword('media-size-name', 'na_index-4x6_4x6in')]),
    );
    const jobs = [
      group(DelimiterTag.jobAttributes, attr.integer('job-id', 9), attr.enum('job-state', 3)),
      group(DelimiterTag.jobAttributes, attr.integer('job-id', 4), attr.enum('job-state', 5)),
    ];
    const status = buildStatus(printer, jobs, now);
    expect(status).toMatchObject({
      name: 'Zebra_ZP_450',
      state: 'stopped',
      reasons: ['media-empty'],
      darkness: 70,
      speed: 4,
      mediaReady: 'na_index-4x6_4x6in',
      checkedAt: now.toISOString(),
    });
    expect(status.message).toMatch(/out of labels/);
    expect(status.queue.map((j) => j.id)).toEqual([4, 9]);
  });

  it('treats print-speed-default 0 as the printer default', () => {
    const status = buildStatus(
      group(DelimiterTag.printerAttributes, attr.enum('printer-state', 3), attr.integer('print-speed-default', 0)),
      [],
      now,
    );
    expect(status.speed).toBeNull();
    expect(status.message).toBeNull();
  });
});

describe('StatusCache', () => {
  const status = { state: 'idle' } as PrinterStatus;

  it('serves cached status for the TTL and shares in-flight requests', async () => {
    let clock = 0;
    const load = vi.fn(async () => status);
    const cache = new StatusCache(load, 2000, () => clock);
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(load).toHaveBeenCalledTimes(1);
    clock = 1999;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    clock = 2000;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads after invalidate()', async () => {
    const load = vi.fn(async () => status);
    const cache = new StatusCache(load, 2000, () => 0);
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
