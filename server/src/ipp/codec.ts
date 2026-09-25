// Hand-written IPP/1.1 binary encoder and decoder (RFC 8010 section 3).
//
// A message is: version (2 bytes), operation-id or status-code (2), request-id (4),
// then attribute groups, the end-of-attributes tag, and optional document data.

import { DelimiterTag, ValueTag } from './constants.js';

export interface IppResolution {
  x: number;
  y: number;
  /** 3 = dots per inch, 4 = dots per centimeter. */
  units: number;
}

export interface IppRange {
  lower: number;
  upper: number;
}

/** A collection is an ordered list of member attributes. */
export type IppCollection = IppAttribute[];

export type IppData =
  | number
  | boolean
  | string
  | Date
  | IppResolution
  | IppRange
  | IppCollection
  | Uint8Array
  | null; // out-of-band (unsupported, unknown, no-value)

export interface IppValue {
  tag: number;
  data: IppData;
}

export interface IppAttribute {
  name: string;
  values: IppValue[];
}

export interface IppGroup {
  tag: number;
  attributes: IppAttribute[];
}

export interface IppMessage {
  version: { major: number; minor: number };
  /** operation-id in requests, status-code in responses. */
  code: number;
  requestId: number;
  groups: IppGroup[];
  data: Uint8Array;
}

export class IppDecodeError extends Error {
  override name = 'IppDecodeError';
}

// ---------------------------------------------------------------------------
// Attribute builders
// ---------------------------------------------------------------------------

function simple(tag: number) {
  return (name: string, ...data: IppData[]): IppAttribute => ({
    name,
    values: data.map((d) => ({ tag, data: d })),
  });
}

export const attr = {
  integer: simple(ValueTag.integer) as (name: string, ...v: number[]) => IppAttribute,
  enum: simple(ValueTag.enum) as (name: string, ...v: number[]) => IppAttribute,
  boolean: simple(ValueTag.boolean) as (name: string, ...v: boolean[]) => IppAttribute,
  keyword: simple(ValueTag.keyword) as (name: string, ...v: string[]) => IppAttribute,
  name: simple(ValueTag.nameWithoutLanguage) as (name: string, ...v: string[]) => IppAttribute,
  text: simple(ValueTag.textWithoutLanguage) as (name: string, ...v: string[]) => IppAttribute,
  uri: simple(ValueTag.uri) as (name: string, ...v: string[]) => IppAttribute,
  charset: simple(ValueTag.charset) as (name: string, ...v: string[]) => IppAttribute,
  naturalLanguage: simple(ValueTag.naturalLanguage) as (name: string, ...v: string[]) => IppAttribute,
  mimeMediaType: simple(ValueTag.mimeMediaType) as (name: string, ...v: string[]) => IppAttribute,
  dateTime: simple(ValueTag.dateTime) as (name: string, ...v: Date[]) => IppAttribute,
  resolution: simple(ValueTag.resolution) as (name: string, ...v: IppResolution[]) => IppAttribute,
  range: simple(ValueTag.rangeOfInteger) as (name: string, ...v: IppRange[]) => IppAttribute,
  collection: simple(ValueTag.begCollection) as (name: string, ...v: IppCollection[]) => IppAttribute,
  noValue: (name: string): IppAttribute => ({ name, values: [{ tag: ValueTag.noValue, data: null }] }),
};

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

class ByteWriter {
  private chunks: Buffer[] = [];

  u8(n: number): void {
    const b = Buffer.alloc(1);
    b.writeUInt8(n);
    this.chunks.push(b);
  }
  u16(n: number): void {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    this.chunks.push(b);
  }
  i32(n: number): void {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.chunks.push(b);
  }
  bytes(b: Uint8Array): void {
    this.chunks.push(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  }
  /** A length-prefixed (2-byte) field. */
  field(b: Uint8Array): void {
    if (b.byteLength > 0xffff) throw new RangeError('IPP field longer than 65535 bytes');
    this.u16(b.byteLength);
    this.bytes(b);
  }
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const utf8 = (s: string) => Buffer.from(s, 'utf8');

function encodeDateTime(d: Date): Buffer {
  const b = Buffer.alloc(11);
  b.writeUInt16BE(d.getUTCFullYear(), 0);
  b.writeUInt8(d.getUTCMonth() + 1, 2);
  b.writeUInt8(d.getUTCDate(), 3);
  b.writeUInt8(d.getUTCHours(), 4);
  b.writeUInt8(d.getUTCMinutes(), 5);
  b.writeUInt8(d.getUTCSeconds(), 6);
  b.writeUInt8(Math.floor(d.getUTCMilliseconds() / 100), 7);
  b.write('+', 8, 'ascii');
  b.writeUInt8(0, 9);
  b.writeUInt8(0, 10);
  return b;
}

function encodeScalar(tag: number, data: IppData): Buffer {
  switch (tag) {
    case ValueTag.integer:
    case ValueTag.enum: {
      const b = Buffer.alloc(4);
      b.writeInt32BE(data as number);
      return b;
    }
    case ValueTag.boolean:
      return Buffer.from([data ? 1 : 0]);
    case ValueTag.dateTime:
      return encodeDateTime(data as Date);
    case ValueTag.resolution: {
      const r = data as IppResolution;
      const b = Buffer.alloc(9);
      b.writeInt32BE(r.x, 0);
      b.writeInt32BE(r.y, 4);
      b.writeInt8(r.units, 8);
      return b;
    }
    case ValueTag.rangeOfInteger: {
      const r = data as IppRange;
      const b = Buffer.alloc(8);
      b.writeInt32BE(r.lower, 0);
      b.writeInt32BE(r.upper, 4);
      return b;
    }
    case ValueTag.textWithLanguage:
    case ValueTag.nameWithLanguage: {
      const w = new ByteWriter();
      w.field(utf8('en'));
      w.field(utf8(data as string));
      return w.toBuffer();
    }
    case ValueTag.octetString:
      return Buffer.from(data as Uint8Array);
    case ValueTag.unsupported:
    case ValueTag.unknown:
    case ValueTag.noValue:
      return Buffer.alloc(0);
    default:
      if (typeof data !== 'string') throw new TypeError(`IPP tag 0x${tag.toString(16)} expects a string`);
      return utf8(data);
  }
}

function writeValue(w: ByteWriter, name: string, value: IppValue): void {
  w.u8(value.tag);
  w.field(utf8(name));
  if (value.tag === ValueTag.begCollection) {
    w.field(Buffer.alloc(0));
    writeCollectionMembers(w, value.data as IppCollection);
    w.u8(ValueTag.endCollection);
    w.field(Buffer.alloc(0));
    w.field(Buffer.alloc(0));
    return;
  }
  w.field(encodeScalar(value.tag, value.data));
}

function writeCollectionMembers(w: ByteWriter, members: IppCollection): void {
  for (const member of members) {
    w.u8(ValueTag.memberAttrName);
    w.field(Buffer.alloc(0));
    w.field(utf8(member.name));
    for (const value of member.values) writeValue(w, '', value);
  }
}

function writeAttribute(w: ByteWriter, attribute: IppAttribute): void {
  attribute.values.forEach((value, i) => writeValue(w, i === 0 ? attribute.name : '', value));
}

export function encodeMessage(message: IppMessage): Buffer {
  const w = new ByteWriter();
  w.u8(message.version.major);
  w.u8(message.version.minor);
  w.u16(message.code);
  w.i32(message.requestId);
  for (const group of message.groups) {
    w.u8(group.tag);
    for (const attribute of group.attributes) writeAttribute(w, attribute);
  }
  w.u8(DelimiterTag.endOfAttributes);
  w.bytes(message.data);
  return w.toBuffer();
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

class ByteReader {
  offset = 0;
  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }
  private need(n: number): void {
    if (this.remaining < n) throw new IppDecodeError(`Truncated IPP message at byte ${this.offset}`);
  }
  u8(): number {
    this.need(1);
    return this.buf.readUInt8(this.offset++);
  }
  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  bytes(n: number): Buffer {
    this.need(n);
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  field(): Buffer {
    return this.bytes(this.u16());
  }
  rest(): Buffer {
    const v = this.buf.subarray(this.offset);
    this.offset = this.buf.length;
    return v;
  }
}

function decodeDateTime(b: Buffer): Date {
  if (b.length !== 11) throw new IppDecodeError('dateTime value must be 11 bytes');
  const sign = String.fromCharCode(b.readUInt8(8)) === '-' ? -1 : 1;
  const offsetMinutes = sign * (b.readUInt8(9) * 60 + b.readUInt8(10));
  const utc = Date.UTC(
    b.readUInt16BE(0),
    b.readUInt8(2) - 1,
    b.readUInt8(3),
    b.readUInt8(4),
    b.readUInt8(5),
    b.readUInt8(6),
    b.readUInt8(7) * 100,
  );
  return new Date(utc - offsetMinutes * 60_000);
}

function decodeScalar(tag: number, b: Buffer): IppData {
  switch (tag) {
    case ValueTag.integer:
    case ValueTag.enum:
      if (b.length !== 4) throw new IppDecodeError('integer value must be 4 bytes');
      return b.readInt32BE(0);
    case ValueTag.boolean:
      if (b.length !== 1) throw new IppDecodeError('boolean value must be 1 byte');
      return b.readUInt8(0) !== 0;
    case ValueTag.dateTime:
      return decodeDateTime(b);
    case ValueTag.resolution:
      if (b.length !== 9) throw new IppDecodeError('resolution value must be 9 bytes');
      return { x: b.readInt32BE(0), y: b.readInt32BE(4), units: b.readInt8(8) };
    case ValueTag.rangeOfInteger:
      if (b.length !== 8) throw new IppDecodeError('rangeOfInteger value must be 8 bytes');
      return { lower: b.readInt32BE(0), upper: b.readInt32BE(4) };
    case ValueTag.textWithLanguage:
    case ValueTag.nameWithLanguage: {
      const r = new ByteReader(b);
      r.field(); // natural language, not needed
      return r.field().toString('utf8');
    }
    case ValueTag.unsupported:
    case ValueTag.unknown:
    case ValueTag.noValue:
      return null;
    default:
      // Character-string types; anything unrecognised (including octetString and
      // extension types) is kept as raw bytes.
      if (tag >= 0x40 && tag <= 0x5f) return b.toString('utf8');
      return new Uint8Array(b);
  }
}

/** Reads collection members up to and including the matching endCollection. */
function readCollection(r: ByteReader): IppCollection {
  const members: IppCollection = [];
  let current: IppAttribute | undefined;
  for (;;) {
    const tag = r.u8();
    r.field(); // member values always have an empty name
    if (tag === ValueTag.endCollection) {
      r.field();
      return members;
    }
    if (tag === ValueTag.memberAttrName) {
      current = { name: r.field().toString('utf8'), values: [] };
      members.push(current);
      continue;
    }
    if (!current) throw new IppDecodeError('Collection value without a member name');
    if (tag === ValueTag.begCollection) {
      r.field();
      current.values.push({ tag, data: readCollection(r) });
    } else {
      current.values.push({ tag, data: decodeScalar(tag, r.field()) });
    }
  }
}

export function decodeMessage(input: Uint8Array): IppMessage {
  const r = new ByteReader(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  const major = r.u8();
  const minor = r.u8();
  const code = r.u16();
  const requestId = r.i32();
  const groups: IppGroup[] = [];
  let group: IppGroup | undefined;
  let last: IppAttribute | undefined;

  for (;;) {
    const tag = r.u8();
    if (tag === DelimiterTag.endOfAttributes) break;
    if (tag < 0x10) {
      group = { tag, attributes: [] };
      groups.push(group);
      last = undefined;
      continue;
    }
    if (!group) throw new IppDecodeError('Attribute before any group delimiter');
    const name = r.field().toString('utf8');
    let value: IppValue;
    if (tag === ValueTag.begCollection) {
      r.field();
      value = { tag, data: readCollection(r) };
    } else {
      value = { tag, data: decodeScalar(tag, r.field()) };
    }
    if (name === '') {
      if (!last) throw new IppDecodeError('Additional value without an attribute');
      last.values.push(value);
    } else {
      last = { name, values: [value] };
      group.attributes.push(last);
    }
  }

  return { version: { major, minor }, code, requestId, groups, data: new Uint8Array(r.rest()) };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Finds an attribute in the first group with the given delimiter tag that has it. */
export function findAttribute(
  source: IppMessage | IppGroup | IppCollection,
  name: string,
): IppAttribute | undefined {
  if (Array.isArray(source)) return source.find((a) => a.name === name);
  if ('attributes' in source) return source.attributes.find((a) => a.name === name);
  for (const group of source.groups) {
    const found = group.attributes.find((a) => a.name === name);
    if (found) return found;
  }
  return undefined;
}

export function firstValue(source: IppMessage | IppGroup | IppCollection, name: string): IppData | undefined {
  return findAttribute(source, name)?.values[0]?.data;
}

export function allValues(source: IppMessage | IppGroup | IppCollection, name: string): IppData[] {
  return findAttribute(source, name)?.values.map((v) => v.data) ?? [];
}

export function groupsOf(message: IppMessage, tag: number): IppGroup[] {
  return message.groups.filter((g) => g.tag === tag);
}
