import { cache, StaticCanvas } from 'fabric';
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';
import { describeElement } from '@/doc/elements';
import { ensureDocumentFonts } from '@/doc/fonts';
import { labelSize } from '@/doc/geometry';
import type { LabelDocument, LabelInstance } from '@/doc/types';
import { hasVariables, substitute, uppercaseOutsideVariables } from '@/doc/variables';
import { createCanvas, context2d } from './assets';
import { previewData as barcodePreviewData } from './barcode';
import { finalizeLabelBitmap, type Bitmap } from './bitmap';
import { createObject, type ContentResolver } from './objects';

/** Raised when a label cannot be rendered for printing (e.g. invalid barcode data). */
export class PrintRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrintRenderError';
  }
}

/** Resolver that substitutes real values for one printed label. */
export function printResolver(instance: LabelInstance, now: Date): ContentResolver {
  const ctx = { values: instance.values, counter: instance.counter, now };
  return {
    mode: 'print',
    text: (el) => {
      const value = substitute(el.text, ctx);
      return el.uppercase ? value.toUpperCase() : value;
    },
    barcodeData: (el) => substitute(el.data, ctx),
  };
}

/**
 * Resolver for the editor: text shows raw {{variables}}; barcodes encode
 * sample values so they still draw while their data is a template.
 */
export function editorResolver(defaults: Record<string, string>, now = new Date()): ContentResolver {
  const ctx = { values: defaults, counter: '1', now };
  return {
    mode: 'editor',
    text: (el) => (el.uppercase ? uppercaseOutsideVariables(el.text) : el.text),
    barcodeData: (el) => barcodePreviewData(el.symbology, substitute(el.data, ctx), hasVariables(el.data)),
  };
}

/**
 * Draw the document at 1:1 (one canvas pixel per printer dot) with values
 * substituted. Returns the unthresholded render in the design's orientation.
 */
export async function renderDocument(doc: LabelDocument, resolver: ContentResolver): Promise<HTMLCanvasElement> {
  // Glyph widths measured before a face loaded are cached by Fabric; drop them.
  if (await ensureDocumentFonts(doc)) cache.clearFontCache();
  const size = labelSize(doc.orientation);
  const element = createCanvas(size.width, size.height);
  const canvas = new StaticCanvas(element, {
    width: size.width,
    height: size.height,
    enableRetinaScaling: false,
    renderOnAddRemove: false,
    backgroundColor: '#ffffff',
    imageSmoothingEnabled: false,
  });
  try {
    for (const el of doc.elements) {
      const obj = await createObject(el, resolver);
      if (resolver.mode === 'print' && obj.contentError) {
        throw new PrintRenderError(`${describeElement(el)}: ${obj.contentError}`);
      }
      canvas.add(obj);
    }
    canvas.renderAll();
    // Copy out before dispose() releases the Fabric canvas.
    const out = createCanvas(size.width, size.height);
    context2d(out).drawImage(element, 0, 0);
    return out;
  } finally {
    await canvas.dispose();
  }
}

function canvasBitmap(canvas: HTMLCanvasElement): Bitmap {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function bitmapToCanvas(bitmap: Bitmap): HTMLCanvasElement {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  context2d(canvas).putImageData(new ImageData(bitmap.data as Uint8ClampedArray<ArrayBuffer>, bitmap.width, bitmap.height), 0, 0);
  return canvas;
}

/** The exact 812 x 1218 pure black/white bitmap the printer receives for one label. */
export async function renderPrintBitmap(doc: LabelDocument, instance: LabelInstance, now = new Date()): Promise<Bitmap> {
  const rendered = await renderDocument(doc, printResolver(instance, now));
  return finalizeLabelBitmap(canvasBitmap(rendered), doc.orientation, LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS);
}

export interface RenderedLabel {
  /** PNG data URL, 812 x 1218, portrait, pure black/white. */
  dataUrl: string;
  instance: LabelInstance;
}

/**
 * Render every label in a print job. Yields to the browser between labels so
 * progress can paint; `onProgress` receives the count done so far.
 */
export async function renderPrintJob(
  doc: LabelDocument,
  instances: LabelInstance[],
  onProgress?: (done: number, total: number) => void,
  now = new Date(),
): Promise<RenderedLabel[]> {
  const labels: RenderedLabel[] = [];
  for (const instance of instances) {
    const bitmap = await renderPrintBitmap(doc, instance, now);
    labels.push({ dataUrl: bitmapToCanvas(bitmap).toDataURL('image/png'), instance });
    onProgress?.(labels.length, instances.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return labels;
}

/**
 * A small PNG preview for library cards: the thresholded label in its own
 * orientation, about `longSide` pixels on the long side.
 */
export async function renderThumbnail(doc: LabelDocument, instance: LabelInstance, longSide = 240): Promise<string> {
  const rendered = await renderDocument(doc, { ...printResolver(instance, new Date()), mode: 'print' }).catch(() =>
    renderDocument(doc, editorResolver(instance.values)),
  );
  const mono = bitmapToCanvas(finalizeLabelBitmap(canvasBitmap(rendered), 'portrait', rendered.width, rendered.height));
  const scale = longSide / Math.max(mono.width, mono.height);
  const thumb = createCanvas(mono.width * scale, mono.height * scale);
  const ctx = context2d(thumb);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mono, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/png');
}
