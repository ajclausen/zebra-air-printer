// A tiny IPP server for tests: decodes every request, records it, and answers per operation.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { attr, decodeMessage, encodeMessage, type IppAttribute, type IppGroup, type IppMessage } from '../../src/ipp/codec.js';
import { DelimiterTag, Operation } from '../../src/ipp/constants.js';

export interface FakeIppServer {
  uri: string;
  requests: IppMessage[];
  /** Printer attributes returned by Get-Printer-Attributes. */
  printerAttributes: IppAttribute[];
  /** Job groups returned by Get-Jobs. */
  jobs: IppAttribute[][];
  /** Status code for the next Print-Job responses (default successful-ok). */
  printStatus: number;
  /** Fail Print-Job after this many successful jobs (for partial-failure tests). */
  failPrintAfter: number | null;
  close(): Promise<void>;
}

function response(request: IppMessage, code: number, extraGroups: IppGroup[] = []): Buffer {
  return encodeMessage({
    version: { major: 1, minor: 1 },
    code,
    requestId: request.requestId,
    groups: [
      {
        tag: DelimiterTag.operationAttributes,
        attributes: [
          attr.charset('attributes-charset', 'utf-8'),
          attr.naturalLanguage('attributes-natural-language', 'en'),
          attr.text('status-message', code === 0 ? 'successful-ok' : 'client-error'),
        ],
      },
      ...extraGroups,
    ],
    data: new Uint8Array(),
  });
}

export async function startFakeIppServer(): Promise<FakeIppServer> {
  let nextJobId = 1;
  let printed = 0;
  const state: Omit<FakeIppServer, 'uri' | 'close'> = {
    requests: [],
    printerAttributes: [
      attr.name('printer-name', 'Zebra_ZP_450'),
      attr.enum('printer-state', 3),
      attr.keyword('printer-state-reasons', 'none'),
      attr.integer('printer-darkness-configured', 50),
      attr.integer('print-speed-default', 10160),
      attr.keyword('media-ready', 'na_index-4x6_4x6in'),
    ],
    jobs: [],
    printStatus: 0,
    failPrintAfter: null,
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const request = decodeMessage(Buffer.concat(chunks));
      state.requests.push(request);
      let body: Buffer;
      switch (request.code) {
        case Operation.printJob: {
          const fail = state.failPrintAfter !== null && printed >= state.failPrintAfter;
          if (state.printStatus !== 0 || fail) {
            body = response(request, state.printStatus || 0x0500);
            break;
          }
          printed++;
          body = response(request, 0, [
            { tag: DelimiterTag.jobAttributes, attributes: [attr.integer('job-id', nextJobId++), attr.enum('job-state', 3)] },
          ]);
          break;
        }
        case Operation.getPrinterAttributes:
          body = response(request, 0, [{ tag: DelimiterTag.printerAttributes, attributes: state.printerAttributes }]);
          break;
        case Operation.getJobs:
          body = response(
            request,
            0,
            state.jobs.map((attributes) => ({ tag: DelimiterTag.jobAttributes, attributes })),
          );
          break;
        case Operation.cancelJob: {
          const id = request.groups[0]?.attributes.find((a) => a.name === 'job-id')?.values[0]?.data;
          body = response(request, id === 404 ? 0x0406 : 0);
          break;
        }
        default:
          body = response(request, 0);
      }
      res.writeHead(200, { 'content-type': 'application/ipp' });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(state, {
    uri: `ipp://127.0.0.1:${port}/ipp/print/Zebra_ZP_450`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}
