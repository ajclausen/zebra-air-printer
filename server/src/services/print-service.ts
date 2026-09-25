import type { PrintRequest, PrintResponse } from '@eco/shared';
import type { DesignRepository } from '../db/designs.js';
import type { HistoryRepository } from '../db/history.js';
import { HttpError, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { decodePngDataUrl, InvalidImageError, normalizeLabelPng } from '../images/label-png.js';
import { PrinterRequestError, PrinterUnreachableError, type Printer } from '../printer/printer.js';
import type { StatusCache } from '../printer/status-cache.js';
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

  constructor(private readonly deps: PrintServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Validates every image first (all or nothing), stores them, then submits one job per image. */
  async print(request: PrintRequest): Promise<PrintResponse> {
    const images = request.images.map((dataUrl, index) => {
      try {
        return normalizeLabelPng(decodePngDataUrl(dataUrl));
      } catch (err) {
        if (err instanceof InvalidImageError) {
          throw new HttpError(400, 'invalid_image', `Image ${index + 1}: ${err.message}`);
        }
        throw err;
      }
    });
    const designId = request.designId && this.deps.designs.exists(request.designId) ? request.designId : null;
    return this.submit({
      name: request.name,
      designId,
      printedBy: request.printedBy?.trim() || null,
      copies: request.copies,
      images,
    });
  }

  /** Re-sends the stored images of a history entry as a new history entry. */
  async reprint(historyId: string, options: ReprintOptions = {}): Promise<PrintResponse> {
    const entry = this.deps.history.get(historyId);
    if (!entry) throw notFound('History entry');
    const images = await this.deps.store.readAll(historyId, entry.labelCount);
    if (!images) throw new HttpError(410, 'images_missing', 'The stored label images for this print are gone');
    const designId = entry.designId && this.deps.designs.exists(entry.designId) ? entry.designId : null;
    return this.submit({
      name: entry.name,
      designId,
      printedBy: options.printedBy === undefined ? entry.printedBy : options.printedBy?.trim() || null,
      copies: options.copies ?? entry.copies,
      images,
    });
  }

  /** Prints the server-generated ZPL test label. Not recorded in history (it has no PNG preview). */
  async testPrint(): Promise<PrintResponse> {
    const status = await this.deps.status.get();
    const zpl = testLabelZpl({ printedAt: this.now(), darkness: status.darkness, speed: status.speed });
    try {
      const jobId = await this.deps.printer.printZpl(zpl, { jobName: 'ECO Label Studio test', copies: 1 });
      return { historyId: '', jobIds: [jobId] };
    } catch (err) {
      throw printerHttpError(err);
    } finally {
      this.deps.status.invalidate();
    }
  }

  private async submit(job: {
    name: string;
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
      designId: job.designId,
      printedBy: job.printedBy,
      labelCount: job.images.length,
      copies: job.copies,
      createdAt: at,
    });

    const jobIds: number[] = [];
    try {
      // Sequential, so labels come out in order and LPrint is never flooded.
      for (const [index, image] of job.images.entries()) {
        const jobName = job.images.length > 1 ? `${job.name} (${index + 1}/${job.images.length})` : job.name;
        jobIds.push(await printer.printPng(image, { jobName, copies: job.copies }));
        history.setJobIds(historyId, jobIds);
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
