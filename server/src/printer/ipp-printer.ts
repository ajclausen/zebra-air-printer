// Printer backed by LPrint over IPP (always TCP; LPrint's unix socket is broken in this build).

import type { PrinterStatus } from '@eco/shared';
import { attr, groupsOf, IppDecodeError, type IppAttribute } from '../ipp/codec.js';
import { IppClient, IppError, IppHttpError, IppUnreachableError } from '../ipp/client.js';
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

/**
 * How `speed: null` ("printer default") is written to print-speed-default.
 * - 'no-value': the IPP out-of-band no-value tag.
 * - 'zero': integer 0, which PAPPL/LPrint treat as automatic speed.
 * Selected with ECO_PRINTER_SPEED_RESET; still to be confirmed against LPrint 1.3.1 on the device.
 */
export type SpeedResetMode = 'no-value' | 'zero';
export const DEFAULT_SPEED_RESET: SpeedResetMode = 'no-value';

export function speedAttribute(speed: number | null, reset: SpeedResetMode): IppAttribute {
  if (speed === null && reset === 'no-value') return attr.noValue('print-speed-default');
  return attr.integer('print-speed-default', inchesToIppSpeed(speed));
}

function translateError(err: unknown): Error {
  if (err instanceof IppUnreachableError) return new PrinterUnreachableError(err.message, { cause: err });
  if (err instanceof IppError) {
    return new PrinterRequestError(err.message, err.statusCode === StatusCode.clientErrorNotFound);
  }
  if (err instanceof IppHttpError) return new PrinterRequestError(err.message);
  if (err instanceof IppDecodeError) {
    return new PrinterRequestError(`The printer service sent a response that could not be read (${err.message})`);
  }
  return err as Error;
}

/** Plain-language status message for a failed status query (undefined = default "cannot reach" text). */
function statusFailureMessage(err: unknown): string | undefined {
  if (err instanceof IppUnreachableError) return undefined;
  if (err instanceof IppHttpError) {
    return `The printer service is not working properly (HTTP ${err.httpStatus}). Restarting LPrint may help.`;
  }
  if (err instanceof IppDecodeError) {
    return 'The printer service sent a response that could not be read. Restarting LPrint may help.';
  }
  if (err instanceof IppError) return `The printer service refused the status request: ${err.message}`;
  return 'Could not read the printer status.';
}

const isKnownIppFailure = (err: unknown) =>
  err instanceof IppUnreachableError ||
  err instanceof IppHttpError ||
  err instanceof IppDecodeError ||
  err instanceof IppError;

export interface IppPrinterOptions {
  now?: () => Date;
  speedReset?: SpeedResetMode;
  /** Called for unexpected errors that getStatus() swallows, so they still get logged. */
  onUnexpectedError?: (err: unknown) => void;
}

export class IppPrinter implements Printer {
  private readonly now: () => Date;
  private readonly speedReset: SpeedResetMode;

  constructor(
    private readonly client: IppClient,
    private readonly options: IppPrinterOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.speedReset = options.speedReset ?? DEFAULT_SPEED_RESET;
  }

  /** Never throws: any failure is reported as state "unreachable" with an explanation. */
  async getStatus(): Promise<PrinterStatus> {
    try {
      const [printerResponse, jobs] = await Promise.all([
        this.client.getPrinterAttributes(PRINTER_STATUS_ATTRIBUTES, STATUS_TIMEOUT_MS),
        this.client.getJobs(QUEUE_JOB_ATTRIBUTES, STATUS_TIMEOUT_MS).catch((err: unknown) => {
          // A failed Get-Jobs should not hide the printer state; show an empty queue instead,
          // unless the service is down altogether.
          if (err instanceof IppUnreachableError) throw err;
          if (!isKnownIppFailure(err)) this.options.onUnexpectedError?.(err);
          return null;
        }),
      ]);
      const printerGroup = groupsOf(printerResponse, DelimiterTag.printerAttributes)[0] ?? {
        tag: DelimiterTag.printerAttributes,
        attributes: [],
      };
      const jobGroups = jobs ? groupsOf(jobs, DelimiterTag.jobAttributes) : [];
      return buildStatus(printerGroup, jobGroups, this.now());
    } catch (err) {
      if (!isKnownIppFailure(err)) this.options.onUnexpectedError?.(err);
      return unreachableStatus(this.now(), statusFailureMessage(err));
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
    if (settings.speed !== undefined) attributes.push(speedAttribute(settings.speed, this.speedReset));
    if (attributes.length === 0) return;
    try {
      await this.client.setPrinterAttributes(attributes, STUDIO_USER_NAME);
    } catch (err) {
      throw translateError(err);
    }
  }
}
