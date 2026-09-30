/**
 * The only place that touches pdf.js. It is loaded on first use so the
 * designer's bundle doesn't carry it.
 */
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';
import { createCanvas } from '@/render/assets';
import type { Rect } from './detect';

/** Where the build serves pdf.js's standard fonts and wasm decoders (see vite.config.ts). */
export const PDFJS_ASSETS = '/pdfjs/';

let pdfjs: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  pdfjs.catch(() => (pdfjs = null));
  return pdfjs;
}

/**
 * Start loading a PDF. The caller owns the task and must `destroy()` it on
 * every path (success, failure, or cancel) so its worker is released.
 */
export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentLoadingTask> {
  const lib = await loadPdfjs();
  return lib.getDocument({
    data,
    // Carrier PDFs often use the non-embedded standard 14 fonts (Helvetica, Courier...).
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSETS}wasm/`,
  });
}

/** Page size in dots at `dpi`, with the page's own rotation applied. */
export function pageSize(page: PDFPageProxy, dpi: number): { width: number; height: number } {
  const viewport = page.getViewport({ scale: dpi / 72 });
  return { width: Math.round(viewport.width), height: Math.round(viewport.height) };
}

/**
 * Render a page (or just `region` of it, in dots at `dpi`) onto a white canvas,
 * with the page's own rotation applied.
 */
export async function renderPdfPage(page: PDFPageProxy, dpi: number, region?: Rect): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const area = region ?? { x: 0, y: 0, width: Math.round(viewport.width), height: Math.round(viewport.height) };
  const canvas = createCanvas(area.width, area.height);
  await page.render({
    canvas,
    viewport,
    transform: region ? [1, 0, 0, 1, -region.x, -region.y] : undefined,
    background: '#ffffff',
    intent: 'print',
  }).promise;
  return canvas;
}

/** A friendly message for pdf.js load errors. */
export function pdfErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return 'This PDF is password protected. Download the label again without a password.';
  return "This PDF can't be opened. It may be damaged or not a PDF.";
}
