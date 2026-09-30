/**
 * Turn a carrier's label file (PDF, PNG, or JPEG) into print-ready 4x6 labels:
 * find the label on each page, crop it, turn it upright, and render it 1:1
 * where it fits.
 */
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS, PRINTER_DPI } from '@eco/shared';
import { MAX_LABELS_PER_JOB } from '@/doc/batch';
import { context2d, createCanvas, loadImage } from '@/render/assets';
import type { Bitmap } from '@/render/bitmap';
import { composeLabel, findLabel, fitScale, inkMask, rotateQuarterTurns, uprightTurns, type Rect } from './detect';
import { loadPdf, pageSize, pdfErrorMessage, renderPdfPage } from './pdf';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const IMPORT_ACCEPT = 'application/pdf,image/png,image/jpeg';

/** Resolution used to find the label; the label itself renders at printer resolution. */
const DETECT_DPI = 100;
const THUMB_LONG_SIDE = 240;

export interface PreparedLabel {
  /** PNG data URL, 812 x 1218, pure black/white, as it will print. */
  upright: string;
  /** The same label turned 180 degrees. */
  flipped: string;
  /** Small picture of the whole source page. */
  pageThumb: string;
  pageAspect: number;
  /** The crop on the source page, as fractions (0-1) of its width and height. */
  cropBox: Rect;
  /** No 4x6 label was found; the whole page's content is scaled to fit. */
  fallback: boolean;
}

export interface PreparedFile {
  /** File name without its extension, used as the print job name. */
  name: string;
  labels: PreparedLabel[];
}

/** A problem with the file itself, with a message meant for the person importing it. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImportable(file: File): boolean {
  return isPdf(file) || file.type === 'image/png' || file.type === 'image/jpeg';
}

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').trim() || 'Shipping label';
}

function canvasBitmap(canvas: HTMLCanvasElement): Bitmap {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

function bitmapDataUrl(bitmap: Bitmap): string {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  context2d(canvas).putImageData(new ImageData(bitmap.data as Uint8ClampedArray<ArrayBuffer>, bitmap.width, bitmap.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function thumbnail(source: HTMLCanvasElement | HTMLImageElement, width: number, height: number): string {
  const scale = THUMB_LONG_SIDE / Math.max(width, height);
  const thumb = createCanvas(width * scale, height * scale);
  const ctx = context2d(thumb);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/png');
}

/** Scale a rect and round it outward, keeping it inside `limit`. */
function scaleRect(rect: Rect, factor: number, limit: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.floor(rect.x * factor));
  const y = Math.max(0, Math.floor(rect.y * factor));
  return {
    x,
    y,
    width: Math.min(limit.width, Math.ceil((rect.x + rect.width) * factor)) - x,
    height: Math.min(limit.height, Math.ceil((rect.y + rect.height) * factor)) - y,
  };
}

/** Largest size a crop may have before rotation, so rounding never pushes it past the label. */
function clampToLabel(rect: Rect, turns: number): Rect {
  const sideways = turns % 2 === 1;
  return {
    ...rect,
    width: Math.min(rect.width, sideways ? LABEL_HEIGHT_DOTS : LABEL_WIDTH_DOTS),
    height: Math.min(rect.height, sideways ? LABEL_WIDTH_DOTS : LABEL_HEIGHT_DOTS),
  };
}

function finishLabel(crop: Bitmap, turns: number, page: { thumb: string; width: number; height: number }, detected: Rect, fallback: boolean): PreparedLabel {
  const label = composeLabel(crop, turns);
  return {
    upright: bitmapDataUrl(label),
    flipped: bitmapDataUrl(rotateQuarterTurns(label, 2)),
    pageThumb: page.thumb,
    pageAspect: page.width / page.height,
    cropBox: { x: detected.x / page.width, y: detected.y / page.height, width: detected.width / page.width, height: detected.height / page.height },
    fallback,
  };
}

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

async function preparePdf(file: File, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<PreparedLabel[]> {
  const data = await file.arrayBuffer();
  signal?.throwIfAborted();
  const task = await loadPdf(data);
  // Destroying the task stops loading and any page render in progress.
  const stop = () => void task.destroy();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      signal?.throwIfAborted();
      throw new ImportError(pdfErrorMessage(error));
    }
    if (doc.numPages > MAX_LABELS_PER_JOB) throw new ImportError(`This PDF has ${doc.numPages} pages. One print job can hold up to ${MAX_LABELS_PER_JOB} labels.`);
    const labels: PreparedLabel[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(n);
      const size = pageSize(page, DETECT_DPI);
      // Keep the detection render modest even for oversized pages.
      const detectDpi = Math.min(DETECT_DPI, DETECT_DPI * Math.sqrt(8_000_000 / (size.width * size.height)));
      const canvas = await renderPdfPage(page, detectDpi);
      const mask = inkMask(canvasBitmap(canvas));
      const { crop, fallback } = findLabel(mask, detectDpi);
      const turns = uprightTurns(mask, crop);
      // Re-render just the crop from the PDF at printer resolution (or smaller, to fit).
      const toPrinter = PRINTER_DPI / detectDpi;
      const scale = fitScale({ width: crop.width * toPrinter, height: crop.height * toPrinter }, turns);
      const dpi = PRINTER_DPI * scale;
      const region = clampToLabel(scaleRect(crop, dpi / detectDpi, pageSize(page, dpi)), turns);
      const cropped = await renderPdfPage(page, dpi, region);
      labels.push(finishLabel(canvasBitmap(cropped), turns, { thumb: thumbnail(canvas, canvas.width, canvas.height), width: canvas.width, height: canvas.height }, crop, fallback));
      page.cleanup();
      onProgress?.(n, doc.numPages);
      await nextFrame();
    }
    signal?.throwIfAborted();
    return labels;
  } finally {
    signal?.removeEventListener('abort', stop);
    void task.destroy();
  }
}

/** Resolution of an image, guessed from its shape: a Letter or A4 page scan/screenshot. */
function guessImageDpi(width: number, height: number): number | null {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const ratio = short / long;
  if (Math.abs(ratio - 8.5 / 11) < 0.02) return long / 11;
  if (Math.abs(ratio - 210 / 297) < 0.02) return long / (297 / 25.4);
  return null;
}

async function prepareImage(file: File, signal?: AbortSignal): Promise<PreparedLabel[]> {
  const url = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      throw new ImportError('This image could not be read.');
    }
    signal?.throwIfAborted();
    const { naturalWidth: width, naturalHeight: height } = img;
    const dpi = guessImageDpi(width, height);
    // Find the label on a smaller copy.
    const detectScale = Math.min(1, (dpi ? DETECT_DPI / dpi : 1100 / Math.max(width, height)));
    const small = createCanvas(width * detectScale, height * detectScale);
    const smallCtx = context2d(small);
    smallCtx.fillStyle = '#fff';
    smallCtx.fillRect(0, 0, small.width, small.height);
    smallCtx.drawImage(img, 0, 0, small.width, small.height);
    const mask = inkMask(canvasBitmap(small));
    const { crop, fallback } = findLabel(mask, dpi ? dpi * (small.width / width) : null);
    const turns = uprightTurns(mask, crop);
    const source = scaleRect(crop, width / small.width, { width, height });
    // 1:1 at printer resolution when the image's resolution is known; otherwise fill the label.
    const scale = fitScale(source, turns, dpi ? PRINTER_DPI / dpi : Number.POSITIVE_INFINITY);
    const out = clampToLabel({ x: 0, y: 0, width: Math.round(source.width * scale), height: Math.round(source.height * scale) }, turns);
    const canvas = createCanvas(out.width, out.height);
    const ctx = context2d(canvas);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    return [finishLabel(canvasBitmap(canvas), turns, { thumb: thumbnail(small, small.width, small.height), width: small.width, height: small.height }, crop, fallback)];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Read a carrier label file and prepare one print-ready label per page.
 * Aborting `signal` stops the work and rejects with the abort reason.
 */
export async function prepareShippingFile(file: File, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<PreparedFile> {
  if (!isImportable(file)) throw new ImportError('Choose a PDF, PNG, or JPEG.');
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('This file is over 20 MB. Shipping label files are usually much smaller.');
  const labels = isPdf(file) ? await preparePdf(file, options.signal, options.onProgress) : await prepareImage(file, options.signal);
  if (!labels.length) throw new ImportError('This file has no pages.');
  return { name: baseName(file), labels };
}
