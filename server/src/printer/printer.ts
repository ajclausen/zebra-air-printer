import type { PrinterStatus } from '@eco/shared';

/** requesting-user-name for every job Label Studio submits; identifies studio jobs in the queue. */
export const STUDIO_USER_NAME = 'label-studio';

/** Media keyword for 4x6 in labels. */
export const LABEL_MEDIA = 'na_index-4x6_4x6in';

export interface PrintOptions {
  jobName: string;
  copies: number;
}

export interface PrinterSettings {
  /** 0-100, maps to printer-darkness-configured. */
  darkness?: number;
  /** Inches per second; null restores the printer default. */
  speed?: number | null;
}

/** Everything the server needs from the label printer. Implemented by LPrint over IPP and a fake. */
export interface Printer {
  /** Never throws: an unreachable printer is reported as state "unreachable". */
  getStatus(): Promise<PrinterStatus>;
  /** Submits one PNG label; returns the job id. */
  printPng(png: Uint8Array, options: PrintOptions): Promise<number>;
  /** Submits raw ZPL; returns the job id. */
  printZpl(zpl: string, options: PrintOptions): Promise<number>;
  cancelJob(jobId: number): Promise<void>;
  configure(settings: PrinterSettings): Promise<void>;
}

/** The printer service could not be reached. */
export class PrinterUnreachableError extends Error {
  override name = 'PrinterUnreachableError';
}

/** The printer answered but refused the request. */
export class PrinterRequestError extends Error {
  override name = 'PrinterRequestError';
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
  }
}
