// A stand-in printer for development (ECO_PRINTER_URI=fake). It keeps a small in-memory
// queue, "prints" each job over a few seconds, and writes the documents to disk.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrinterStatus, QueueJob } from '@eco/shared';
import { normalizeReasons, statusMessage } from './status.js';
import { PrinterRequestError, STUDIO_USER_NAME, type Printer, type PrinterSettings, type PrintOptions } from './printer.js';

interface Logger {
  info(obj: object, msg: string): void;
}

export interface FakePrinterOptions {
  outputDir: string;
  logger: Logger;
  /** Simulated printer-state-reasons, e.g. ["media-empty-error"]. */
  reasons?: string[];
  /** Milliseconds each job stays "processing". */
  jobDurationMs?: number;
  now?: () => Date;
}

export class FakePrinter implements Printer {
  private nextJobId = 101;
  private darkness = 50;
  private speed: number | null = 4;
  private readonly queue: QueueJob[] = [];
  private readonly now: () => Date;

  constructor(private readonly options: FakePrinterOptions) {
    this.now = options.now ?? (() => new Date());
    // A held AirPrint job so the queue UI has something to show and cancel.
    this.queue.push({
      id: 100,
      name: 'Packing slip.pdf',
      user: 'mobile',
      state: 'held',
      createdAt: this.now().toISOString(),
      source: 'airprint',
    });
  }

  async getStatus(): Promise<PrinterStatus> {
    const rawReasons = this.options.reasons ?? [];
    const busy = this.queue.some((j) => j.state === 'processing' || j.state === 'pending');
    const state = rawReasons.some((r) => r.endsWith('-error')) ? 'stopped' : busy ? 'processing' : 'idle';
    return {
      name: 'Zebra ZP 450 (fake)',
      state,
      reasons: normalizeReasons(rawReasons),
      message: statusMessage(state, rawReasons),
      queue: this.queue.map((j) => ({ ...j })),
      darkness: this.darkness,
      speed: this.speed,
      mediaReady: 'na_index-4x6_4x6in',
      checkedAt: this.now().toISOString(),
    };
  }

  async printPng(png: Uint8Array, options: PrintOptions): Promise<number> {
    return this.submit(png, 'png', options);
  }

  async printZpl(zpl: string, options: PrintOptions): Promise<number> {
    return this.submit(Buffer.from(zpl, 'utf8'), 'zpl', options);
  }

  async cancelJob(jobId: number): Promise<void> {
    const index = this.queue.findIndex((j) => j.id === jobId);
    if (index === -1) throw new PrinterRequestError(`Job ${jobId} not found`, true);
    this.queue.splice(index, 1);
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
    const job: QueueJob = {
      id,
      name: options.jobName,
      user: STUDIO_USER_NAME,
      state: 'pending',
      createdAt: this.now().toISOString(),
      source: 'studio',
    };
    this.queue.push(job);
    this.options.logger.info({ jobId: id, copies: options.copies, file }, 'fake printer: job received');
    this.scheduleCompletion(job);
    return id;
  }

  private scheduleCompletion(job: QueueJob): void {
    const duration = this.options.jobDurationMs ?? 3000;
    const start = setTimeout(() => {
      job.state = 'processing';
      const finish = setTimeout(() => {
        const index = this.queue.indexOf(job);
        if (index !== -1) this.queue.splice(index, 1);
      }, duration);
      finish.unref();
    }, 500);
    start.unref();
  }
}
