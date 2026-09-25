// Validation and normalisation of label images before they go to the printer.

import { crc32, deflateSync } from 'node:zlib';
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';
import { PNG } from 'pngjs';

/**
 * pHYs density written into every label PNG. 7993 px/m = 203.02 dpi. PAPPL reads it with
 * libpng's png_get_x_pixels_per_inch; 7992 (202.997 dpi) could truncate to 202 dpi and make
 * it scale 812 px up to 816 dots. 7993 yields 203 whether libpng rounds or truncates.
 */
export const LABEL_PIXELS_PER_METER = 7993;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PREFIX = /^data:image\/png;base64,/i;

export class InvalidImageError extends Error {
  override name = 'InvalidImageError';
}

/** Decodes a `data:image/png;base64,...` URL to bytes. */
export function decodePngDataUrl(dataUrl: string): Buffer {
  const match = DATA_URL_PREFIX.exec(dataUrl);
  if (!match) throw new InvalidImageError('Image must be a data:image/png;base64 URL');
  const bytes = Buffer.from(dataUrl.slice(match[0].length), 'base64');
  if (bytes.length === 0) throw new InvalidImageError('Image data is empty');
  return bytes;
}

/** Reads width and height from the IHDR chunk without decoding the image. */
export function readPngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new InvalidImageError('Image is not a PNG file');
  }
  if (png.toString('latin1', 12, 16) !== 'IHDR') throw new InvalidImageError('PNG is missing its IHDR header');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Validates a label PNG and re-encodes it as 8-bit grayscale where every pixel is 0 or 255,
 * with a pHYs chunk declaring 203 dpi so the printer maps it 1:1.
 * Anti-aliased grays are thresholded at 50% luminance; transparency is composited on white.
 */
export function normalizeLabelPng(png: Buffer): Buffer {
  const { width, height } = readPngSize(png);
  if (width !== LABEL_WIDTH_DOTS || height !== LABEL_HEIGHT_DOTS) {
    throw new InvalidImageError(
      `Image is ${width}x${height}; labels must be exactly ${LABEL_WIDTH_DOTS}x${LABEL_HEIGHT_DOTS} (portrait)`,
    );
  }

  let decoded: PNG;
  try {
    decoded = PNG.sync.read(png);
  } catch (err) {
    throw new InvalidImageError(`PNG could not be decoded: ${(err as Error).message}`);
  }

  const rgba = decoded.data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;
    const a = rgba[p + 3]! / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const onWhite = luminance * a + 255 * (1 - a);
    gray[i] = onWhite < 128 ? 0 : 255;
  }
  return encodeGrayPng(width, height, gray, LABEL_PIXELS_PER_METER);
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(header.subarray(4))), 0);
  return Buffer.concat([header, data, crc]);
}

/** Encodes 8-bit grayscale pixels (one byte per pixel, row-major) as a PNG with a pHYs chunk. */
export function encodeGrayPng(width: number, height: number, gray: Uint8Array, pixelsPerMeter: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(0, 9); // color type: grayscale
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // no interlace

  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(pixelsPerMeter, 0);
  phys.writeUInt32BE(pixelsPerMeter, 4);
  phys.writeUInt8(1, 8); // unit: meter

  // Each scanline starts with filter type 0 (None).
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('pHYs', phys),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
