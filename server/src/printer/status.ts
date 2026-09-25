// Pure mapping from IPP printer/job attributes to the PrinterStatus contract.

import type { PrinterState, PrinterStatus, QueueJob } from '@eco/shared';
import { allValues, firstValue, type IppCollection, type IppGroup } from '../ipp/codec.js';
import { JobStateEnum, PrinterStateEnum } from '../ipp/constants.js';
import { STUDIO_USER_NAME } from './printer.js';

/** IPP print-speed-default is in hundredths of mm/sec; 1 in/s = 25.4 mm/s = 2540. */
const IPP_SPEED_PER_INCH = 2540;

export function ippSpeedToInches(value: number): number | null {
  // 0 means "automatic" (printer default) in PAPPL.
  if (value <= 0) return null;
  return Math.round((value / IPP_SPEED_PER_INCH) * 10) / 10;
}

export function inchesToIppSpeed(inches: number | null): number {
  return inches === null ? 0 : Math.round(inches * IPP_SPEED_PER_INCH);
}

export function mapPrinterState(value: unknown): PrinterState {
  switch (value) {
    case PrinterStateEnum.idle:
      return 'idle';
    case PrinterStateEnum.processing:
      return 'processing';
    case PrinterStateEnum.stopped:
      return 'stopped';
    default:
      return 'stopped';
  }
}

const SEVERITY_SUFFIX = /-(error|warning|report)$/;

/** Strips severity suffixes, drops "none", and de-duplicates. */
export function normalizeReasons(raw: string[]): string[] {
  const out: string[] = [];
  for (const reason of raw) {
    const base = reason.replace(SEVERITY_SUFFIX, '');
    if (base === 'none' || base === '' || out.includes(base)) continue;
    out.push(base);
  }
  return out;
}

// Ordered by what the person standing at the printer should fix first.
const REASON_MESSAGES: Array<[string[], string]> = [
  [['offline', 'connecting-to-device'], 'The printer is offline. Check that it is switched on and the USB cable is connected.'],
  [['media-jam'], 'Labels are jammed. Open the printer, clear the jam, and close it.'],
  [['media-empty', 'media-needed'], 'The printer is out of labels. Load a new roll of 4x6 labels.'],
  [['cover-open', 'door-open'], 'The printer cover is open. Close it to continue.'],
  [['paused', 'moving-to-paused'], 'Printing is paused.'],
];

/** Reasons that are informational and never need a message on their own. */
const QUIET_REASONS = new Set(['identify-printer-requested', 'other']);

/**
 * Plain-language message for the UI, or null when nothing needs attention.
 * `rawReasons` keep their severity suffix so unknown errors can still be surfaced.
 */
export function statusMessage(state: PrinterState, rawReasons: string[]): string | null {
  if (state === 'unreachable') {
    return 'Cannot reach the printer service. It may be restarting; try again in a minute.';
  }
  const reasons = normalizeReasons(rawReasons);
  for (const [keys, message] of REASON_MESSAGES) {
    if (keys.some((k) => reasons.includes(k))) return message;
  }
  if (reasons.includes('media-low')) return 'Labels are running low.';

  const unknownErrors = rawReasons
    .filter((r) => r.endsWith('-error'))
    .map((r) => r.replace(SEVERITY_SUFFIX, ''))
    .filter((r) => !QUIET_REASONS.has(r));
  if (unknownErrors.length > 0) {
    return `The printer reports a problem (${unknownErrors.join(', ')}).`;
  }
  if (state === 'stopped') {
    const other = reasons.filter((r) => !QUIET_REASONS.has(r));
    return other.length > 0
      ? `The printer has stopped (${other.join(', ')}).`
      : 'The printer has stopped. Check the printer for a problem.';
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  // time-at-creation is only usable when it is an epoch (PAPPL may report uptime-relative values).
  if (typeof value === 'number' && value > 1_000_000_000) return new Date(value * 1000).toISOString();
  return null;
}

export function mapJob(group: IppGroup): QueueJob | null {
  const id = firstValue(group, 'job-id');
  if (typeof id !== 'number') return null;
  const name = firstValue(group, 'job-name');
  const user = firstValue(group, 'job-originating-user-name');
  const state = firstValue(group, 'job-state');
  return {
    id,
    name: typeof name === 'string' && name !== '' ? name : `Job ${id}`,
    user: typeof user === 'string' ? user : null,
    state: JobStateEnum[state as keyof typeof JobStateEnum] ?? 'pending',
    createdAt: toIso(firstValue(group, 'date-time-at-creation')) ?? toIso(firstValue(group, 'time-at-creation')),
    source: user === STUDIO_USER_NAME ? 'studio' : 'airprint',
  };
}

function mediaReady(printer: IppGroup): string | null {
  const ready = firstValue(printer, 'media-ready');
  if (typeof ready === 'string') return ready;
  const col = firstValue(printer, 'media-col-ready');
  if (Array.isArray(col)) {
    const sizeName = firstValue(col as IppCollection, 'media-size-name');
    if (typeof sizeName === 'string') return sizeName;
  }
  return null;
}

export const PRINTER_STATUS_ATTRIBUTES = [
  'printer-name',
  'printer-info',
  'printer-state',
  'printer-state-reasons',
  'printer-state-message',
  'printer-darkness-configured',
  'print-speed-default',
  'media-ready',
  'media-col-ready',
];

export const QUEUE_JOB_ATTRIBUTES = [
  'job-id',
  'job-name',
  'job-state',
  'job-originating-user-name',
  'time-at-creation',
  'date-time-at-creation',
];

export function buildStatus(printer: IppGroup, jobGroups: IppGroup[], now: Date): PrinterStatus {
  const state = mapPrinterState(firstValue(printer, 'printer-state'));
  const rawReasons = allValues(printer, 'printer-state-reasons').filter((r): r is string => typeof r === 'string');
  const info = firstValue(printer, 'printer-info');
  const name = firstValue(printer, 'printer-name');
  const darkness = firstValue(printer, 'printer-darkness-configured');
  const speed = firstValue(printer, 'print-speed-default');

  const queue = jobGroups
    .map(mapJob)
    .filter((j): j is QueueJob => j !== null)
    .sort((a, b) => a.id - b.id);

  return {
    name: typeof info === 'string' && info !== '' ? info : typeof name === 'string' ? name : 'Zebra ZP 450',
    state,
    reasons: normalizeReasons(rawReasons),
    message: statusMessage(state, rawReasons),
    queue,
    darkness: typeof darkness === 'number' ? darkness : null,
    speed: typeof speed === 'number' ? ippSpeedToInches(speed) : null,
    mediaReady: mediaReady(printer),
    checkedAt: now.toISOString(),
  };
}

/** Status for a printer service that did not answer usefully; `message` overrides the default text. */
export function unreachableStatus(now: Date, message?: string): PrinterStatus {
  return {
    name: 'Zebra ZP 450',
    state: 'unreachable',
    reasons: [],
    message: message ?? statusMessage('unreachable', []),
    queue: [],
    darkness: null,
    speed: null,
    mediaReady: null,
    checkedAt: now.toISOString(),
  };
}
