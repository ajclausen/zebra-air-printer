import { setImmediate } from 'node:timers/promises';
import type { PrintRequest, PrintResponse } from '@eco/shared';
import type { DesignRepository } from '../db/designs.js';
import type { HistoryRepository } from '../db/history.js';
import { HttpError, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { decodePngDataUrl, InvalidImageError, normalizeLabelPng } from '../images/label-png.js';
import { PrinterRequestError, PrinterUnreachableError, type Printer } from '../printer/printer.js';
import type { StatusCache } from '../printer/status-cache.js';
import { jobName } from '../printer/job-name.js';
import { testLabelZpl } from '../printer/test-label.js';
import type { PrintStore } from '../storage/print-store.js';

export interface PrintServiceDeps {
  printer: Printer;
  status: StatusCache;
  designs: DesignRepository;
  history: HistoryRepository;
  store: PrintStore;
  now?: () => Date;
}

export interface ReprintOptions {
  copies?: number;
  printedBy?: string | null;
}

/** Maps printer failures to API errors. */
export function printerHttpError(err: unknown, prefix = ''): HttpError {
  if (err instanceof PrinterUnreachableError) {
    return new HttpError(503, 'printer_unreachable', `${prefix}The printer service is not responding. ${err.message}`);
  }
  if (err instanceof PrinterRequestError) {
    if (err.notFound) return new HttpError(404, 'not_found', `${prefix}${err.message}`);
    return new HttpError(502, 'printer_error', `${prefix}The printer refused the job: ${err.message}`);
  }
  if (err instanceof HttpError) return err;
  return new HttpError(500, 'internal_error', `${prefix}${(err as Error).message}`);
}

export class PrintService {
  private readonly now: () => Date;
  private readonly inFlight = new Set<Promise<unknown>>();
  private closing = false;

  constructor(private readonly deps: PrintServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Validates every image first (all or nothing), stores them, then submits one job per image. */
  print(request: PrintRequest): Promise<PrintResponse> {
    return this.track(async () => {
      const images: Buffer[] = [];
      const count = request.images.length;
      for (let index = 0; index < count; index++) {
        try {
          images.push(normalizeLabelPng(decodePngDataUrl(request.images[index]!)));
        } catch (err) {
          if (err instanceof InvalidImageError) {
            throw new HttpError(400, 'invalid_image', `Image ${index + 1}: ${err.message}`);
          }
          throw err;
        }
        // Decoding is synchronous CPU work; yield between images so status polls and
        // other requests are not starved during a 200-label batch.
        if (index < count - 1) await setImmediate();
      }
      const designId = request.designId && this.deps.designs.exists(request.designId) ? request.designId : null;
      return this.submit({
        name: request.name,
        source: request.source ?? 'studio',
        designId,
        printedBy: request.printedBy?.trim() || null,
        copies: request.copies,
        images,
      });
    });
  }

  /**
   * Re-sends the stored images of a history entry as a new history entry. Studio and
   * import entries keep their source; an AirPrint entry is reprinted from the Studio, so
   * the new entry is source 'studio', named "<name> (reprint)", with its own printedBy.
   */
  reprint(historyId: string, options: ReprintOptions = {}): Promise<PrintResponse> {
    return this.track(async () => {
      const entry = this.deps.history.get(historyId);
      if (!entry) throw notFound('History entry');
      const images = entry.imageCount > 0 ? await this.deps.store.readAll(historyId, entry.imageCount) : null;
      if (!images) {
        throw new HttpError(
          410,
          'images_missing',
          entry.imageCount === 0
            ? 'No label images were captured for this print, so it cannot be reprinted'
            : 'The stored label images for this print are gone',
        );
      }
      const designId = entry.designId && this.deps.designs.exists(entry.designId) ? entry.designId : null;
      const fromAirPrint = entry.source === 'airprint';
      const originalPrintedBy = fromAirPrint ? null : entry.printedBy;
      return this.submit({
        name: fromAirPrint ? `${entry.name} (reprint)` : entry.name,
        source: entry.source === 'import' ? 'import' : 'studio',
        designId,
        printedBy: options.printedBy === undefined ? originalPrintedBy : options.printedBy?.trim() || null,
        copies: options.copies ?? entry.copies,
        images,
      });
    });
  }

  /** Prints the server-generated ZPL test label. Not recorded in history (it has no PNG preview). */
  testPrint(): Promise<PrintResponse> {
    return this.track(async () => {
      const status = await this.deps.status.get();
      const zpl = testLabelZpl({ printedAt: this.now(), darkness: status.darkness, speed: status.speed });
      try {
        const jobId = await this.deps.printer.printZpl(zpl, { jobName: jobName('ECO Label Studio test'), copies: 1 });
        return { historyId: '', jobIds: [jobId] };
      } catch (err) {
        throw printerHttpError(err);
      } finally {
        this.deps.status.invalidate();
      }
    });
  }

  /** Number of print operations still running. */
  get pending(): number {
    return this.inFlight.size;
  }

  /**
   * Stops accepting new prints and waits (up to `timeoutMs`) for running ones, so the
   * database is not closed under them. Resolves true if everything finished.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    this.closing = true;
    if (this.inFlight.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const settled = Promise.allSettled([...this.inFlight]).then(() => true as const);
    try {
      return await Promise.race([settled, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(new HttpError(503, 'shutting_down', 'The server is restarting. Try again in a moment.'));
    }
    const promise = operation();
    this.inFlight.add(promise);
    const forget = () => this.inFlight.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  private async submit(job: {
    name: string;
    source: 'studio' | 'import';
    designId: string | null;
    printedBy: string | null;
    copies: number;
    images: Uint8Array[];
  }): Promise<PrintResponse> {
    const { history, store, printer, designs, status } = this.deps;
    const historyId = newId();
    const at = this.now();
    await store.write(historyId, job.images);
    history.insert({
      id: historyId,
      name: job.name,
      source: job.source,
      state: 'pending',
      designId: job.designId,
      printedBy: job.printedBy,
      host: null,
      labelCount: job.images.length,
      copies: job.copies,
      imageCount: job.images.length,
      createdAt: at,
    });

    const jobIds: number[] = [];
    try {
      // Sequential, so labels come out in order and LPrint is never flooded.
      for (const [index, image] of job.images.entries()) {
        const name = jobName(job.name, index, job.images.length);
        const jobId = await printer.printPng(image, { jobName: name, copies: job.copies });
        jobIds.push(jobId);
        // The ingestion poller matches these against LPrint's job list to track state.
        history.addSubmittedJob(historyId, jobId);
      }
    } catch (err) {
      if (jobIds.length === 0) {
        history.delete(historyId);
        await store.remove(historyId);
        throw printerHttpError(err);
      }
      throw printerHttpError(err, `Sent ${jobIds.length} of ${job.images.length} labels, then failed. `);
    } finally {
      status.invalidate();
    }

    if (job.designId) designs.recordPrint(job.designId, at);
    return { historyId, jobIds };
  }
}
