import { Ellipse, FabricImage, Pattern, Rect, util, type FabricObject } from 'fabric';
import { canItalic, LABEL_FONTS, nearestWeight } from '@/doc/fonts';
import type {
  BarcodeElement,
  ElementType,
  IconElement,
  ImageElement,
  LabelElement,
  LineElement,
  ShapeElement,
  TextElement,
} from '@/doc/types';
import { createCanvas, context2d, renderIcon, renderImage } from './assets';
import { renderBarcode } from './barcode';
import { LabelTextbox } from './LabelTextbox';

/**
 * How elements resolve their content. The editor shows raw {{variables}};
 * the print renderer substitutes real values.
 */
export interface ContentResolver {
  mode: 'editor' | 'print';
  text(el: TextElement): string;
  barcodeData(el: BarcodeElement): string;
}

/** A Fabric object that renders one document element. */
export type LabelObject = FabricObject & {
  elementId: string;
  elementType: ElementType;
  /** Set on barcodes whose data cannot be encoded. */
  contentError?: string | null;
};

const INK = { black: '#000000', white: '#ffffff' } as const;

export function isLabelObject(obj: FabricObject | undefined | null): obj is LabelObject {
  return Boolean(obj && typeof (obj as unknown as Partial<LabelObject>).elementId === "string");
}

function tag<T extends FabricObject>(obj: T, el: LabelElement): T & LabelObject {
  return Object.assign(obj, { elementId: el.id, elementType: el.type });
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Position an object whose rendered size may differ from the element box (text
 * grows, barcodes are sized by their data). The element's top-left stays put.
 */
function place(obj: FabricObject, el: LabelElement, renderedWidth: number, renderedHeight: number): void {
  obj.set({
    originX: 'center',
    originY: 'center',
    left: el.x + renderedWidth / 2,
    top: el.y + renderedHeight / 2,
    angle: el.angle,
    scaleX: 1,
    scaleY: 1,
    flipX: false,
    flipY: false,
    skewX: 0,
    skewY: 0,
  });
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Side padding for white-on-black text, proportional to the type size. */
function invertInset(el: TextElement): number {
  const reference = el.autoFit ? el.height * 0.45 : el.fontSize;
  return Math.round(Math.min(48, Math.max(8, reference * 0.32)));
}

function applyText(obj: LabelTextbox, el: TextElement, resolver: ContentResolver): void {
  const font = LABEL_FONTS[el.font];
  const weight = nearestWeight(el.font, el.fontWeight);
  obj.set({
    text: resolver.text(el),
    fontFamily: font.family,
    fontWeight: weight,
    fontStyle: el.italic && canItalic(el.font, weight) ? 'italic' : 'normal',
    textAlign: el.align,
    lineHeight: el.lineHeight,
    charSpacing: el.letterSpacing,
    fill: el.invert ? INK.white : INK.black,
    backgroundColor: el.invert ? INK.black : '',
    width: el.width,
    boxHeight: el.height,
    verticalAlign: el.verticalAlign,
    inset: el.invert ? invertInset(el) : 0,
    fontSize: el.fontSize,
    splitByGrapheme: false,
    objectCaching: resolver.mode === 'editor',
  });
  if (el.autoFit) obj.fitToBox(el.width, el.height);
  else obj.initDimensions();
  place(obj, el, obj.width, obj.height);
}

function createText(el: TextElement, resolver: ContentResolver): LabelTextbox {
  const obj = new LabelTextbox('', { boxHeight: el.height, verticalAlign: el.verticalAlign });
  applyText(obj, el, resolver);
  return obj;
}

// ---------------------------------------------------------------------------
// Shapes and lines
// ---------------------------------------------------------------------------

function shapePaint(el: ShapeElement) {
  const stroke = el.strokeWidth > 0 ? INK[el.stroke] : null;
  const sw = el.strokeWidth > 0 ? el.strokeWidth : 0;
  return { fill: el.fill === 'none' ? '' : INK[el.fill], stroke, strokeWidth: sw, strokeUniform: true };
}

function applyShape(obj: Rect | Ellipse, el: ShapeElement): void {
  const paint = shapePaint(el);
  const sw = paint.strokeWidth;
  const innerW = Math.max(1, el.width - sw);
  const innerH = Math.max(1, el.height - sw);
  if (obj instanceof Rect) {
    const radius = Math.max(0, Math.min(el.cornerRadius - sw / 2, innerW / 2, innerH / 2));
    obj.set({ ...paint, width: innerW, height: innerH, rx: radius, ry: radius });
  } else {
    obj.set({ ...paint, rx: innerW / 2, ry: innerH / 2 });
  }
  place(obj, el, el.width, el.height);
}

function createShape(el: ShapeElement): Rect | Ellipse {
  const obj = el.shape === 'ellipse' ? new Ellipse() : new Rect();
  applyShape(obj, el);
  return obj;
}

function dashPattern(el: LineElement): Pattern {
  const thickness = Math.max(1, Math.round(el.height));
  const dash = Math.max(12, thickness * 3);
  const gap = Math.max(8, thickness * 2);
  const tile = createCanvas(dash + gap, thickness);
  const ctx = context2d(tile);
  ctx.fillStyle = INK[el.ink];
  ctx.fillRect(0, 0, dash, thickness);
  return new Pattern({ source: tile, repeat: 'repeat-x' });
}

function applyLine(obj: Rect, el: LineElement): void {
  obj.set({
    width: el.width,
    height: el.height,
    fill: el.dashed ? dashPattern(el) : INK[el.ink],
    stroke: null,
    strokeWidth: 0,
  });
  place(obj, el, el.width, el.height);
}

function createLine(el: LineElement): Rect {
  const obj = new Rect();
  applyLine(obj, el);
  return obj;
}

// ---------------------------------------------------------------------------
// Bitmap-backed elements: barcodes, icons, images
// ---------------------------------------------------------------------------

/** Rotate a canvas by quarter turns without resampling. */
function quarterTurn(source: HTMLCanvasElement, angle: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (angle === 0) return source;
  const swap = angle === 90 || angle === 270;
  const out = createCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const ctx = context2d(out);
  ctx.imageSmoothingEnabled = false;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

function invalidBarcodePlaceholder(width: number, height: number, message: string): HTMLCanvasElement {
  const canvas = createCanvas(Math.max(width, 160), Math.max(height, 80));
  const ctx = context2d(canvas);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  for (let x = -canvas.height; x < canvas.width; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, canvas.height);
    ctx.lineTo(x + canvas.height, 0);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  const pad = 10;
  ctx.font = '600 22px Inter, sans-serif';
  const label = message.length > 48 ? `${message.slice(0, 46)}…` : message;
  const textWidth = Math.min(canvas.width - 2 * pad, ctx.measureText(label).width + 24);
  ctx.fillRect((canvas.width - textWidth) / 2, canvas.height / 2 - 20, textWidth, 40);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 2 * pad);
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  return canvas;
}

interface BitmapResult {
  canvas: HTMLCanvasElement;
  /** Size of the unrotated content in dots, written back to the element. */
  width: number;
  height: number;
  error: string | null;
}

async function barcodeBitmap(el: BarcodeElement, resolver: ContentResolver): Promise<BitmapResult> {
  const result = await renderBarcode(el, resolver.barcodeData(el));
  if (!result.canvas) {
    const placeholder = invalidBarcodePlaceholder(el.width, el.height, result.error ?? 'Invalid data');
    return { canvas: quarterTurn(placeholder, el.angle), width: placeholder.width, height: placeholder.height, error: result.error };
  }
  return { canvas: quarterTurn(result.canvas, el.angle), width: result.canvas.width, height: result.canvas.height, error: null };
}

async function iconBitmap(el: IconElement): Promise<BitmapResult> {
  const canvas = await renderIcon(el, el.width, el.height);
  return { canvas, width: el.width, height: el.height, error: null };
}

async function imageBitmap(el: ImageElement): Promise<BitmapResult> {
  const canvas = await renderImage(el, el.width, el.height);
  return { canvas, width: el.width, height: el.height, error: null };
}

type BitmapElement = BarcodeElement | IconElement | ImageElement;

function bitmapFor(el: BitmapElement, resolver: ContentResolver): Promise<BitmapResult> {
  switch (el.type) {
    case 'barcode':
      return barcodeBitmap(el, resolver);
    case 'icon':
      return iconBitmap(el);
    case 'image':
      return imageBitmap(el);
  }
}

/**
 * Place a bitmap so its top-left pixel lands on a whole dot. Barcodes carry
 * their rotation in the bitmap itself (quarter turns), so the object is never
 * rotated and bars are never resampled.
 */
function applyBitmap(obj: FabricImage, el: BitmapElement, bitmap: BitmapResult, resolver: ContentResolver): void {
  obj.setElement(bitmap.canvas);
  const w = bitmap.canvas.width;
  const h = bitmap.canvas.height;
  if (el.type === 'barcode') {
    const cx = el.x + bitmap.width / 2;
    const cy = el.y + bitmap.height / 2;
    const left = Math.round(cx - w / 2);
    const top = Math.round(cy - h / 2);
    obj.set({ originX: 'center', originY: 'center', left: left + w / 2, top: top + h / 2, angle: 0, scaleX: 1, scaleY: 1 });
  } else {
    place(obj, el, w, h);
  }
  obj.set({ imageSmoothing: resolver.mode === 'editor' && el.type !== 'barcode', width: w, height: h });
  (obj as unknown as LabelObject).contentError = bitmap.error;
}

async function createBitmapObject(el: BitmapElement, resolver: ContentResolver): Promise<FabricImage> {
  const bitmap = await bitmapFor(el, resolver);
  const obj = new FabricImage(bitmap.canvas);
  applyBitmap(obj, el, bitmap, resolver);
  return obj;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build the Fabric object for an element. */
export async function createObject(el: LabelElement, resolver: ContentResolver): Promise<LabelObject> {
  switch (el.type) {
    case 'text':
      return tag(createText(el, resolver), el);
    case 'shape':
      return tag(createShape(el), el);
    case 'line':
      return tag(createLine(el), el);
    default:
      return tag(await createBitmapObject(el, resolver), el);
  }
}

/** True when an existing object can be updated in place (otherwise rebuild). */
export function canUpdateInPlace(obj: LabelObject, el: LabelElement): boolean {
  if (obj.elementType !== el.type) return false;
  if (el.type === 'shape') return el.shape === 'ellipse' ? obj instanceof Ellipse : obj instanceof Rect;
  return true;
}

/**
 * Update an object in place to match its element. Returns the bitmap's natural
 * size for bitmap-backed elements so callers can sync derived dimensions.
 */
export async function updateObject(obj: LabelObject, el: LabelElement, resolver: ContentResolver): Promise<void> {
  switch (el.type) {
    case 'text':
      applyText(obj as unknown as LabelTextbox, el, resolver);
      break;
    case 'shape':
      applyShape(obj as unknown as Rect | Ellipse, el);
      break;
    case 'line':
      applyLine(obj as unknown as Rect, el);
      break;
    default: {
      const bitmap = await bitmapFor(el, resolver);
      applyBitmap(obj as unknown as FabricImage, el, bitmap, resolver);
    }
  }
  obj.setCoords();
}

/**
 * The unrotated content size of a barcode as rendered (width/height fields are
 * derived from the data and module size).
 */
export function barcodeNaturalSize(obj: LabelObject, el: BarcodeElement): { width: number; height: number } {
  const swap = el.angle === 90 || el.angle === 270;
  return swap ? { width: obj.height, height: obj.width } : { width: obj.width, height: obj.height };
}

export interface AbsoluteTransform {
  centerX: number;
  centerY: number;
  angle: number;
  scaleX: number;
  scaleY: number;
}

/** Absolute transform of an object, including any active-selection parent. */
export function absoluteTransform(obj: FabricObject): AbsoluteTransform {
  const d = util.qrDecompose(obj.calcTransformMatrix());
  return { centerX: d.translateX, centerY: d.translateY, angle: d.angle, scaleX: d.scaleX, scaleY: d.scaleY };
}
