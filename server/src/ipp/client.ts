// Minimal IPP client: one request per HTTP POST (Content-Type: application/ipp).

import {
  attr,
  decodeMessage,
  encodeMessage,
  groupsOf,
  type IppAttribute,
  type IppGroup,
  type IppMessage,
} from './codec.js';
import { DelimiterTag, Operation } from './constants.js';

export class IppError extends Error {
  override name = 'IppError';
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** The printer service did not answer (connection refused, timeout, HTTP error). */
export class IppUnreachableError extends Error {
  override name = 'IppUnreachableError';
}

export interface IppRequest {
  operation: number;
  operationAttributes?: IppAttribute[];
  jobAttributes?: IppAttribute[];
  printerAttributes?: IppAttribute[];
  data?: Uint8Array;
  timeoutMs?: number;
}

export interface PrintJobOptions {
  documentFormat: string;
  jobName: string;
  userName: string;
  jobAttributes?: IppAttribute[];
  data: Uint8Array;
}

/** Converts ipp://host:port/path to the http:// URL the request is POSTed to. */
export function httpUrlFor(printerUri: string): string {
  const url = new URL(printerUri);
  if (url.protocol !== 'ipp:' && url.protocol !== 'ipps:') return url.toString();
  // Rebuilt as a string: WHATWG URL refuses to switch a non-special scheme (ipp:) to http:.
  const scheme = url.protocol === 'ipps:' ? 'https' : 'http';
  return `${scheme}://${url.hostname}:${url.port || '631'}${url.pathname}${url.search}`;
}

export class IppClient {
  private nextRequestId = 1;
  private readonly httpUrl: string;

  constructor(
    readonly printerUri: string,
    private readonly defaultTimeoutMs = 10_000,
  ) {
    this.httpUrl = httpUrlFor(printerUri);
  }

  async send(request: IppRequest): Promise<IppMessage> {
    const groups: IppGroup[] = [
      {
        tag: DelimiterTag.operationAttributes,
        attributes: [
          attr.charset('attributes-charset', 'utf-8'),
          attr.naturalLanguage('attributes-natural-language', 'en'),
          attr.uri('printer-uri', this.printerUri),
          ...(request.operationAttributes ?? []),
        ],
      },
    ];
    if (request.jobAttributes?.length) {
      groups.push({ tag: DelimiterTag.jobAttributes, attributes: request.jobAttributes });
    }
    if (request.printerAttributes?.length) {
      groups.push({ tag: DelimiterTag.printerAttributes, attributes: request.printerAttributes });
    }
    const body = encodeMessage({
      version: { major: 1, minor: 1 },
      code: request.operation,
      requestId: this.nextRequestId++,
      groups,
      data: request.data ?? new Uint8Array(),
    });

    let response: Response;
    try {
      response = await fetch(this.httpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/ipp' },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(request.timeoutMs ?? this.defaultTimeoutMs),
      });
    } catch (err) {
      throw new IppUnreachableError(`Printer service did not respond: ${(err as Error).message}`, { cause: err });
    }
    if (!response.ok) {
      throw new IppUnreachableError(`Printer service returned HTTP ${response.status}`);
    }

    const message = decodeMessage(new Uint8Array(await response.arrayBuffer()));
    // 0x0000-0x00FF are successful-* status codes.
    if (message.code > 0x00ff) {
      const statusMessage = message.groups
        .flatMap((g) => g.attributes)
        .find((a) => a.name === 'status-message')?.values[0]?.data;
      throw new IppError(
        message.code,
        typeof statusMessage === 'string'
          ? statusMessage
          : `IPP status 0x${message.code.toString(16).padStart(4, '0')}`,
      );
    }
    return message;
  }

  async printJob(options: PrintJobOptions): Promise<number> {
    const response = await this.send({
      operation: Operation.printJob,
      operationAttributes: [
        attr.name('requesting-user-name', options.userName),
        attr.name('job-name', options.jobName),
        attr.mimeMediaType('document-format', options.documentFormat),
      ],
      jobAttributes: options.jobAttributes,
      data: options.data,
      timeoutMs: 60_000,
    });
    const jobId = groupsOf(response, DelimiterTag.jobAttributes)[0]?.attributes.find((a) => a.name === 'job-id')
      ?.values[0]?.data;
    if (typeof jobId !== 'number') throw new IppError(response.code, 'Printer did not return a job-id');
    return jobId;
  }

  getPrinterAttributes(requested: string[], timeoutMs?: number): Promise<IppMessage> {
    return this.send({
      operation: Operation.getPrinterAttributes,
      operationAttributes: [attr.keyword('requested-attributes', ...requested)],
      timeoutMs,
    });
  }

  getJobs(requested: string[], timeoutMs?: number): Promise<IppMessage> {
    return this.send({
      operation: Operation.getJobs,
      operationAttributes: [
        attr.keyword('which-jobs', 'not-completed'),
        attr.keyword('requested-attributes', ...requested),
      ],
      timeoutMs,
    });
  }

  async cancelJob(jobId: number, userName: string): Promise<void> {
    await this.send({
      operation: Operation.cancelJob,
      operationAttributes: [attr.integer('job-id', jobId), attr.name('requesting-user-name', userName)],
    });
  }

  async setPrinterAttributes(attributes: IppAttribute[], userName: string): Promise<void> {
    await this.send({
      operation: Operation.setPrinterAttributes,
      operationAttributes: [attr.name('requesting-user-name', userName)],
      printerAttributes: attributes,
    });
  }
}
