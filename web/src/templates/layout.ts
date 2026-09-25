import type { DesignVariable, Orientation } from '@eco/shared';
import { barcodeElement, emptyDocument, iconElement, lineElement, shapeElement, textElement } from '@/doc/elements';
import type { BarcodeElement, IconElement, LabelDocument, LabelElement, LineElement, ShapeElement, TextElement } from '@/doc/types';
import { labelSymbol } from './symbols';

/**
 * Shared grid and type styles for the built-in templates, so every starter
 * reads as one family.
 *
 * Grid: a 48-dot (about 1/4 in) outer margin on every side. Die-cut labels have
 * rounded corners and drift a few dots, so nothing prints closer to the edge.
 * Portrait is 812 x 1218 dots, landscape 1218 x 812.
 *
 * Type: Inter for reading text, Barlow Condensed for large numbers and codes,
 * Archivo Black for sign words, small tracked capitals (`eyebrow`) to name values.
 */
export const MARGIN = 48;
export const PORTRAIT = { width: 812, height: 1218 } as const;
export const LANDSCAPE = { width: 1218, height: 812 } as const;

/** Width inside the margins: 716 in portrait, 1122 in landscape. */
export const PORTRAIT_INNER = PORTRAIT.width - 2 * MARGIN;
export const LANDSCAPE_INNER = LANDSCAPE.width - 2 * MARGIN;

/** Heavy rule between major sections and a light rule between rows. */
export const RULE_HEAVY = 8;
export const RULE_LIGHT = 3;

/** Outline of framed signs: stroke width and corner radius. */
export const FRAME_STROKE = 12;
export const FRAME_RADIUS = 32;

/** Minimum quiet zones in modules: 10 either side of 1D codes, 4 around QR codes. */
export const QUIET_1D = 10;
export const QUIET_QR = 4;

/** Left x that centers a box of `width` inside [left, left + span). */
export function centerIn(width: number, left: number, span: number): number {
  return Math.round(left + (span - width) / 2);
}

// ---------------------------------------------------------------------------
// Documents and fields
// ---------------------------------------------------------------------------

export function field(key: string, label: string, defaultValue: string): DesignVariable {
  return { key, label, defaultValue };
}

export function makeDocument(orientation: Orientation, elements: LabelElement[], fields: DesignVariable[] = []): LabelDocument {
  return { ...emptyDocument(orientation), elements, fields };
}

// ---------------------------------------------------------------------------
// Type styles
// ---------------------------------------------------------------------------

type TextProps = Partial<Omit<TextElement, 'type'>>;

/** Small tracked capitals that name the value below them ("SHIP TO", "EXPIRES"). */
export function eyebrow(props: TextProps): TextElement {
  return textElement({
    width: 320,
    height: 30,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 140,
    uppercase: true,
    lineHeight: 1,
    ...props,
  });
}

/** Reading text in Inter. */
export function body(props: TextProps): TextElement {
  return textElement({ fontSize: 34, fontWeight: 500, lineHeight: 1.25, ...props });
}

/**
 * Large condensed figures (bin numbers, permit numbers, box numbers) that fill
 * their box, so a value of any length stays inside it.
 */
export function bigFigure(props: TextProps): TextElement {
  return textElement({
    font: 'condensed',
    fontSize: 400,
    fontWeight: 800,
    lineHeight: 1,
    align: 'center',
    verticalAlign: 'middle',
    autoFit: true,
    ...props,
  });
}

/** Sign words in Archivo Black, fitted to their box. */
export function signWord(props: TextProps): TextElement {
  return textElement({
    font: 'display',
    fontSize: 300,
    fontWeight: 400,
    lineHeight: 1,
    align: 'center',
    verticalAlign: 'middle',
    uppercase: true,
    autoFit: true,
    ...props,
  });
}

// ---------------------------------------------------------------------------
// Rules, frames, blocks
// ---------------------------------------------------------------------------

/** Horizontal rule. */
export function hRule(x: number, y: number, width: number, thickness: number = RULE_LIGHT, dashed = false): LineElement {
  return lineElement({ x, y, width, height: thickness, dashed });
}

/**
 * Vertical rule covering [x, x + thickness) x [y, y + length). Lines are
 * stored horizontal and rotated about their center, so the unrotated box is
 * offset; even lengths and thicknesses keep it on whole dots.
 */
export function vRule(x: number, y: number, length: number, thickness: number = RULE_LIGHT, dashed = false): LineElement {
  return lineElement({
    x: Math.round(x + thickness / 2 - length / 2),
    y: Math.round(y + length / 2 - thickness / 2),
    width: length,
    height: thickness,
    angle: 90,
    dashed,
  });
}

/** Rounded outline inset by the margin, for signs. */
export function frame(orientation: Orientation, props: Partial<Omit<ShapeElement, 'type'>> = {}): ShapeElement {
  const size = orientation === 'portrait' ? PORTRAIT : LANDSCAPE;
  return shapeElement({
    name: 'Frame',
    x: MARGIN,
    y: MARGIN,
    width: size.width - 2 * MARGIN,
    height: size.height - 2 * MARGIN,
    strokeWidth: FRAME_STROKE,
    cornerRadius: FRAME_RADIUS,
    ...props,
  });
}

/** Solid black rectangle; white text sits on it with `invert: true`. */
export function blackBox(x: number, y: number, width: number, height: number, cornerRadius = 0): ShapeElement {
  return shapeElement({ x, y, width, height, fill: 'black', stroke: 'black', strokeWidth: 0, cornerRadius });
}

/** Empty tick box for handwritten checkmarks. */
export function checkBox(x: number, y: number, size = 44): ShapeElement {
  return shapeElement({ name: 'Check box', x, y, width: size, height: size, strokeWidth: 5, cornerRadius: 6 });
}

/** A built-in label symbol (see symbols.ts) as an icon element. */
export function symbol(id: string, props: Partial<Omit<IconElement, 'type' | 'icon' | 'svg'>>): IconElement {
  const s = labelSymbol(id);
  return iconElement({ icon: s.id, svg: s.svg, name: s.name, ...props });
}

// ---------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------

/**
 * Width in modules of a Code 128 symbol, assuming the encoder switches between
 * code sets B and C optimally (bwip-js does). Includes start, check, and stop
 * characters but not the quiet zones. Used to center barcodes on their default data.
 */
export function code128Modules(data: string): number {
  const isDigit = (i: number) => i < data.length && data[i]! >= '0' && data[i]! <= '9';
  // best[i][set]: fewest symbols to encode data[i..] when currently in `set` (0 = B, 1 = C).
  const best: Array<[number, number]> = Array.from({ length: data.length + 1 }, () => [0, 0]);
  for (let i = data.length - 1; i >= 0; i--) {
    const pair = isDigit(i) && isDigit(i + 1);
    const inB = 1 + best[i + 1]![0];
    const inC = pair ? 1 + best[i + 2]![1] : Infinity;
    best[i] = [Math.min(inB, 1 + inC), Math.min(inC, 1 + inB)];
  }
  const pairAtStart = isDigit(0) && isDigit(1);
  const symbols = Math.min(best[0]![0], pairAtStart ? best[0]![1] : Infinity);
  // start + data + check = 11 modules each; stop = 13.
  return 11 * (symbols + 2) + 13;
}

/** Width in dots of a Code 128 symbol at a module size. */
export function code128Width(data: string, moduleSize: number): number {
  return code128Modules(data) * moduleSize;
}

/** Side of a QR symbol in modules (error correction M, the bwip-js default). */
export function qrModules(data: string): number {
  const numeric = /^\d*$/.test(data);
  const alphanumeric = /^[0-9A-Z $%*+\-./:]*$/.test(data);
  // Capacity at level M for versions 1..10.
  const capacity = numeric
    ? [34, 63, 101, 149, 202, 255, 293, 365, 432, 513]
    : alphanumeric
      ? [20, 38, 61, 90, 122, 154, 178, 221, 262, 311]
      : [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const index = capacity.findIndex((max) => data.length <= max);
  const version = index === -1 ? capacity.length : index + 1;
  return 17 + 4 * version;
}

interface Code128Placement {
  /** Encoded data, may contain {{variables}}. */
  data: string;
  /** The data with default values filled in, used to measure the symbol. */
  sample: string;
  moduleSize: number;
  barHeight: number;
  y: number;
  /** Left edge. Omit to center the symbol in [left, left + span). */
  x?: number;
  left?: number;
  span?: number;
  name?: string;
}

/**
 * Code 128 without printed text. Templates set their own human-readable line
 * so its type matches the label. Centered on the default data unless `x` is given.
 */
export function code128(p: Code128Placement): BarcodeElement {
  const width = code128Width(p.sample, p.moduleSize);
  return barcodeElement({
    name: p.name ?? 'Barcode',
    symbology: 'code128',
    data: p.data,
    showText: false,
    moduleSize: p.moduleSize,
    barHeight: p.barHeight,
    x: p.x ?? centerIn(width, p.left ?? 0, p.span ?? 0),
    y: p.y,
    width,
    height: p.barHeight,
  });
}

interface QrPlacement {
  data: string;
  /** The data with default values filled in, used to size the symbol. */
  sample: string;
  moduleSize: number;
  x: number;
  y: number;
  name?: string;
}

export function qrCode(p: QrPlacement): BarcodeElement {
  const side = qrModules(p.sample) * p.moduleSize;
  return barcodeElement({
    name: p.name ?? 'QR code',
    symbology: 'qrcode',
    data: p.data,
    showText: false,
    moduleSize: p.moduleSize,
    barHeight: side,
    x: p.x,
    y: p.y,
    width: side,
    height: side,
  });
}
