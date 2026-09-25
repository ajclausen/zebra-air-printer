import type { FontId, LabelDocument } from './types';

export interface LabelFont {
  id: FontId;
  /** CSS font-family name registered by the bundled @fontsource CSS. */
  family: string;
  /** Short description shown in the font picker. */
  role: string;
  weights: readonly number[];
  italicWeights: readonly number[];
}

/** The bundled label fonts. Keep in sync with src/styles/fonts.css. */
export const LABEL_FONTS: Record<FontId, LabelFont> = {
  sans: { id: 'sans', family: 'Inter', role: 'Sans', weights: [400, 500, 600, 700, 800, 900], italicWeights: [400, 700] },
  condensed: {
    id: 'condensed',
    family: 'Barlow Condensed',
    role: 'Condensed',
    weights: [400, 500, 600, 700, 800],
    italicWeights: [400, 700],
  },
  serif: { id: 'serif', family: 'Source Serif 4', role: 'Serif', weights: [400, 600, 700], italicWeights: [400, 700] },
  mono: { id: 'mono', family: 'JetBrains Mono', role: 'Mono', weights: [400, 700], italicWeights: [] },
  display: { id: 'display', family: 'Archivo Black', role: 'Display', weights: [400], italicWeights: [] },
  hand: { id: 'hand', family: 'Caveat', role: 'Handwriting', weights: [400, 700], italicWeights: [] },
};

export const FONT_IDS = Object.keys(LABEL_FONTS) as FontId[];

export const WEIGHT_NAMES: Record<number, string> = {
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

/** The closest weight the font actually ships, so the canvas never synthesizes bold. */
export function nearestWeight(font: FontId, weight: number): number {
  const weights = LABEL_FONTS[font].weights;
  let best = weights[0] ?? 400;
  for (const w of weights) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  return best;
}

export function canItalic(font: FontId, weight: number): boolean {
  return LABEL_FONTS[font].italicWeights.includes(nearestWeight(font, weight));
}

export function cssFontFamily(font: FontId): string {
  return `"${LABEL_FONTS[font].family}"`;
}

function fontDescriptor(font: FontId, weight: number, italic: boolean): string {
  const style = italic && canItalic(font, weight) ? 'italic ' : '';
  return `${style}${nearestWeight(font, weight)} 48px ${cssFontFamily(font)}`;
}

/**
 * Load every face the document uses before it is drawn to a canvas. Canvas text
 * silently falls back to a system font if the face has not loaded yet.
 */
export async function ensureDocumentFonts(doc: LabelDocument): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const descriptors = new Set<string>();
  for (const el of doc.elements) {
    if (el.type === 'text') descriptors.add(fontDescriptor(el.font, el.fontWeight, el.italic));
  }
  return ensureFaces([...descriptors]);
}

/** True once the face is loaded, so text measurements are trustworthy. */
export function isFontReady(font: FontId, weight: number, italic: boolean): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  return loaded.has(fontDescriptor(font, weight, italic));
}

export async function ensureFont(font: FontId, weight: number, italic: boolean): Promise<boolean> {
  return ensureFaces([fontDescriptor(font, weight, italic)]);
}

const loaded = new Set<string>();

/** Load faces; resolves true when at least one face was newly loaded (text needs re-measuring). */
async function ensureFaces(descriptors: string[]): Promise<boolean> {
  const pending = descriptors.filter((d) => !loaded.has(d));
  if (pending.length === 0) return false;
  await Promise.all(
    pending.map(async (d) => {
      try {
        await document.fonts.load(d);
        loaded.add(d);
      } catch (error) {
        console.warn(`Could not load font ${d}`, error);
      }
    }),
  );
  return true;
}
