import type { BarcodeElement, Symbology } from '@/doc/types';

type Bwip = typeof import('bwip-js/browser');

let bwipPromise: Promise<Bwip> | null = null;

/** bwip-js is large; load it the first time a barcode is drawn. */
export function loadBwip(): Promise<Bwip> {
  bwipPromise ??= import('bwip-js/browser');
  return bwipPromise;
}

export interface SymbologyInfo {
  id: Symbology;
  name: string;
  /** Matrix codes are drawn cell by cell and have no separate bar height. */
  matrix: boolean;
  hint: string;
  sample: string;
}

export const SYMBOLOGIES: Record<Symbology, SymbologyInfo> = {
  code128: { id: 'code128', name: 'Code 128', matrix: false, hint: 'Any text or numbers.', sample: 'ECO-12345' },
  code39: { id: 'code39', name: 'Code 39', matrix: false, hint: 'Uppercase letters, digits, and - . $ / + % space.', sample: 'ECO-12345' },
  ean13: { id: 'ean13', name: 'EAN-13', matrix: false, hint: '12 digits (the check digit is added) or 13 digits.', sample: '590123412345' },
  upca: { id: 'upca', name: 'UPC-A', matrix: false, hint: '11 digits (the check digit is added) or 12 digits.', sample: '01234567890' },
  qrcode: { id: 'qrcode', name: 'QR code', matrix: true, hint: 'Text, a web address, or any data.', sample: 'https://eco-printer.local' },
  datamatrix: { id: 'datamatrix', name: 'DataMatrix', matrix: true, hint: 'Compact 2D code for small parts.', sample: 'ECO-12345' },
  pdf417: { id: 'pdf417', name: 'PDF417', matrix: true, hint: 'Stacked 2D code, common on IDs and shipping.', sample: 'ECO-12345' },
};

export const SYMBOLOGY_ORDER: Symbology[] = ['code128', 'code39', 'ean13', 'upca', 'qrcode', 'datamatrix', 'pdf417'];

export const isMatrix = (symbology: Symbology): boolean => SYMBOLOGIES[symbology].matrix;

export interface BarcodeBitmap {
  /** Unrotated symbol, exactly sized in dots; null when the data is invalid. */
  canvas: HTMLCanvasElement | null;
  error: string | null;
}

/** bwip-js error messages look like "bwipp.ean13badLength: EAN-13 must be 12 or 13 digits". */
function friendlyError(error: unknown, symbology: Symbology): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^bwip(p|-js)\.[\w]+:\s*/, '').trim();
  return message ? `${SYMBOLOGIES[symbology].name}: ${message}` : `This data cannot be encoded as ${SYMBOLOGIES[symbology].name}.`;
}

/** Points per millimetre in bwip-js (it lays out at 72 dpi). */
const PT_PER_MM = 72 / 25.4;

function drawLinear(bwip: Bwip, el: Pick<BarcodeElement, 'symbology' | 'moduleSize' | 'barHeight' | 'showText'>, data: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const scale = Math.max(1, Math.round(el.moduleSize));
  bwip.toCanvas(canvas, {
    bcid: el.symbology,
    text: data,
    scale,
    // bwip-js takes bar height in mm at 72 dpi, then multiplies by scale.
    height: el.barHeight / scale / PT_PER_MM,
    includetext: el.showText,
    textxalign: 'center',
    textsize: 10,
    backgroundcolor: 'FFFFFF',
  });
  return canvas;
}

function drawMatrix(bwip: Bwip, el: Pick<BarcodeElement, 'symbology' | 'moduleSize'>, data: string): HTMLCanvasElement {
  const [symbol] = bwip.raw(el.symbology, data, '') as unknown as Array<{ pixs: number[]; pixx: number; pixy: number }>;
  if (!symbol) throw new Error('No symbol produced.');
  const module = Math.max(1, Math.round(el.moduleSize));
  const canvas = document.createElement('canvas');
  canvas.width = symbol.pixx * module;
  canvas.height = symbol.pixy * module;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < symbol.pixy; y++) {
    for (let x = 0; x < symbol.pixx; x++) {
      if (symbol.pixs[y * symbol.pixx + x]) ctx.fillRect(x * module, y * module, module, module);
    }
  }
  return canvas;
}

const cache = new Map<string, BarcodeBitmap>();
const CACHE_LIMIT = 300;

/**
 * Render a barcode at whole-dot module sizes. The returned canvas must be drawn
 * at 1:1 on integer coordinates (or rotated by quarter turns) so bars stay crisp.
 */
export async function renderBarcode(
  el: Pick<BarcodeElement, 'symbology' | 'moduleSize' | 'barHeight' | 'showText'>,
  data: string,
): Promise<BarcodeBitmap> {
  const key = JSON.stringify([el.symbology, el.moduleSize, el.barHeight, el.showText, data]);
  const cached = cache.get(key);
  if (cached) return cached;
  const bwip = await loadBwip();
  let result: BarcodeBitmap;
  if (!data.trim()) {
    result = { canvas: null, error: 'Add data to encode.' };
  } else {
    try {
      const canvas = isMatrix(el.symbology) ? drawMatrix(bwip, el, data) : drawLinear(bwip, el, data);
      result = { canvas, error: null };
    } catch (error) {
      result = { canvas: null, error: friendlyError(error, el.symbology) };
    }
  }
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

/**
 * Data used to draw a barcode in the editor when its real data contains
 * variables: substituted sample values, falling back to a valid sample.
 */
export function previewData(symbology: Symbology, substituted: string, hadVariables: boolean): string {
  if (!hadVariables) return substituted;
  const info = SYMBOLOGIES[symbology];
  if (symbology === 'ean13' || symbology === 'upca') return /^\d+$/.test(substituted) ? substituted : info.sample;
  return substituted.trim() ? substituted : info.sample;
}
