/**
 * Pure pixel operations for 1-bit thermal output. Everything works on RGBA
 * buffers shaped like ImageData so it runs in tests without a DOM.
 */

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

export function createBitmap(width: number, height: number, fill = 255): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4).fill(fill);
  return { width, height, data };
}

/** The 50% cut-off used for the final label threshold. */
export const DEFAULT_THRESHOLD = 128;

/**
 * Perceived luminance (Rec. 601) of an RGBA pixel composited over white paper,
 * so transparent areas read as white.
 */
export function paperLuminance(r: number, g: number, b: number, a: number): number {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return 255 - ((255 - lum) * a) / 255;
}

/** Grayscale (0 = black, 255 = white) values composited over white. */
export function toGrayscale(bitmap: Bitmap): Float32Array {
  const { data } = bitmap;
  const gray = new Float32Array(bitmap.width * bitmap.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = paperLuminance(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!);
  }
  return gray;
}

function writeMono(target: Uint8ClampedArray, pixel: number, black: boolean, transparentWhite: boolean): void {
  const p = pixel * 4;
  const v = black ? 0 : 255;
  target[p] = v;
  target[p + 1] = v;
  target[p + 2] = v;
  target[p + 3] = black || !transparentWhite ? 255 : 0;
}

export interface MonoOptions {
  /** Luminance below this becomes black. */
  threshold?: number;
  /** Swap black and white after conversion. */
  invert?: boolean;
  /** Emit transparent pixels instead of opaque white (for images layered over other elements). */
  transparentWhite?: boolean;
}

/** Hard threshold to pure black and white. Returns a new bitmap. */
export function threshold(bitmap: Bitmap, options: MonoOptions = {}): Bitmap {
  const level = options.threshold ?? DEFAULT_THRESHOLD;
  const gray = toGrayscale(bitmap);
  const out = createBitmap(bitmap.width, bitmap.height);
  for (let i = 0; i < gray.length; i++) {
    const black = gray[i]! < level;
    writeMono(out.data, i, black !== Boolean(options.invert), Boolean(options.transparentWhite));
  }
  return out;
}

/**
 * Floyd-Steinberg error diffusion to pure black and white. `threshold` shifts
 * the midpoint, which acts as a brightness control. Returns a new bitmap.
 */
export function floydSteinberg(bitmap: Bitmap, options: MonoOptions = {}): Bitmap {
  const level = options.threshold ?? DEFAULT_THRESHOLD;
  const { width, height } = bitmap;
  const gray = toGrayscale(bitmap);
  // Pixels that are fully transparent stay white and do not take part in diffusion.
  const transparent = new Uint8Array(width * height);
  for (let i = 0; i < transparent.length; i++) transparent[i] = bitmap.data[i * 4 + 3] === 0 ? 1 : 0;

  const out = createBitmap(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (transparent[i]) {
        writeMono(out.data, i, Boolean(options.invert), Boolean(options.transparentWhite));
        continue;
      }
      const old = gray[i]!;
      const black = old < level;
      const error = old - (black ? 0 : 255);
      writeMono(out.data, i, black !== Boolean(options.invert), Boolean(options.transparentWhite));
      if (x + 1 < width) gray[i + 1]! += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1]! += (error * 3) / 16;
        gray[i + width]! += (error * 5) / 16;
        if (x + 1 < width) gray[i + width + 1]! += error / 16;
      }
    }
  }
  return out;
}

/** Final label conversion: every pixel becomes opaque #000000 or #FFFFFF at 50% luminance. */
export function toPrintBitmap(bitmap: Bitmap): Bitmap {
  return threshold(bitmap, { threshold: DEFAULT_THRESHOLD });
}

/** Rotate 90 degrees clockwise. The result is height x width. */
export function rotateClockwise(bitmap: Bitmap): Bitmap {
  const { width: w, height: h, data } = bitmap;
  const out = createBitmap(h, w);
  const src = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const dst = new Uint32Array(out.data.buffer, out.data.byteOffset, w * h);
  // Source (x, y) lands at (h - 1 - y, x) in the rotated image, whose width is h.
  for (let y = 0; y < h; y++) {
    const destX = h - 1 - y;
    const row = y * w;
    for (let x = 0; x < w; x++) dst[x * h + destX] = src[row + x]!;
  }
  return out;
}

/** True when every pixel is opaque pure black or pure white. */
export function isPureMonochrome(bitmap: Bitmap): boolean {
  const { data } = bitmap;
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p]!;
    if (data[p + 3] !== 255 || (r !== 0 && r !== 255) || data[p + 1] !== r || data[p + 2] !== r) return false;
  }
  return true;
}

export class LabelSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelSizeError';
  }
}

/**
 * Turn a 1:1 render of the label into the exact bitmap the printer receives:
 * threshold to pure black/white, rotate landscape labels 90 degrees clockwise,
 * and verify the result is portrait `printWidth` x `printHeight`.
 */
export function finalizeLabelBitmap(
  rendered: Bitmap,
  orientation: 'portrait' | 'landscape',
  printWidth: number,
  printHeight: number,
): Bitmap {
  const expectedWidth = orientation === 'portrait' ? printWidth : printHeight;
  const expectedHeight = orientation === 'portrait' ? printHeight : printWidth;
  if (rendered.width !== expectedWidth || rendered.height !== expectedHeight) {
    throw new LabelSizeError(
      `Rendered label is ${rendered.width}x${rendered.height}; expected ${expectedWidth}x${expectedHeight} for ${orientation}.`,
    );
  }
  const mono = toPrintBitmap(rendered);
  const upright = orientation === 'landscape' ? rotateClockwise(mono) : mono;
  if (upright.width !== printWidth || upright.height !== printHeight) {
    throw new LabelSizeError(`Print bitmap is ${upright.width}x${upright.height}; expected ${printWidth}x${printHeight}.`);
  }
  return upright;
}

/** Fraction of pixels that are black (useful for sanity checks). */
export function blackRatio(bitmap: Bitmap): number {
  let black = 0;
  for (let p = 0; p < bitmap.data.length; p += 4) if (bitmap.data[p] === 0) black++;
  return black / (bitmap.width * bitmap.height);
}
