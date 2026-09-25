// A stand-in printer for development (ECO_PRINTER_URI=fake). It keeps an in-memory job
// list, "prints" each job over a few seconds, writes the documents to disk, and writes
// page captures (PBM) like the patched LPrint driver, so history ingestion works in dev.

import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS, type PrinterStatus, type QueueJob } from '@eco/shared';
import { PNG } from 'pngjs';
import { encodePbm, type Bitmap } from '../images/pbm.js';
import { normalizeReasons, statusMessage } from './status.js';
import {
  PrinterRequestError,
  STUDIO_USER_NAME,
  type Printer,
  type PrinterJob,
  type PrinterSettings,
  type PrintOptions,
} from './printer.js';

interface Logger {
  info(obj: object, msg: string): void;
}

export interface FakePrinterOptions {
  outputDir: string;
  logger: Logger;
  /** Where to write page captures (job-<id>-page-<n>.pbm); omit to write none. */
  captureDir?: string;
  /** Simulated printer-state-reasons, e.g. ["media-empty-error"]. */
  reasons?: string[];
  /** Milliseconds each job stays "processing". */
  jobDurationMs?: number;
  now?: () => Date;
}

const FINAL = new Set<QueueJob['state']>(['completed', 'canceled', 'aborted']);
const MAX_JOBS = 100;

/** A simple label bitmap: border and a filled block, for the seeded AirPrint job. */
function sampleBitmap(): Bitmap {
  const width = LABEL_WIDTH_DOTS;
  const height = LABEL_HEIGHT_DOTS;
  const gray = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x < 16 || y < 16 || x >= width - 16 || y >= height - 16;
      const block = x > 100 && x < 712 && y > 200 && y < 420;
      const bars = y > 700 && y < 900 && x > 100 && x < 712 && Math.floor(x / 6) % 3 === 0;
      if (border || block || bars) gray[y * width + x] = 0;
    }
  }
  return { width, height, gray };
}

function pngToBitmap(png: Uint8Array): Bitmap {
  const decoded = PNG.sync.read(Buffer.from(png));
  const gray = new Uint8Array(decoded.width * decoded.height);
  for (let i = 0; i < gray.length; i++) gray[i] = decoded.data[i * 4]! < 128 ? 0 : 255;
  return { width: decoded.width, height: decoded.height, gray };
}

interface FakeJob extends PrinterJob {
  source: QueueJob['source'];
}

export class FakePrinter implements Printer {
  private nextJobId = 101;
  private darkness = 50;
  private speed: number | null = 4;
  private readonly jobs: FakeJob[] = [];
  private readonly now: () => Date;
  private seeded: Promise<void> | null = null;

  constructor(private readonly options: FakePrinterOptions) {
    this.now = options.now ?? (() => new Date());
    const createdAt = this.now().toISOString();
    // A finished AirPrint job with a captured page, so history shows an AirPrint entry.
    this.jobs.push({
      id: 99,
      name: 'Shipping label.pdf',
      user: 'andrew',
      host: 'Andrews-iPhone.local',
      state: 'completed',
      createdAt: new Date(this.now().getTime() - 60 * 60 * 1000).toISOString(),
      impressionsCompleted: 1,
      source: 'airprint',
    });
    // A held AirPrint job so the queue UI has something to show and cancel.
    this.jobs.push({
      id: 100,
      name: 'Packing slip.pdf',
      user: 'mobile',
      host: null,
      state: 'held',
      createdAt,
      impressionsCompleted: 0,
      source: 'airprint',
    });
  }

  async getStatus(): Promise<PrinterStatus> {
    const rawReasons = this.options.reasons ?? [];
    const queue = this.jobs.filter((j) => !FINAL.has(j.state));
    const busy = queue.some((j) => j.state === 'processing' || j.state === 'pending');
    const state = rawReasons.some((r) => r.endsWith('-error')) ? 'stopped' : busy ? 'processing' : 'idle';
    return {
      name: 'Zebra ZP 450 (fake)',
      state,
      reasons: normalizeReasons(rawReasons),
      message: statusMessage(state, rawReasons),
      queue: queue.map((j) => ({
        id: j.id,
        name: j.name ?? `Job ${j.id}`,
        user: j.user,
        state: j.state,
        createdAt: j.createdAt,
        source: j.source,
      })),
      darkness: this.darkness,
      speed: this.speed,
      mediaReady: 'na_index-4x6_4x6in',
      checkedAt: this.now().toISOString(),
    };
  }

  async listJobs(): Promise<PrinterJob[]> {
    this.seeded ??= this.writeCapture(99, 1, sampleBitmap()).catch(() => {});
    await this.seeded;
    return this.jobs.map(({ source: _source, ...job }) => ({ ...job }));
  }

  async printPng(png: Uint8Array, options: PrintOptions): Promise<number> {
    const id = await this.submit(png, 'png', options);
    // Like the patched LPrint driver: one capture per printed page (raster jobs only).
    await this.writeCapture(id, 1, pngToBitmap(png));
    return id;
  }

  async printZpl(zpl: string, options: PrintOptions): Promise<number> {
    return this.submit(Buffer.from(zpl, 'utf8'), 'zpl', options);
  }

  async cancelJob(jobId: number): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId && !FINAL.has(j.state));
    if (!job) throw new PrinterRequestError(`Job ${jobId} not found`, true);
    job.state = 'canceled';
    this.options.logger.info({ jobId }, 'fake printer: job canceled');
  }

  async configure(settings: PrinterSettings): Promise<void> {
    if (settings.darkness !== undefined) this.darkness = settings.darkness;
    if (settings.speed !== undefined) this.speed = settings.speed;
    this.options.logger.info({ darkness: this.darkness, speed: this.speed }, 'fake printer: settings changed');
  }

  private async submit(data: Uint8Array, extension: string, options: PrintOptions): Promise<number> {
    const id = this.nextJobId++;
    await mkdir(this.options.outputDir, { recursive: true });
    const file = path.join(this.options.outputDir, `job-${id}.${extension}`);
    await writeFile(file, data);
    const job: FakeJob = {
      id,
      name: options.jobName,
      user: STUDIO_USER_NAME,
      host: 'localhost',
      state: 'pending',
      createdAt: this.now().toISOString(),
      impressionsCompleted: 0,
      source: 'studio',
    };
    this.jobs.push(job);
    if (this.jobs.length > MAX_JOBS) this.jobs.splice(0, this.jobs.length - MAX_JOBS);
    this.options.logger.info({ jobId: id, copies: options.copies, file }, 'fake printer: job received');
    this.scheduleCompletion(job, options.copies);
    return id;
  }

  private async writeCapture(jobId: number, page: number, bitmap: Bitmap): Promise<void> {
    const dir = this.options.captureDir;
    if (!dir) return;
    await mkdir(dir, { recursive: true });
    const name = `job-${jobId}-page-${page}.pbm`;
    // Dotfile first, then rename, like the driver.
    await writeFile(path.join(dir, `.${name}`), encodePbm(bitmap));
    await rename(path.join(dir, `.${name}`), path.join(dir, name));
  }

  private scheduleCompletion(job: FakeJob, copies: number): void {
    const duration = this.options.jobDurationMs ?? 3000;
    const start = setTimeout(() => {
      if (job.state === 'canceled') return;
      job.state = 'processing';
      const finish = setTimeout(() => {
        if (job.state === 'canceled') return;
        job.state = 'completed';
        job.impressionsCompleted = copies;
      }, duration);
      finish.unref();
    }, Math.min(500, duration));
    start.unref();
  }
}
