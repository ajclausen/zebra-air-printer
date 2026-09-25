/**
 * Development-only hooks on window.__eco for Playwright scripts (print sample
 * generation, smoke checks). Never loaded in production builds.
 */
import { migrateDocument } from '@/doc/migrate';
import type { LabelDocument, LabelInstance } from '@/doc/types';
import { blackRatio, isPureMonochrome } from '@/render/bitmap';
import { bitmapToCanvas, renderPrintBitmap, renderThumbnail } from '@/render/print';
import { useEditor } from '@/designer/store';

async function renderSample(doc: unknown, instance: LabelInstance) {
  const document = migrateDocument(doc);
  const bitmap = await renderPrintBitmap(document, instance);
  return {
    width: bitmap.width,
    height: bitmap.height,
    pureMonochrome: isPureMonochrome(bitmap),
    blackRatio: blackRatio(bitmap),
    dataUrl: bitmapToCanvas(bitmap).toDataURL('image/png'),
  };
}

async function templates() {
  const { BUILT_IN_TEMPLATES } = await import('@/templates');
  return BUILT_IN_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, doc: t.build() }));
}

declare global {
  interface Window {
    __eco?: Record<string, unknown>;
  }
}

window.__eco = {
  renderSample,
  templates,
  renderThumbnail: (doc: LabelDocument, instance: LabelInstance) => renderThumbnail(migrateDocument(doc), instance),
  editor: useEditor,
};
