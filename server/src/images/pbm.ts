// Binary PBM (P4) bitmaps captured by the patched LPrint driver -> label PNGs.

import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';
import { encodeGrayPng, InvalidImageError, LABEL_PIXELS_PER_METER } from './label-png.js';

export interface Bitmap {
  width: number;
  height: number;
  /** One byte per pixel: 0 = black, 255 = white. */
  gray: Uint8Array;
}

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;

/**
 * Parses a binary PBM: "P4", whitespace/comments, width, height, one whitespace byte,
 * then rows of ceil(width / 8) bytes, most significant bit first, 1 = black.
 */
export function parsePbm(data: Buffer): Bitmap {
  if (data.length < 2 || data[0] !== 0x50 || data[1] !== 0x34) throw new InvalidImageError('Not a binary PBM (P4) file');
  let pos = 2;
  const readNumber = (): number => {
    for (;;) {
      while (pos < data.length && isSpace(data[pos]!)) pos++;
      if (data[pos] === 0x23) {
        while (pos < data.length && data[pos] !== 0x0a && data[pos] !== 0x0d) pos++;
        continue;
      }
      break;
    }
    const start = pos;
    while (pos < data.length && data[pos]! >= 0x30 && data[pos]! <= 0x39) pos++;
    if (pos === start) throw new InvalidImageError('PBM header is malformed');
    return Number(data.toString('latin1', start, pos));
  };
  const width = readNumber();
  const height = readNumber();
  if (!isSpace(data[pos] ?? 0)) throw new InvalidImageError('PBM header is malformed');
  pos++;
  if (width < 1 || height < 1 || width > 10_000 || height > 10_000) {
    throw new InvalidImageError(`PBM size ${width}x${height} is out of range`);
  }
  const rowBytes = Math.ceil(width / 8);
  if (data.length - pos < rowBytes * height) throw new InvalidImageError('PBM pixel data is truncated');

  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = pos + y * rowBytes;
    for (let x = 0; x < width; x++) {
      const bit = (data[row + (x >> 3)]! >> (7 - (x & 7))) & 1;
      gray[y * width + x] = bit ? 0 : 255;
    }
  }
  return { width, height, gray };
}

/** Encodes a bitmap as binary PBM (used by the fake printer and tests). */
export function encodePbm(bitmap: Bitmap): Buffer {
  const rowBytes = Math.ceil(bitmap.width / 8);
  const header = Buffer.from(`P4\n${bitmap.width} ${bitmap.height}\n`, 'latin1');
  const body = Buffer.alloc(rowBytes * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.gray[y * bitmap.width + x]! < 128) body[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, body]);
}

/** Centers a bitmap on a white label-sized canvas, padding or cropping as needed. */
export function fitToLabel(bitmap: Bitmap, width = LABEL_WIDTH_DOTS, height = LABEL_HEIGHT_DOTS): Bitmap {
  if (bitmap.width === width && bitmap.height === height) return bitmap;
  const gray = new Uint8Array(width * height).fill(255);
  const dx = Math.floor((width - bitmap.width) / 2);
  const dy = Math.floor((height - bitmap.height) / 2);
  for (let y = 0; y < height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= bitmap.height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= bitmap.width) continue;
      gray[y * width + x] = bitmap.gray[sy * bitmap.width + sx]!;
    }
  }
  return { width, height, gray };
}

export interface CapturedPng {
  png: Buffer;
  /** Original size when it was not 812x1218 and had to be padded or cropped. */
  resizedFrom: { width: number; height: number } | null;
}

/** Converts a captured page to the same 8-bit grayscale, 203 dpi PNG used for studio prints. */
export function pbmToLabelPng(data: Buffer): CapturedPng {
  const bitmap = parsePbm(data);
  const fitted = fitToLabel(bitmap);
  return {
    png: encodeGrayPng(fitted.width, fitted.height, fitted.gray, LABEL_PIXELS_PER_METER),
    resizedFrom: fitted === bitmap ? null : { width: bitmap.width, height: bitmap.height },
  };
}
