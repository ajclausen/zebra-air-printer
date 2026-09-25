import { describe, expect, it } from 'vitest';
import {
  allValues,
  attr,
  decodeMessage,
  encodeMessage,
  firstValue,
  IppDecodeError,
  type IppCollection,
  type IppMessage,
} from '../src/ipp/codec.js';
import { DelimiterTag, Operation, ValueTag } from '../src/ipp/constants.js';

/** Hex helper: whitespace is ignored so fixtures can be laid out one field per line. */
const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
/** Length-prefixed ASCII field as hex. */
const f = (s: string) => Buffer.from(s, 'latin1').length.toString(16).padStart(4, '0') + Buffer.from(s, 'latin1').toString('hex');

describe('IPP encoder', () => {
  it('encodes a Get-Printer-Attributes request byte for byte', () => {
    const message: IppMessage = {
      version: { major: 1, minor: 1 },
      code: Operation.getPrinterAttributes,
      requestId: 7,
      groups: [
        {
          tag: DelimiterTag.operationAttributes,
          attributes: [
            attr.charset('attributes-charset', 'utf-8'),
            attr.naturalLanguage('attributes-natural-language', 'en'),
            attr.uri('printer-uri', 'ipp://127.0.0.1:8000/ipp/print/Zebra_ZP_450'),
            attr.keyword('requested-attributes', 'printer-state', 'printer-state-reasons'),
          ],
        },
      ],
      data: new Uint8Array(),
    };

    const expected = hex(`
      0101 000b 00000007
      01
      47 ${f('attributes-charset')} ${f('utf-8')}
      48 ${f('attributes-natural-language')} ${f('en')}
      45 ${f('printer-uri')} ${f('ipp://127.0.0.1:8000/ipp/print/Zebra_ZP_450')}
      44 ${f('requested-attributes')} ${f('printer-state')}
      44 0000 ${f('printer-state-reasons')}
      03
    `);
    expect(encodeMessage(message).equals(expected)).toBe(true);
  });

  it('encodes integers, enums, booleans, and document data', () => {
    const encoded = encodeMessage({
      version: { major: 1, minor: 1 },
      code: Operation.printJob,
      requestId: 1,
      groups: [
        {
          tag: DelimiterTag.jobAttributes,
          attributes: [attr.integer('copies', 3), attr.enum('orientation-requested', 3), attr.boolean('flag', true)],
        },
      ],
      data: Buffer.from('DATA'),
    });
    expect(encoded).toEqual(
      hex(`
        0101 0002 00000001
        02
        21 ${f('copies')} 0004 00000003
        23 ${f('orientation-requested')} 0004 00000003
        22 ${f('flag')} 0001 01
        03
        44415441
      `),
    );
  });

  it('encodes nested collections', () => {
    const mediaSize: IppCollection = [attr.integer('x-dimension', 10160), attr.integer('y-dimension', 15240)];
    const encoded = encodeMessage({
      version: { major: 1, minor: 1 },
      code: Operation.printJob,
      requestId: 2,
      groups: [
        {
          tag: DelimiterTag.jobAttributes,
          attributes: [attr.collection('media-col', [attr.collection('media-size', mediaSize)])],
        },
      ],
      data: new Uint8Array(),
    });
    expect(encoded).toEqual(
      hex(`
        0101 0002 00000002
        02
        34 ${f('media-col')} 0000
          4a 0000 ${f('media-size')}
          34 0000 0000
            4a 0000 ${f('x-dimension')}
            21 0000 0004 000027b0
            4a 0000 ${f('y-dimension')}
            21 0000 0004 00003b88
          37 0000 0000
        37 0000 0000
        03
      `),
    );
  });
});

describe('IPP decoder', () => {
  // A Get-Printer-Attributes response shaped like LPrint 1.3.1's.
  const lprintResponse = hex(`
    0101 0000 00000007
    01
    47 ${f('attributes-charset')} ${f('utf-8')}
    48 ${f('attributes-natural-language')} ${f('en')}
    41 ${f('status-message')} ${f('successful-ok')}
    04
    42 ${f('printer-name')} ${f('Zebra_ZP_450')}
    23 ${f('printer-state')} 0004 00000005
    44 ${f('printer-state-reasons')} ${f('media-empty-error')}
    44 0000 ${f('offline-report')}
    21 ${f('printer-darkness-configured')} 0004 00000032
    21 ${f('print-speed-default')} 0004 00002968
    34 ${f('media-col-ready')} 0000
      4a 0000 ${f('media-size')}
      34 0000 0000
        4a 0000 ${f('x-dimension')}
        21 0000 0004 000027b0
        4a 0000 ${f('y-dimension')}
        21 0000 0004 00003b88
      37 0000 0000
      4a 0000 ${f('media-size-name')}
      44 0000 ${f('na_index-4x6_4x6in')}
    37 0000 0000
    35 ${f('printer-info')} 0012 ${f('en').slice(0)} ${f('Zebra ZP 450')}
    31 ${f('printer-current-time')} 000b 07ea 09 19 0e 1e 00 00 2d 05 00
    33 ${f('copies-supported')} 0008 00000001 000003e7
    32 ${f('printer-resolution-default')} 0009 000000cb 000000cb 03
    13 ${f('printer-geo-location')} 0000
    03
  `);

  it('decodes header, groups, multi-valued attributes, and scalar types', () => {
    const message = decodeMessage(lprintResponse);
    expect(message.version).toEqual({ major: 1, minor: 1 });
    expect(message.code).toBe(0);
    expect(message.requestId).toBe(7);
    expect(message.groups.map((g) => g.tag)).toEqual([DelimiterTag.operationAttributes, DelimiterTag.printerAttributes]);

    const printer = message.groups[1]!;
    expect(firstValue(printer, 'printer-name')).toBe('Zebra_ZP_450');
    expect(firstValue(printer, 'printer-state')).toBe(5);
    expect(allValues(printer, 'printer-state-reasons')).toEqual(['media-empty-error', 'offline-report']);
    expect(firstValue(printer, 'printer-darkness-configured')).toBe(50);
    expect(firstValue(printer, 'print-speed-default')).toBe(10600);
    expect(firstValue(printer, 'printer-info')).toBe('Zebra ZP 450');
    expect(firstValue(printer, 'copies-supported')).toEqual({ lower: 1, upper: 999 });
    expect(firstValue(printer, 'printer-resolution-default')).toEqual({ x: 203, y: 203, units: 3 });
    expect(firstValue(printer, 'printer-geo-location')).toBeNull();
    // 2026-09-25 14:30:00 at -05:00 is 19:30Z.
    expect((firstValue(printer, 'printer-current-time') as Date).toISOString()).toBe('2026-09-25T19:30:00.000Z');
  });

  it('decodes collections, including nested ones', () => {
    const printer = decodeMessage(lprintResponse).groups[1]!;
    const col = firstValue(printer, 'media-col-ready') as IppCollection;
    expect(col.map((m) => m.name)).toEqual(['media-size', 'media-size-name']);
    const size = firstValue(col, 'media-size') as IppCollection;
    expect(firstValue(size, 'x-dimension')).toBe(10160);
    expect(firstValue(size, 'y-dimension')).toBe(15240);
    expect(firstValue(col, 'media-size-name')).toBe('na_index-4x6_4x6in');
  });

  it('decodes multiple job groups from Get-Jobs', () => {
    const message = decodeMessage(
      hex(`
        0101 0000 00000003
        01
        47 ${f('attributes-charset')} ${f('utf-8')}
        02
        21 ${f('job-id')} 0004 00000001
        42 ${f('job-name')} ${f('label')}
        02
        21 ${f('job-id')} 0004 00000002
        03
      `),
    );
    const jobs = message.groups.filter((g) => g.tag === DelimiterTag.jobAttributes);
    expect(jobs.map((g) => firstValue(g, 'job-id'))).toEqual([1, 2]);
  });

  it('keeps trailing document data', () => {
    const message = decodeMessage(hex(`0101 0002 00000001 01 03 cafebabe`));
    expect(Buffer.from(message.data).toString('hex')).toBe('cafebabe');
  });

  it('rejects truncated messages', () => {
    expect(() => decodeMessage(hex('0101 0000 0000'))).toThrow(IppDecodeError);
    expect(() => decodeMessage(hex(`0101 0000 00000001 01 21 ${f('copies')} 0004 0000`))).toThrow(IppDecodeError);
  });

  it('rejects attributes that appear before any group', () => {
    expect(() => decodeMessage(hex(`0101 0000 00000001 21 ${f('copies')} 0004 00000001 03`))).toThrow(
      IppDecodeError,
    );
  });
});

describe('IPP round trip', () => {
  it('decode(encode(m)) preserves every supported value type', () => {
    const when = new Date('2026-09-25T18:01:02.300Z');
    const message: IppMessage = {
      version: { major: 1, minor: 1 },
      code: Operation.setPrinterAttributes,
      requestId: 123456,
      groups: [
        {
          tag: DelimiterTag.operationAttributes,
          attributes: [
            attr.charset('attributes-charset', 'utf-8'),
            attr.naturalLanguage('attributes-natural-language', 'en'),
            attr.name('requesting-user-name', 'label-studio'),
            attr.text('message', 'héllo'),
            attr.mimeMediaType('document-format', 'image/png'),
          ],
        },
        {
          tag: DelimiterTag.printerAttributes,
          attributes: [
            attr.integer('printer-darkness-configured', 75),
            attr.integer('negative', -5),
            attr.enum('printer-state', 3),
            attr.boolean('ok', false),
            attr.dateTime('when', when),
            attr.resolution('res', { x: 203, y: 203, units: 3 }),
            attr.range('range', { lower: 1, upper: 100 }),
            attr.keyword('many', 'a', 'b', 'c'),
            attr.collection(
              'media-col',
              [attr.keyword('media-source', 'main'), attr.collection('media-size', [attr.integer('x-dimension', 1)])],
              [attr.keyword('media-source', 'alternate')],
            ),
            attr.noValue('nothing'),
            { name: 'raw', values: [{ tag: ValueTag.octetString, data: new Uint8Array([1, 2, 3]) }] },
          ],
        },
      ],
      data: new Uint8Array([9, 8, 7]),
    };
    const decoded = decodeMessage(encodeMessage(message));
    expect(decoded).toEqual(message);
  });
});
