import type { DesignVariable, Orientation } from '@eco/shared';

/**
 * The editor document. This is the web app's own format, stored opaquely by the
 * server in `Design.document`. Bump DOCUMENT_FORMAT_VERSION and add a step to
 * `migrate.ts` whenever the shape changes incompatibly.
 *
 * Units: 1 unit = 1 printer dot (203 dpi). The label is 812 x 1218 in portrait
 * and 1218 x 812 in landscape.
 */
export const DOCUMENT_FORMAT_VERSION = 1;

export interface LabelDocument {
  formatVersion: typeof DOCUMENT_FORMAT_VERSION;
  orientation: Orientation;
  /** Bottom to top (paint order). */
  elements: LabelElement[];
  /** Labels and default values for custom {{fields}}. Keys not used by any element are ignored. */
  fields: DesignVariable[];
}

export type FontId = 'sans' | 'condensed' | 'serif' | 'mono' | 'display' | 'hand';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type Ink = 'black' | 'white';

interface ElementBase {
  id: string;
  /** Optional display name shown in the layers list. */
  name?: string;
  /** Top-left corner of the unrotated box, in dots. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise about the box center. */
  angle: number;
  locked?: boolean;
  /** Elements sharing a groupId select and move together. */
  groupId?: string | null;
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  font: FontId;
  /** Font size in dots. When autoFit is on this is the largest size allowed. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: TextAlign;
  /** Vertical placement inside the box (matters when the box is taller than the text). */
  verticalAlign: VerticalAlign;
  lineHeight: number;
  /** Letter spacing in thousandths of an em. */
  letterSpacing: number;
  uppercase: boolean;
  /** White text on a black box. */
  invert: boolean;
  /**
   * Fit the text to the box: the font shrinks or grows so the text fills the
   * width x height box. Without autoFit, height is a minimum and grows with the text.
   */
  autoFit: boolean;
}

export type Symbology = 'code128' | 'code39' | 'ean13' | 'upca' | 'qrcode' | 'datamatrix' | 'pdf417';

export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  symbology: Symbology;
  /** Encoded data; may contain {{variables}}. */
  data: string;
  /** Print human-readable text under 1D barcodes. */
  showText: boolean;
  /** Width of one module (narrowest bar or one QR cell) in whole dots. */
  moduleSize: number;
  /** Height of the bars for 1D symbologies, in dots. Ignored for 2D codes. */
  barHeight: number;
  /**
   * Barcodes only rotate in quarter turns so bars stay on whole dots. The
   * width/height fields always describe the unrotated symbol and are derived
   * from the rendered bitmap.
   */
  angle: 0 | 90 | 180 | 270;
}

export type ImageMode = 'threshold' | 'dither';

export interface ImageCrop {
  /** Normalized 0..1 fractions of the source image. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  /** Source image as a data URL (grayscale PNG, downscaled at insert time). */
  src: string;
  mode: ImageMode;
  /** 0-255 luminance cut-off. */
  threshold: number;
  invert: boolean;
  crop: ImageCrop;
}

export interface IconElement extends ElementBase {
  type: 'icon';
  /** Lucide icon name (kebab-case) or a built-in symbol id. For display only. */
  icon: string;
  /** Inner SVG markup on a 24 x 24 grid. Stored so documents render without the icon set. */
  svg: string;
  /** Stroke width on the 24-unit icon grid (Lucide default is 2). */
  strokeWidth: number;
}

export type ShapeKind = 'rect' | 'ellipse';

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  fill: Ink | 'none';
  stroke: Ink;
  /** Outline width in dots; 0 for no outline. The outline sits inside the box. */
  strokeWidth: number;
  /** Rectangle corner radius in dots. */
  cornerRadius: number;
}

export interface LineElement extends ElementBase {
  type: 'line';
  /** Thickness is `height`; length is `width`. */
  dashed: boolean;
  ink: Ink;
}

export type LabelElement = TextElement | BarcodeElement | ImageElement | IconElement | ShapeElement | LineElement;
export type ElementType = LabelElement['type'];

/** Values used to produce one printed label. */
export interface LabelInstance {
  /** Custom field values by key. */
  values: Record<string, string>;
  /** Value substituted for {{counter}}. */
  counter: string;
}
