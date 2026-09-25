import { PNG } from 'pngjs';
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';

export interface TestPngOptions {
  width?: number;
  height?: number;
  /** Returns [r, g, b, a] for a pixel. Defaults to a black square in the top-left corner on white. */
  pixel?: (x: number, y: number) => [number, number, number, number];
}

/** Encodes an RGBA PNG with pngjs (independent of the encoder under test). */
export function makePng(options: TestPngOptions = {}): Buffer {
  const width = options.width ?? LABEL_WIDTH_DOTS;
  const height = options.height ?? LABEL_HEIGHT_DOTS;
  const pixel = options.pixel ?? ((x, y) => (x < 100 && y < 100 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

export function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function labelDataUrl(options: TestPngOptions = {}): string {
  return toDataUrl(makePng(options));
}

/** Returns the raw chunk list of a PNG file. */
export function pngChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}
