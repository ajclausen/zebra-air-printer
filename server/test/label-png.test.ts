import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  decodePngDataUrl,
  encodeGrayPng,
  InvalidImageError,
  LABEL_PIXELS_PER_METER,
  normalizeLabelPng,
} from '../src/images/label-png.js';
import { makePng, pngChunks, toDataUrl } from './helpers/png.js';

describe('decodePngDataUrl', () => {
  it('decodes base64 PNG data URLs', () => {
    const png = makePng({ width: 2, height: 2 });
    expect(decodePngDataUrl(toDataUrl(png)).equals(png)).toBe(true);
  });

  it('rejects other data URLs and empty payloads', () => {
    expect(() => decodePngDataUrl('data:image/jpeg;base64,AAAA')).toThrow(InvalidImageError);
    expect(() => decodePngDataUrl('https://example.com/a.png')).toThrow(InvalidImageError);
    expect(() => decodePngDataUrl('data:image/png;base64,')).toThrow(InvalidImageError);
  });
});

describe('normalizeLabelPng', () => {
  it('rejects non-PNG bytes', () => {
    expect(() => normalizeLabelPng(Buffer.from('GIF89a not a png at all, definitely not'))).toThrow(/not a PNG/);
  });

  it('rejects wrong dimensions, including landscape', () => {
    expect(() => normalizeLabelPng(makePng({ width: 1218, height: 812 }))).toThrow(/1218x812.*812x1218/);
    expect(() => normalizeLabelPng(makePng({ width: 100, height: 100 }))).toThrow(InvalidImageError);
  });

  it('rejects a corrupt PNG with the right header', () => {
    const png = makePng();
    const corrupt = Buffer.concat([png.subarray(0, 40), Buffer.alloc(64, 0xff)]);
    expect(() => normalizeLabelPng(corrupt)).toThrow(InvalidImageError);
  });

  it('re-encodes as 8-bit grayscale with pHYs 7993 px/m on both axes (203 dpi)', () => {
    const out = normalizeLabelPng(makePng());
    const chunks = pngChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);

    const ihdr = chunks[0]!.data;
    expect(ihdr.readUInt32BE(0)).toBe(812);
    expect(ihdr.readUInt32BE(4)).toBe(1218);
    expect(ihdr.readUInt8(8)).toBe(8); // bit depth
    expect(ihdr.readUInt8(9)).toBe(0); // grayscale

    const phys = chunks[1]!.data;
    expect(LABEL_PIXELS_PER_METER).toBe(7993);
    expect(phys.length).toBe(9);
    expect(phys.readUInt32BE(0)).toBe(7993);
    expect(phys.readUInt32BE(4)).toBe(7993);
    expect(phys.readUInt8(8)).toBe(1); // unit: meter
    expect(phys.toString('hex')).toBe('00001f3900001f3901');
    // 7993 px/m must come out as 203 dpi whether a reader rounds or truncates.
    expect(Math.trunc(7993 * 0.0254)).toBe(203);
    expect(Math.round(7993 * 0.0254)).toBe(203);
  });

  it('produces a PNG that decodes with valid CRCs and preserves black/white pixels', () => {
    const out = normalizeLabelPng(makePng());
    const decoded = PNG.sync.read(out, { checkCRC: true } as never);
    expect(decoded.width).toBe(812);
    const at = (x: number, y: number) => decoded.data[(y * 812 + x) * 4];
    expect(at(0, 0)).toBe(0);
    expect(at(99, 99)).toBe(0);
    expect(at(100, 100)).toBe(255);
    expect(at(811, 1217)).toBe(255);
  });

  it('thresholds anti-aliased grays at 50% luminance and composites transparency on white', () => {
    const out = normalizeLabelPng(
      makePng({
        pixel: (x) => {
          if (x === 0) return [127, 127, 127, 255]; // dark gray -> black
          if (x === 1) return [128, 128, 128, 255]; // light gray -> white
          if (x === 2) return [0, 0, 0, 0]; // transparent -> white
          if (x === 3) return [0, 0, 0, 200]; // mostly opaque black -> black
          if (x === 4) return [255, 0, 0, 255]; // red is dark (luminance 54) -> black
          return [255, 255, 255, 255];
        },
      }),
    );
    const decoded = PNG.sync.read(out);
    const row = [0, 1, 2, 3, 4, 5].map((x) => decoded.data[x * 4]);
    expect(row).toEqual([0, 255, 255, 0, 0, 255]);
    // Every pixel is pure black or white.
    for (let i = 0; i < decoded.data.length; i += 4) {
      const v = decoded.data[i];
      if (v !== 0 && v !== 255) throw new Error(`gray pixel ${v} at ${i / 4}`);
    }
  });

  it('accepts palette and grayscale inputs', () => {
    const gray = encodeGrayPng(812, 1218, new Uint8Array(812 * 1218).fill(255), 3780);
    const out = normalizeLabelPng(gray);
    expect(pngChunks(out)[1]!.data.readUInt32BE(0)).toBe(7993);
  });
});
