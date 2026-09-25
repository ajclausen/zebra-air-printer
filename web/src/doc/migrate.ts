import type { DesignVariable, Orientation } from '@eco/shared';
import { barcodeElement, iconElement, imageElement, lineElement, shapeElement, textElement } from './elements';
import { FONT_IDS } from './fonts';
import { DOCUMENT_FORMAT_VERSION, type LabelDocument, type LabelElement, type Symbology } from './types';

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentFormatError';
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Upgrade steps, keyed by the version they upgrade FROM. Each step returns a
 * document one version newer. Version 0 is any pre-release document saved
 * without a formatVersion; its shape matches version 1.
 */
const MIGRATIONS: Record<number, (doc: Json) => Json> = {
  0: (doc) => ({ ...doc, formatVersion: 1 }),
};

/**
 * Turn any stored document (from the server, localStorage, or a template) into
 * a valid current-version LabelDocument. Missing properties get defaults,
 * invalid values are clamped, and unknown element types are dropped.
 */
export function migrateDocument(raw: unknown): LabelDocument {
  if (!isObject(raw)) throw new DocumentFormatError('This design is not a Label Studio document.');
  let doc: Json = raw;
  let version = typeof doc.formatVersion === 'number' ? doc.formatVersion : 0;
  if (version > DOCUMENT_FORMAT_VERSION) {
    throw new DocumentFormatError('This design was saved by a newer version of Label Studio. Reload the page to update.');
  }
  while (version < DOCUMENT_FORMAT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new DocumentFormatError(`No upgrade path from document version ${version}.`);
    doc = step(doc);
    version += 1;
  }
  return normalizeV1(doc);
}

function normalizeV1(doc: Json): LabelDocument {
  const orientation: Orientation = doc.orientation === 'landscape' ? 'landscape' : 'portrait';
  const elements = Array.isArray(doc.elements) ? doc.elements.flatMap((e) => normalizeElement(e) ?? []) : [];
  const fields = Array.isArray(doc.fields) ? doc.fields.flatMap((f) => normalizeField(f) ?? []) : [];
  return { formatVersion: DOCUMENT_FORMAT_VERSION, orientation, elements, fields };
}

function normalizeField(raw: unknown): DesignVariable | null {
  if (!isObject(raw) || typeof raw.key !== 'string' || !raw.key.trim()) return null;
  const field: DesignVariable = { key: raw.key.trim(), label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : raw.key.trim() };
  if (typeof raw.defaultValue === 'string') field.defaultValue = raw.defaultValue;
  return field;
}

const num = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const SYMBOLOGIES: readonly Symbology[] = ['code128', 'code39', 'ean13', 'upca', 'qrcode', 'datamatrix', 'pdf417'];

/** Common geometry, validated against the defaults of the element's factory. */
function base<T extends LabelElement>(raw: Json, defaults: T): T {
  const el = { ...defaults };
  if (typeof raw.id === 'string' && raw.id) el.id = raw.id;
  if (typeof raw.name === 'string') el.name = raw.name;
  el.x = num(raw.x, defaults.x);
  el.y = num(raw.y, defaults.y);
  el.width = num(raw.width, defaults.width, 1);
  el.height = num(raw.height, defaults.height, 1);
  el.angle = num(raw.angle, 0) % 360;
  if (raw.locked === true) el.locked = true;
  if (typeof raw.groupId === 'string' && raw.groupId) el.groupId = raw.groupId;
  return el;
}

function normalizeElement(raw: unknown): LabelElement | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'text': {
      const d = textElement();
      const el = base(raw, d);
      return {
        ...el,
        text: str(raw.text, d.text),
        font: oneOf(raw.font, FONT_IDS, d.font),
        fontSize: num(raw.fontSize, d.fontSize, 4, 2000),
        fontWeight: num(raw.fontWeight, d.fontWeight, 100, 900),
        italic: bool(raw.italic, d.italic),
        align: oneOf(raw.align, ['left', 'center', 'right'] as const, d.align),
        verticalAlign: oneOf(raw.verticalAlign, ['top', 'middle', 'bottom'] as const, d.verticalAlign),
        lineHeight: num(raw.lineHeight, d.lineHeight, 0.5, 4),
        letterSpacing: num(raw.letterSpacing, d.letterSpacing, -200, 2000),
        uppercase: bool(raw.uppercase, d.uppercase),
        invert: bool(raw.invert, d.invert),
        autoFit: bool(raw.autoFit, d.autoFit),
      };
    }
    case 'barcode': {
      const d = barcodeElement();
      const el = base(raw, d);
      return {
        ...el,
        angle: oneOf(Math.round(num(raw.angle, 0) / 90) * 90 % 360, [0, 90, 180, 270] as const, 0),
        symbology: oneOf(raw.symbology, SYMBOLOGIES, d.symbology),
        data: str(raw.data, d.data),
        showText: bool(raw.showText, d.showText),
        moduleSize: Math.round(num(raw.moduleSize, d.moduleSize, 1, 40)),
        barHeight: Math.round(num(raw.barHeight, d.barHeight, 10, 1218)),
      };
    }
    case 'image': {
      if (typeof raw.src !== 'string' || !raw.src.startsWith('data:image/')) return null;
      const d = imageElement({ src: raw.src });
      const el = base(raw, d);
      const crop = isObject(raw.crop) ? raw.crop : {};
      const cx = num(crop.x, 0, 0, 1);
      const cy = num(crop.y, 0, 0, 1);
      return {
        ...el,
        mode: oneOf(raw.mode, ['threshold', 'dither'] as const, d.mode),
        threshold: num(raw.threshold, d.threshold, 0, 255),
        invert: bool(raw.invert, d.invert),
        crop: { x: cx, y: cy, width: num(crop.width, 1 - cx, 0.01, 1 - cx), height: num(crop.height, 1 - cy, 0.01, 1 - cy) },
      };
    }
    case 'icon': {
      if (typeof raw.svg !== 'string') return null;
      const d = iconElement({ icon: str(raw.icon, 'icon'), svg: raw.svg });
      return { ...base(raw, d), strokeWidth: num(raw.strokeWidth, d.strokeWidth, 0.25, 6) };
    }
    case 'shape': {
      const d = shapeElement();
      const el = base(raw, d);
      return {
        ...el,
        shape: oneOf(raw.shape, ['rect', 'ellipse'] as const, d.shape),
        fill: oneOf(raw.fill, ['none', 'black', 'white'] as const, d.fill),
        stroke: oneOf(raw.stroke, ['black', 'white'] as const, d.stroke),
        strokeWidth: num(raw.strokeWidth, d.strokeWidth, 0, 400),
        cornerRadius: num(raw.cornerRadius, d.cornerRadius, 0, 1000),
      };
    }
    case 'line': {
      const d = lineElement();
      const el = base(raw, d);
      return { ...el, dashed: bool(raw.dashed, d.dashed), ink: oneOf(raw.ink, ['black', 'white'] as const, d.ink) };
    }
    default:
      return null;
  }
}
