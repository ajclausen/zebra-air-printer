// Printer backed by LPrint over IPP (always TCP; LPrint's unix socket is broken in this build).

import type { PrinterStatus } from '@eco/shared';
import { attr, groupsOf, type IppAttribute } from '../ipp/codec.js';
import { IppClient, IppError, IppUnreachableError } from '../ipp/client.js';
import { DelimiterTag, StatusCode } from '../ipp/constants.js';
import {
  LABEL_MEDIA,
  PrinterRequestError,
  PrinterUnreachableError,
  STUDIO_USER_NAME,
  type Printer,
  type PrinterSettings,
  type PrintOptions,
} from './printer.js';
import { buildStatus, inchesToIppSpeed, PRINTER_STATUS_ATTRIBUTES, QUEUE_JOB_ATTRIBUTES, unreachableStatus } from './status.js';

const STATUS_TIMEOUT_MS = 2000;

/** Job attributes for a studio PNG label: exactly 1:1 on 4x6 stock, no scaling, 1-bit. */
export function pngJobAttributes(copies: number): IppAttribute[] {
  return [
    attr.integer('copies', copies),
    attr.keyword('media', LABEL_MEDIA),
    attr.keyword('print-scaling', 'none'),
    attr.keyword('print-color-mode', 'bi-level'),
  ];
}

function translateError(err: unknown): Error {
  if (err instanceof IppUnreachableError) return new PrinterUnreachableError(err.message, { cause: err });
  if (err instanceof IppError) {
    return new PrinterRequestError(err.message, err.statusCode === StatusCode.clientErrorNotFound);
  }
  return err as Error;
}

export class IppPrinter implements Printer {
  constructor(
    private readonly client: IppClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getStatus(): Promise<PrinterStatus> {
    try {
      const [printerResponse, jobs] = await Promise.all([
        this.client.getPrinterAttributes(PRINTER_STATUS_ATTRIBUTES, STATUS_TIMEOUT_MS),
        this.client.getJobs(QUEUE_JOB_ATTRIBUTES, STATUS_TIMEOUT_MS).catch((err: unknown) => {
          // A failed Get-Jobs should not hide the printer state; show an empty queue instead.
          if (err instanceof IppError) return null;
          throw err;
        }),
      ]);
      const printerGroup = groupsOf(printerResponse, DelimiterTag.printerAttributes)[0] ?? {
        tag: DelimiterTag.printerAttributes,
        attributes: [],
      };
      const jobGroups = jobs ? groupsOf(jobs, DelimiterTag.jobAttributes) : [];
      return buildStatus(printerGroup, jobGroups, this.now());
    } catch (err) {
      if (err instanceof IppUnreachableError || err instanceof IppError) return unreachableStatus(this.now());
      throw err;
    }
  }

  async printPng(png: Uint8Array, options: PrintOptions): Promise<number> {
    try {
      return await this.client.printJob({
        documentFormat: 'image/png',
        jobName: options.jobName,
        userName: STUDIO_USER_NAME,
        jobAttributes: pngJobAttributes(options.copies),
        data: png,
      });
    } catch (err) {
      throw translateError(err);
    }
  }

  async printZpl(zpl: string, options: PrintOptions): Promise<number> {
    try {
      return await this.client.printJob({
        documentFormat: 'application/vnd.zebra-zpl',
        jobName: options.jobName,
        userName: STUDIO_USER_NAME,
        jobAttributes: [attr.integer('copies', options.copies)],
        data: Buffer.from(zpl, 'utf8'),
      });
    } catch (err) {
      throw translateError(err);
    }
  }

  async cancelJob(jobId: number): Promise<void> {
    try {
      await this.client.cancelJob(jobId, STUDIO_USER_NAME);
    } catch (err) {
      throw translateError(err);
    }
  }

  async configure(settings: PrinterSettings): Promise<void> {
    const attributes: IppAttribute[] = [];
    if (settings.darkness !== undefined) attributes.push(attr.integer('printer-darkness-configured', settings.darkness));
    if (settings.speed !== undefined) attributes.push(attr.integer('print-speed-default', inchesToIppSpeed(settings.speed)));
    if (attributes.length === 0) return;
    try {
      await this.client.setPrinterAttributes(attributes, STUDIO_USER_NAME);
    } catch (err) {
      throw translateError(err);
    }
  }
}
