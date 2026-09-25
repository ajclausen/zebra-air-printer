import type { Design, DesignInput, DesignKind } from '@eco/shared';
import {
  barcodeElement,
  defaultFieldValues,
  documentFields,
  elementBounds,
  iconElement,
  imageElement,
  lineElement,
  shapeElement,
  textElement,
} from '@/doc/elements';
import { labelSize } from '@/doc/geometry';
import { migrateDocument } from '@/doc/migrate';
import type { ImageMode, LabelDocument, LabelElement } from '@/doc/types';
import { api } from '@/lib/api/client';
import { renderThumbnail } from '@/render/print';
import type { BuiltInTemplate } from '@/templates';
import { useDialogs } from './dialogs';
import { UNTITLED, useEditor, type DesignMeta } from './store';
import { useViewport } from './viewport';

// ---------------------------------------------------------------------------
// Inserting elements
// ---------------------------------------------------------------------------

/**
 * Center a new element on the label; if something already sits exactly there,
 * cascade down-right so repeated inserts stay visible.
 */
function placeCentered<T extends LabelElement>(el: T, at?: { x: number; y: number }): T {
  const { doc } = useEditor.getState();
  const size = labelSize(doc.orientation);
  let x = Math.round((at?.x ?? size.width / 2) - el.width / 2);
  let y = Math.round((at?.y ?? size.height / 2) - el.height / 2);
  const taken = (px: number, py: number) => doc.elements.some((other) => Math.abs(other.x - px) < 4 && Math.abs(other.y - py) < 4);
  for (let i = 0; i < 12 && taken(x, y); i++) {
    x += 24;
    y += 24;
  }
  x = Math.max(0, Math.min(size.width - el.width, x));
  y = Math.max(0, Math.min(size.height - el.height, y));
  return { ...el, x, y };
}

function insert(el: LabelElement, options: { edit?: boolean; at?: { x: number; y: number } } = {}): void {
  useEditor.getState().add([placeCentered(el, options.at)], { edit: options.edit });
}

export type BasicElementKind = 'text' | 'heading' | 'barcode' | 'qrcode' | 'rect' | 'rounded' | 'ellipse' | 'line';

export function insertBasic(kind: BasicElementKind): void {
  switch (kind) {
    case 'text':
      return insert(textElement({ text: 'Text', width: 480, height: 60, fontSize: 48 }), { edit: true });
    case 'heading':
      return insert(textElement({ text: 'Heading', width: 700, height: 130, fontSize: 112, fontWeight: 800, lineHeight: 1.05 }), { edit: true });
    case 'barcode':
      return insert(barcodeElement({ symbology: 'code128', data: '123456789', moduleSize: 3, barHeight: 150 }));
    case 'qrcode':
      return insert(barcodeElement({ symbology: 'qrcode', data: 'https://eco-printer.local', moduleSize: 8, width: 264, height: 264 }));
    case 'rect':
      return insert(shapeElement({ width: 400, height: 260 }));
    case 'rounded':
      return insert(shapeElement({ width: 400, height: 260, cornerRadius: 36 }));
    case 'ellipse':
      return insert(shapeElement({ shape: 'ellipse', width: 300, height: 300 }));
    case 'line':
      return insert(lineElement({ width: 600, height: 6 }));
  }
}

export function insertText(text: string, props: Partial<Parameters<typeof textElement>[0]> = {}): void {
  insert(textElement({ text, width: 560, height: 60, fontSize: 44, ...props }));
}

/** Insert a text element showing a custom {{field}}, registering its label. */
export function insertField(label: string): void {
  const key = label.trim();
  if (!key) return;
  const state = useEditor.getState();
  if (!state.doc.fields.some((f) => f.key === key)) state.setField({ key, label: key });
  insertText(`{{${key}}}`, { fontSize: 52, fontWeight: 600 });
}

export function insertIcon(icon: string, svg: string): void {
  insert(iconElement({ icon, svg, width: 200, height: 200 }));
}

export interface ImageInsert {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  mode: ImageMode;
  threshold: number;
  invert: boolean;
  at?: { x: number; y: number };
}

/** Default placed size for an image: up to 70% of the label, keeping aspect ratio. */
export function defaultImageSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const size = labelSize(useEditor.getState().doc.orientation);
  const scale = Math.min((size.width * 0.7) / naturalWidth, (size.height * 0.7) / naturalHeight, 1.5);
  return { width: Math.max(8, Math.round(naturalWidth * scale)), height: Math.max(8, Math.round(naturalHeight * scale)) };
}

export function insertImage(image: ImageInsert): void {
  const { width, height } = defaultImageSize(image.naturalWidth, image.naturalHeight);
  insert(imageElement({ src: image.src, mode: image.mode, threshold: image.threshold, invert: image.invert, width, height }), { at: image.at });
}

// ---------------------------------------------------------------------------
// Opening designs
// ---------------------------------------------------------------------------

function freshMeta(name: string): DesignMeta {
  return { designId: null, name, kind: 'design', category: null };
}

/** Opening a template creates a new, unsaved design from a copy of it. */
export function openBuiltInTemplate(template: BuiltInTemplate): void {
  useEditor.getState().load(template.build(), freshMeta(template.name));
  useViewport.getState().reset();
}

export async function openLibraryDesign(id: string): Promise<void> {
  const design = await api.designs.get(id);
  loadDesign(design);
}

/** Library templates open as a new design; library designs open in place. */
export function loadDesign(design: Design): void {
  const doc = migrateDocument(design.document);
  if (design.kind === 'template') {
    useEditor.getState().load(doc, freshMeta(design.name));
  } else {
    useEditor.getState().load(doc, { designId: design.id, name: design.name, kind: 'design', category: design.category }, { saved: true });
  }
  useViewport.getState().reset();
}

export function newBlankLabel(): void {
  useEditor.getState().startBlank();
  useViewport.getState().reset();
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export async function buildDesignInput(doc: LabelDocument, meta: { name: string; kind: DesignKind; category: string | null }): Promise<DesignInput> {
  let thumbnail: string | null = null;
  try {
    thumbnail = await renderThumbnail(doc, { values: defaultFieldValues(doc), counter: '1' });
  } catch (error) {
    console.warn('Thumbnail failed', error);
  }
  return {
    name: meta.name.trim() || UNTITLED,
    kind: meta.kind,
    category: meta.category,
    orientation: doc.orientation,
    thumbnail,
    variables: documentFields(doc),
    document: doc,
  };
}

/** Save the working design. `mode` new = always create a new library entry. */
export async function saveWorkingDesign(options: { mode: 'update' | 'new'; name?: string; kind?: DesignKind; category?: string | null }): Promise<Design> {
  const state = useEditor.getState();
  const kind = options.kind ?? 'design';
  const name = options.name ?? state.meta.name;
  const category = options.category ?? (kind === 'template' ? state.meta.category : null);
  const doc = state.doc;
  const input = await buildDesignInput(doc, { name, kind, category });
  const updating = options.mode === 'update' && state.meta.designId && kind === 'design';
  const design = updating ? await api.designs.update(state.meta.designId!, input) : await api.designs.create(input);
  if (kind === 'design') {
    // Mark exactly the document we saved; edits made during the request stay unsaved.
    useEditor.setState((s) => ({ meta: { designId: design.id, name: design.name, kind: 'design', category: design.category }, savedDoc: doc === s.doc ? s.doc : doc }));
  }
  return design;
}

/** Overall bounds of every element, for "zoom to content" style helpers. */
export function contentBounds(doc: LabelDocument) {
  if (!doc.elements.length) return null;
  const boxes = doc.elements.map(elementBounds);
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** Open the system file picker for an image, then the insert dialog. */
export function pickImageFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) useDialogs.getState().open('image', { file });
  };
  input.click();
}
