import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { InvalidImageError } from '../src/images/label-png.js';
import { encodePbm, fitToLabel, parsePbm, pbmToLabelPng, type Bitmap } from '../src/images/pbm.js';
import { pngChunks } from './helpers/png.js';

function bitmap(width: number, height: number, black: (x: number, y: number) => boolean): Bitmap {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = black(x, y) ? 0 : 255;
  return { width, height, gray };
}

describe('parsePbm', () => {
  it('reads P4 with MSB-first bits, 1 = black, and rows padded to whole bytes', () => {
    // 10 x 2: row 0 = 1000000001, row 1 = 0100000010; each row takes 2 bytes.
    const data = Buffer.concat([Buffer.from('P4\n10 2\n'), Buffer.from([0b10000000, 0b01000000, 0b01000000, 0b10000000])]);
    const { width, height, gray } = parsePbm(data);
    expect([width, height]).toEqual([10, 2]);
    const rows = [0, 1].map((y) => [...gray.slice(y * 10, y * 10 + 10)].map((v) => (v === 0 ? 1 : 0)).join(''));
    expect(rows).toEqual(['1000000001', '0100000010']);
  });

  it('accepts comments and any whitespace in the header', () => {
    const data = Buffer.concat([Buffer.from('P4 # captured by lprint\n# another\n 3\t1\n'), Buffer.from([0b10100000])]);
    expect([...parsePbm(data).gray]).toEqual([0, 255, 0]);
  });

  it('round-trips odd widths through encodePbm', () => {
    const original = bitmap(13, 5, (x, y) => (x + y) % 3 === 0);
    const encoded = encodePbm(original);
    expect(encoded.length).toBe('P4\n13 5\n'.length + 2 * 5);
    expect(parsePbm(encoded)).toEqual(original);
  });

  it('rejects other formats and truncated data', () => {
    expect(() => parsePbm(Buffer.from('P1\n1 1\n1'))).toThrow(InvalidImageError);
    expect(() => parsePbm(Buffer.from('P4\n8 2\n\x00'))).toThrow(/truncated/);
    expect(() => parsePbm(Buffer.from('P4\nx y\n'))).toThrow(/malformed/);
  });
});

describe('fitToLabel', () => {
  it('pads smaller bitmaps centered on white', () => {
    const small = bitmap(4, 2, () => true);
    const fitted = fitToLabel(small, 8, 6);
    const rows = Array.from({ length: 6 }, (_, y) =>
      [...fitted.gray.slice(y * 8, y * 8 + 8)].map((v) => (v === 0 ? '#' : '.')).join(''),
    );
    expect(rows).toEqual(['........', '........', '..####..', '..####..', '........', '........']);
  });

  it('crops larger bitmaps around the center', () => {
    const big = bitmap(6, 4, (x) => x === 0 || x === 5); // edges black, middle white
    const fitted = fitToLabel(big, 4, 2);
    expect([...fitted.gray]).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
  });
});

describe('pbmToLabelPng', () => {
  it('converts an 812x1218 capture to a grayscale PNG with pHYs 7993', () => {
    const page = bitmap(812, 1218, (x, y) => x < 10 || y < 10);
    const { png, resizedFrom } = pbmToLabelPng(encodePbm(page));
    expect(resizedFrom).toBeNull();
    const chunks = pngChunks(png);
    expect(chunks[1]!.type).toBe('pHYs');
    expect(chunks[1]!.data.toString('hex')).toBe('00001f3900001f3901');
    const decoded = PNG.sync.read(png);
    expect([decoded.width, decoded.height]).toEqual([812, 1218]);
    expect(decoded.data[0]).toBe(0);
    expect(decoded.data[(20 * 812 + 20) * 4]).toBe(255);
  });

  it('pads other sizes to 812x1218 and reports the original size', () => {
    const page = bitmap(801, 1200, () => true);
    const { png, resizedFrom } = pbmToLabelPng(encodePbm(page));
    expect(resizedFrom).toEqual({ width: 801, height: 1200 });
    const decoded = PNG.sync.read(png);
    expect([decoded.width, decoded.height]).toEqual([812, 1218]);
    const at = (x: number, y: number) => decoded.data[(y * 812 + x) * 4];
    expect(at(0, 0)).toBe(255); // padding
    expect(at(5, 9)).toBe(0); // dx = 5, dy = 9
    expect(at(406, 609)).toBe(0);
    expect(at(811, 1217)).toBe(255);
  });
});
