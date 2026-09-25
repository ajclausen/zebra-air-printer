import { describe, expect, it } from 'vitest';
import {
  blackRatio,
  createBitmap,
  finalizeLabelBitmap,
  floydSteinberg,
  isPureMonochrome,
  LabelSizeError,
  paperLuminance,
  rotateClockwise,
  threshold,
  type Bitmap,
} from './bitmap';

function setPixel(bitmap: Bitmap, x: number, y: number, rgba: [number, number, number, number]): void {
  bitmap.data.set(rgba, (y * bitmap.width + x) * 4);
}

function pixel(bitmap: Bitmap, x: number, y: number): number[] {
  const p = (y * bitmap.width + x) * 4;
  return Array.from(bitmap.data.slice(p, p + 4));
}

function gray(width: number, height: number, value: number): Bitmap {
  const bitmap = createBitmap(width, height);
  for (let p = 0; p < bitmap.data.length; p += 4) bitmap.data.set([value, value, value, 255], p);
  return bitmap;
}

describe('paperLuminance', () => {
  it('treats transparency as white paper', () => {
    expect(paperLuminance(0, 0, 0, 0)).toBe(255);
    expect(paperLuminance(0, 0, 0, 255)).toBe(0);
    expect(paperLuminance(0, 0, 0, 128)).toBeCloseTo(127, 0);
  });
});

describe('threshold', () => {
  it('cuts at 50% luminance and emits opaque pure black/white', () => {
    const bitmap = createBitmap(4, 1);
    setPixel(bitmap, 0, 0, [127, 127, 127, 255]);
    setPixel(bitmap, 1, 0, [128, 128, 128, 255]);
    setPixel(bitmap, 2, 0, [255, 0, 0, 255]); // red: luminance 76 -> black
    setPixel(bitmap, 3, 0, [0, 0, 0, 0]); // transparent -> white
    const out = threshold(bitmap);
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(out, 2, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 3, 0)).toEqual([255, 255, 255, 255]);
    expect(isPureMonochrome(out)).toBe(true);
  });

  it('supports a custom level, inversion, and transparent white', () => {
    const out = threshold(gray(2, 1, 100), { threshold: 90, invert: true, transparentWhite: true });
    // 100 >= 90 -> white, inverted -> black
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 255]);
    const out2 = threshold(gray(1, 1, 200), { transparentWhite: true });
    expect(pixel(out2, 0, 0)).toEqual([255, 255, 255, 0]);
  });
});

describe('floydSteinberg', () => {
  it('produces pure black/white with density matching the gray level', () => {
    for (const level of [32, 128, 192]) {
      const out = floydSteinberg(gray(64, 64, level));
      expect(isPureMonochrome(out)).toBe(true);
      expect(blackRatio(out)).toBeCloseTo(1 - level / 255, 1);
    }
  });

  it('keeps solid black and white solid', () => {
    expect(blackRatio(floydSteinberg(gray(16, 16, 0)))).toBe(1);
    expect(blackRatio(floydSteinberg(gray(16, 16, 255)))).toBe(0);
  });

  it('is deterministic', () => {
    const a = floydSteinberg(gray(20, 20, 90));
    const b = floydSteinberg(gray(20, 20, 90));
    expect(a.data).toEqual(b.data);
  });

  it('leaves fully transparent pixels white', () => {
    const bitmap = gray(3, 1, 0);
    setPixel(bitmap, 1, 0, [0, 0, 0, 0]);
    const out = floydSteinberg(bitmap);
    expect(pixel(out, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('rotateClockwise', () => {
  it('swaps dimensions and moves the top-left pixel to the top-right', () => {
    const bitmap = createBitmap(3, 2);
    setPixel(bitmap, 0, 0, [1, 2, 3, 255]); // top-left
    setPixel(bitmap, 2, 1, [9, 8, 7, 255]); // bottom-right
    setPixel(bitmap, 0, 1, [5, 5, 5, 255]); // bottom-left
    const out = rotateClockwise(bitmap);
    expect([out.width, out.height]).toEqual([2, 3]);
    expect(pixel(out, 1, 0)).toEqual([1, 2, 3, 255]);
    expect(pixel(out, 0, 2)).toEqual([9, 8, 7, 255]);
    expect(pixel(out, 0, 0)).toEqual([5, 5, 5, 255]);
  });

  it('returns to the original after four turns', () => {
    const bitmap = floydSteinberg(gray(7, 5, 120));
    const back = rotateClockwise(rotateClockwise(rotateClockwise(rotateClockwise(bitmap))));
    expect(back.width).toBe(7);
    expect(back.data).toEqual(bitmap.data);
  });
});

describe('finalizeLabelBitmap', () => {
  it('outputs 812x1218 pure black/white for portrait labels', () => {
    const rendered = gray(812, 1218, 100);
    setPixel(rendered, 0, 0, [250, 250, 250, 255]);
    const out = finalizeLabelBitmap(rendered, 'portrait', 812, 1218);
    expect([out.width, out.height]).toEqual([812, 1218]);
    expect(isPureMonochrome(out)).toBe(true);
    expect(pixel(out, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(out, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it('rotates landscape labels clockwise into 812x1218', () => {
    const rendered = gray(1218, 812, 255);
    setPixel(rendered, 0, 0, [0, 0, 0, 255]); // landscape top-left
    const out = finalizeLabelBitmap(rendered, 'landscape', 812, 1218);
    expect([out.width, out.height]).toEqual([812, 1218]);
    expect(pixel(out, 811, 0)).toEqual([0, 0, 0, 255]);
    expect(blackRatio(out)).toBeCloseTo(1 / (812 * 1218), 8);
  });

  it('rejects renders of the wrong size', () => {
    expect(() => finalizeLabelBitmap(gray(812, 1218, 0), 'landscape', 812, 1218)).toThrow(LabelSizeError);
    expect(() => finalizeLabelBitmap(gray(800, 1218, 0), 'portrait', 812, 1218)).toThrow(LabelSizeError);
  });
});
