import type { IconElement, ImageElement } from '@/doc/types';
import { floydSteinberg, threshold, type Bitmap } from './bitmap';

/** Load an image URL (data URLs included) into a decoded HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be read.'));
    img.src = src;
  });
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function cachedImage(src: string): Promise<HTMLImageElement> {
  let promise = imageCache.get(src);
  if (!promise) {
    promise = loadImage(src);
    imageCache.set(src, promise);
    promise.catch(() => imageCache.delete(src));
  }
  return promise;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  return ctx;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** Full SVG document for an icon at a pixel size. */
export function iconSvgDocument(el: Pick<IconElement, 'svg' | 'strokeWidth'>, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="#000" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${el.svg}</svg>`
  );
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterize an icon at exactly width x height dots. */
export async function renderIcon(el: Pick<IconElement, 'svg' | 'strokeWidth'>, width: number, height: number): Promise<HTMLCanvasElement> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const img = await cachedImage(svgDataUrl(iconSvgDocument(el, w, h)));
  const canvas = createCanvas(w, h);
  context2d(canvas).drawImage(img, 0, 0, w, h);
  return canvas;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Longest side kept when an image is inserted; the label itself is 1218 dots long. */
const MAX_SOURCE_SIDE = 1218;

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

/**
 * Downscale an uploaded image and flatten it to grayscale so documents stay
 * small. Transparent images stay PNG; opaque photos become JPEG.
 */
export async function prepareImageSource(file: Blob): Promise<PreparedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = createCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
    const ctx = context2d(canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = false;
    for (let p = 0; p < data.data.length; p += 4) {
      const lum = Math.round(0.299 * data.data[p]! + 0.587 * data.data[p + 1]! + 0.114 * data.data[p + 2]!);
      data.data[p] = data.data[p + 1] = data.data[p + 2] = lum;
      if (data.data[p + 3]! < 250) transparent = true;
    }
    ctx.putImageData(data, 0, 0);
    const src = transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
    return { src, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ImageProcessing = Pick<ImageElement, 'src' | 'mode' | 'threshold' | 'invert' | 'crop'>;

/** Natural size of an image source. */
export async function imageSize(src: string): Promise<{ width: number; height: number }> {
  const img = await cachedImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Convert an image to 1-bit at exactly width x height dots. Dithering happens
 * at the final print resolution so the pattern lands on whole dots. White
 * becomes transparent so logos can sit over other elements.
 */
export async function renderImage(el: ImageProcessing, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await cachedImage(el.src);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = createCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  const sx = el.crop.x * img.naturalWidth;
  const sy = el.crop.y * img.naturalHeight;
  const sw = Math.max(1, el.crop.width * img.naturalWidth);
  const sh = Math.max(1, el.crop.height * img.naturalHeight);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const source: Bitmap = ctx.getImageData(0, 0, w, h);
  const options = { threshold: el.threshold, invert: el.invert, transparentWhite: true };
  const mono = el.mode === 'dither' ? floydSteinberg(source, options) : threshold(source, options);
  ctx.putImageData(new ImageData(mono.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return canvas;
}
