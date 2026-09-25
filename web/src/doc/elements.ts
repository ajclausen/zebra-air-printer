import type { DesignVariable, Orientation } from '@eco/shared';
import { labelSize } from './geometry';
import {
  DOCUMENT_FORMAT_VERSION,
  type BarcodeElement,
  type IconElement,
  type ImageElement,
  type LabelDocument,
  type LabelElement,
  type LineElement,
  type ShapeElement,
  type TextElement,
} from './types';
import { extractFieldKeys, usesCounter } from './variables';

let idCounter = 0;

/** Short unique id for elements and groups. */
export function newId(prefix = 'el'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function emptyDocument(orientation: Orientation = 'portrait'): LabelDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, orientation, elements: [], fields: [] };
}

type Geometry = Partial<Pick<LabelElement, 'x' | 'y' | 'width' | 'height' | 'angle'>>;

export function textElement(props: Partial<Omit<TextElement, 'type'>> = {}): TextElement {
  return {
    id: newId(),
    type: 'text',
    x: 60,
    y: 60,
    width: 500,
    height: 60,
    angle: 0,
    text: 'Text',
    font: 'sans',
    fontSize: 48,
    fontWeight: 400,
    italic: false,
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.15,
    letterSpacing: 0,
    uppercase: false,
    invert: false,
    autoFit: false,
    ...props,
  };
}

export function barcodeElement(props: Partial<Omit<BarcodeElement, 'type'>> = {}): BarcodeElement {
  return {
    id: newId(),
    type: 'barcode',
    x: 60,
    y: 60,
    width: 300,
    height: 120,
    angle: 0,
    symbology: 'code128',
    data: '123456789',
    showText: true,
    moduleSize: 3,
    barHeight: 120,
    ...props,
  };
}

export function imageElement(props: Pick<ImageElement, 'src'> & Partial<Omit<ImageElement, 'type' | 'src'>>): ImageElement {
  return {
    id: newId(),
    type: 'image',
    x: 60,
    y: 60,
    width: 300,
    height: 300,
    angle: 0,
    mode: 'dither',
    threshold: 128,
    invert: false,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    ...props,
  };
}

export function iconElement(props: Pick<IconElement, 'icon' | 'svg'> & Partial<Omit<IconElement, 'type' | 'icon' | 'svg'>>): IconElement {
  return { id: newId(), type: 'icon', x: 60, y: 60, width: 160, height: 160, angle: 0, strokeWidth: 2, ...props };
}

export function shapeElement(props: Partial<Omit<ShapeElement, 'type'>> = {}): ShapeElement {
  return {
    id: newId(),
    type: 'shape',
    x: 60,
    y: 60,
    width: 300,
    height: 200,
    angle: 0,
    shape: 'rect',
    fill: 'none',
    stroke: 'black',
    strokeWidth: 6,
    cornerRadius: 0,
    ...props,
  };
}

export function lineElement(props: Partial<Omit<LineElement, 'type'>> = {}): LineElement {
  return { id: newId(), type: 'line', x: 60, y: 60, width: 400, height: 6, angle: 0, dashed: false, ink: 'black', ...props };
}

/** Center an element on the label, optionally overriding geometry. */
export function centered<T extends LabelElement>(element: T, orientation: Orientation, geometry: Geometry = {}): T {
  const size = labelSize(orientation);
  const width = geometry.width ?? element.width;
  const height = geometry.height ?? element.height;
  return {
    ...element,
    ...geometry,
    width,
    height,
    x: Math.round((size.width - width) / 2),
    y: Math.round((size.height - height) / 2),
  };
}

/** Every string in the document that may contain {{variables}}. */
export function documentTexts(doc: LabelDocument): string[] {
  const texts: string[] = [];
  for (const el of doc.elements) {
    if (el.type === 'text') texts.push(el.text);
    else if (el.type === 'barcode') texts.push(el.data);
  }
  return texts;
}

/** Custom fields used by the document, with stored labels and defaults merged in. */
export function documentFields(doc: LabelDocument): DesignVariable[] {
  const stored = new Map(doc.fields.map((f) => [f.key, f]));
  return extractFieldKeys(documentTexts(doc)).map((key) => stored.get(key) ?? { key, label: key });
}

export function documentUsesCounter(doc: LabelDocument): boolean {
  return usesCounter(documentTexts(doc));
}

/** Default field values for a print, from stored defaults. */
export function defaultFieldValues(doc: LabelDocument): Record<string, string> {
  return Object.fromEntries(documentFields(doc).map((f) => [f.key, f.defaultValue ?? '']));
}

/** Deep copy with fresh element ids (and consistent fresh group ids). */
export function cloneWithNewIds(elements: LabelElement[]): LabelElement[] {
  const groupMap = new Map<string, string>();
  return elements.map((el) => {
    const groupId = el.groupId ? (groupMap.get(el.groupId) ?? groupMap.set(el.groupId, newId('grp')).get(el.groupId)!) : el.groupId;
    return { ...structuredClone(el), id: newId(), groupId };
  });
}

/** Axis-aligned bounds of an element after rotation. */
export function elementBounds(el: LabelElement): { left: number; top: number; right: number; bottom: number } {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rad = (el.angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (el.width * cos + el.height * sin) / 2;
  const halfH = (el.width * sin + el.height * cos) / 2;
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
}

export const ELEMENT_TYPE_NAMES: Record<LabelElement['type'], string> = {
  text: 'Text',
  barcode: 'Barcode',
  image: 'Image',
  icon: 'Icon',
  shape: 'Shape',
  line: 'Line',
};

/** A short human name for layer lists and toasts. */
export function describeElement(el: LabelElement): string {
  if (el.name) return el.name;
  switch (el.type) {
    case 'text':
      return el.text.split('\n')[0]!.slice(0, 32) || 'Text';
    case 'barcode':
      return el.symbology === 'qrcode' ? 'QR code' : el.symbology === 'datamatrix' ? 'DataMatrix' : el.symbology === 'pdf417' ? 'PDF417' : 'Barcode';
    case 'icon':
      return el.icon.replace(/-/g, ' ');
    case 'shape':
      return el.shape === 'ellipse' ? 'Ellipse' : el.cornerRadius > 0 ? 'Rounded rectangle' : 'Rectangle';
    default:
      return ELEMENT_TYPE_NAMES[el.type];
  }
}
