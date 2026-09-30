/**
 * Find the 4x6 shipping label on a carrier's page (e.g. FedEx's Letter page
 * with the label in one half and instructions in the other) and turn it into
 * the exact portrait 812 x 1218 bitmap the printer receives.
 *
 * Everything here is pure and works on plain arrays so it runs in tests.
 */
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';
import { createBitmap, DEFAULT_THRESHOLD, rotateClockwise, threshold, type Bitmap } from '@/render/bitmap';

/** One byte per pixel: 1 = ink, 0 = paper. */
export interface InkMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  /** Area to print, in mask pixels. */
  crop: Rect;
  /** True when no 4x6 label was found and the crop is just all the ink on the page. */
  fallback: boolean;
}

const LABEL_SHORT_IN = 4;
const LABEL_LONG_IN = 6;
/** A page this close to 4x6 is already a label and is used whole. */
const WHOLE_PAGE_TOLERANCE = 0.03;
/** Slack when checking whether a block fits on the label. */
const FIT_TOLERANCE = 0.02;
/**
 * A line of ink covering this share of the page is a rule (e.g. the fold line),
 * not content. Above 6/8.5 so a 6" border on a Letter page is still content.
 */
const RULE_COVERAGE = 0.75;
/** Rules are thin lines; anything thicker is content. */
const MAX_RULE_IN = 0.1;
/** Blank bands narrower than this don't split blocks. */
const MIN_GAP_IN = 0.1;
/** Share of each short end compared when choosing which way to rotate a landscape label. */
const END_SHARE = 0.25;

export function inkMask(bitmap: Bitmap, level = DEFAULT_THRESHOLD): InkMask {
  const { width, height, data } = bitmap;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const a = data[p + 3]!;
    const lum = 255 - ((255 - (0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!)) * a) / 255;
    mask[i] = lum < level ? 1 : 0;
  }
  return { width, height, data: mask };
}

/** True when a width x height area has the proportions of a 4x6 label (either orientation). */
export function isLabelShaped(width: number, height: number, tolerance = WHOLE_PAGE_TOLERANCE): boolean {
  const ratio = Math.min(width, height) / Math.max(width, height);
  return Math.abs(ratio - LABEL_SHORT_IN / LABEL_LONG_IN) <= (LABEL_SHORT_IN / LABEL_LONG_IN) * tolerance;
}

/** True when a page is 4x6 (either orientation) within a few percent. */
function isPhysicalLabel(width: number, height: number, dpi: number): boolean {
  const short = Math.min(width, height) / dpi;
  const long = Math.max(width, height) / dpi;
  return Math.abs(short - LABEL_SHORT_IN) <= LABEL_SHORT_IN * WHOLE_PAGE_TOLERANCE && Math.abs(long - LABEL_LONG_IN) <= LABEL_LONG_IN * WHOLE_PAGE_TOLERANCE;
}

function fitsOnLabel(width: number, height: number, dpi: number): boolean {
  const short = LABEL_SHORT_IN * dpi * (1 + FIT_TOLERANCE);
  const long = LABEL_LONG_IN * dpi * (1 + FIT_TOLERANCE);
  return (width <= short && height <= long) || (width <= long && height <= short);
}

interface Block extends Rect {
  ink: number;
}

interface Band {
  start: number;
  end: number;
  rule: boolean;
}

function union(a: Block, b: Block): Block {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    ink: a.ink + b.ink,
  };
}

/**
 * Find candidate label blocks. A region is cut at every blank band along one
 * axis (the one with a rule, else the one with the widest band), and every run
 * of neighboring pieces becomes a candidate, so a label whose own inner gap is
 * wider than the gap to nearby text is still a candidate as a whole. Runs never
 * cross a rule, and a region with a rule inside is never a candidate itself.
 * Returns the candidates and the bounds of all ink (rules excluded).
 */
function collectBlocks(mask: InkMask, ruleRows: Uint8Array, ruleCols: Uint8Array, minGap: number): { candidates: Block[]; all: Block | null } {
  const { width, data } = mask;
  const candidates: Block[] = [];

  const visit = (x0: number, y0: number, x1: number, y1: number, depth: number): Block | null => {
    // Profiles of ink per row and column, ignoring rules.
    const rows = new Uint32Array(y1 - y0);
    const cols = new Uint32Array(x1 - x0);
    let ink = 0;
    for (let y = y0; y < y1; y++) {
      if (ruleRows[y]) continue;
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        if (data[row + x] && !ruleCols[x]) {
          rows[y - y0]!++;
          cols[x - x0]!++;
          ink++;
        }
      }
    }
    if (ink === 0) return null;
    // Trim to the ink.
    let top = 0;
    while (!rows[top]) top++;
    let bottom = rows.length - 1;
    while (!rows[bottom]) bottom--;
    let left = 0;
    while (!cols[left]) left++;
    let right = cols.length - 1;
    while (!cols[right]) right--;
    const self: Block = { x: x0 + left, y: y0 + top, width: right - left + 1, height: bottom - top + 1, ink };

    // Interior blank bands along each axis.
    const bandsOf = (profile: Uint32Array, from: number, to: number, offset: number, rules: Uint8Array): Band[] => {
      const bands: Band[] = [];
      for (let i = from; i <= to; i++) {
        if (profile[i] !== 0) continue;
        const start = i;
        let rule = false;
        for (; profile[i] === 0; i++) if (rules[offset + i]) rule = true;
        if (rule || i - start >= minGap) bands.push({ start: offset + start, end: offset + i, rule });
      }
      return bands;
    };
    const rowBands = bandsOf(rows, top, bottom, y0, ruleRows);
    const colBands = bandsOf(cols, left, right, x0, ruleCols);
    const widest = (bands: Band[]) => Math.max(0, ...bands.map((b) => b.end - b.start));
    const alongY = rowBands.some((b) => b.rule) || (!colBands.some((b) => b.rule) && widest(rowBands) >= widest(colBands));
    const bands = alongY ? rowBands : colBands;
    if (!bands.some((b) => b.rule)) candidates.push(self);
    if (!bands.length || depth > 32) return self;

    // Visit the pieces between bands, then add every run of neighbors that doesn't cross a rule.
    const edges = alongY ? [self.y, ...bands.flatMap((b) => [b.start, b.end]), self.y + self.height] : [self.x, ...bands.flatMap((b) => [b.start, b.end]), self.x + self.width];
    let run: Block[] = [];
    const flush = () => {
      for (let i = 0; i < run.length; i++) {
        let merged = run[i]!;
        for (let j = i + 1; j < run.length; j++) {
          merged = union(merged, run[j]!);
          // The whole run is `self` when there are no rules; it's already a candidate.
          if (!(i === 0 && j === run.length - 1 && !bands.some((b) => b.rule))) candidates.push(merged);
        }
      }
      run = [];
    };
    for (let k = 0; k < edges.length; k += 2) {
      const piece = alongY ? visit(self.x, edges[k]!, self.x + self.width, edges[k + 1]!, depth + 1) : visit(edges[k]!, self.y, edges[k + 1]!, self.y + self.height, depth + 1);
      if (piece) run.push(piece);
      if (bands[k / 2]?.rule) flush();
    }
    flush();
    return self;
  };

  const all = visit(0, 0, mask.width, mask.height, 0);
  return { candidates, all };
}

/** Clear runs of marked lines thicker than `max`: those are solid areas, not rules. */
function keepThinRuns(lines: Uint8Array, max: number): Uint8Array {
  for (let i = 0; i < lines.length; ) {
    if (!lines[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]) end++;
    if (end - i > max) lines.fill(0, i, end);
    i = end;
  }
  return lines;
}

function findRules(mask: InkMask, maxThickness: number): { rows: Uint8Array; cols: Uint8Array } {
  const { width, height, data } = mask;
  const rowInk = new Uint32Array(height);
  const colInk = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x]) {
        rowInk[y]!++;
        colInk[x]!++;
      }
    }
  }
  const rows = new Uint8Array(height);
  const cols = new Uint8Array(width);
  for (let y = 0; y < height; y++) rows[y] = rowInk[y]! >= width * RULE_COVERAGE ? 1 : 0;
  for (let x = 0; x < width; x++) cols[x] = colInk[x]! >= height * RULE_COVERAGE ? 1 : 0;
  return { rows: keepThinRuns(rows, maxThickness), cols: keepThinRuns(cols, maxThickness) };
}

function pad(rect: Rect, by: number, width: number, height: number): Rect {
  const x = Math.max(0, rect.x - by);
  const y = Math.max(0, rect.y - by);
  return { x, y, width: Math.min(width, rect.x + rect.width + by) - x, height: Math.min(height, rect.y + rect.height + by) - y };
}

/**
 * Where the label is on a page.
 *
 * `dpi` is the mask's resolution. Pass null when it is unknown (an image of
 * unknown size): then only the ink's bounding box is used.
 */
export function findLabel(mask: InkMask, dpi: number | null): Detection {
  const { width, height } = mask;
  const whole: Rect = { x: 0, y: 0, width, height };
  if (dpi === null) {
    if (isLabelShaped(width, height)) return { crop: whole, fallback: false };
    const { all } = collectBlocks(mask, new Uint8Array(height), new Uint8Array(width), Number.POSITIVE_INFINITY);
    return all ? { crop: pad(all, 2, width, height), fallback: false } : { crop: whole, fallback: true };
  }
  if (isPhysicalLabel(width, height, dpi)) return { crop: whole, fallback: false };

  const rules = findRules(mask, Math.max(1, Math.round(dpi * MAX_RULE_IN)));
  const { candidates, all } = collectBlocks(mask, rules.rows, rules.cols, Math.max(2, Math.round(dpi * MIN_GAP_IN)));
  if (!all) return { crop: whole, fallback: true };
  const margin = Math.max(1, Math.round(dpi * 0.02));

  let best: Block | null = null;
  for (const block of candidates) {
    if (fitsOnLabel(block.width, block.height, dpi) && (!best || block.ink > best.ink)) best = block;
  }
  if (best) return { crop: pad(best, margin, width, height), fallback: false };
  return { crop: pad(all, margin, width, height), fallback: true };
}

/** Ink edges (black/white transitions) in a rect. Barcodes score high; solid fills don't. */
function edgeCount(mask: InkMask, rect: Rect): number {
  const { width, data } = mask;
  let edges = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const row = y * width;
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const v = data[row + x]!;
      if (x + 1 < rect.x + rect.width && data[row + x + 1] !== v) edges++;
      if (y + 1 < rect.y + rect.height && data[row + width + x] !== v) edges++;
    }
  }
  return edges;
}

/**
 * Clockwise quarter turns that make a crop portrait. Landscape labels turn so
 * the end with the most barcode-like detail lands at the bottom, where
 * carriers put the tracking barcode.
 */
export function uprightTurns(mask: InkMask, crop: Rect): 0 | 1 | 3 {
  if (crop.height >= crop.width) return 0;
  const end = Math.max(1, Math.round(crop.width * END_SHARE));
  const left = edgeCount(mask, { ...crop, width: end });
  const right = edgeCount(mask, { ...crop, x: crop.x + crop.width - end, width: end });
  // Clockwise sends the right end to the bottom.
  return right >= left ? 1 : 3;
}

/** Rotate by clockwise quarter turns (0-3). */
export function rotateQuarterTurns(bitmap: Bitmap, turns: number): Bitmap {
  let out = bitmap;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) out = rotateClockwise(out);
  return out;
}

/**
 * Threshold an already-scaled crop, turn it upright, and center it on a white
 * 812 x 1218 label. The crop must fit once rotated.
 */
export function composeLabel(crop: Bitmap, turns: number, width = LABEL_WIDTH_DOTS, height = LABEL_HEIGHT_DOTS): Bitmap {
  const upright = rotateQuarterTurns(threshold(crop), turns);
  if (upright.width > width || upright.height > height) {
    throw new Error(`Label crop is ${upright.width}x${upright.height}; it must fit in ${width}x${height}.`);
  }
  const out = createBitmap(width, height);
  const src = new Uint32Array(upright.data.buffer, upright.data.byteOffset, upright.width * upright.height);
  const dst = new Uint32Array(out.data.buffer, out.data.byteOffset, width * height);
  const ox = Math.floor((width - upright.width) / 2);
  const oy = Math.floor((height - upright.height) / 2);
  for (let y = 0; y < upright.height; y++) {
    dst.set(src.subarray(y * upright.width, (y + 1) * upright.width), (oy + y) * width + ox);
  }
  return out;
}

/** Scale that makes a crop fit on the label once rotated, never enlarging past `maxScale`. */
export function fitScale(crop: { width: number; height: number }, turns: number, maxScale = 1): number {
  const sideways = turns % 2 === 1;
  const w = sideways ? crop.height : crop.width;
  const h = sideways ? crop.width : crop.height;
  return Math.min(maxScale, LABEL_WIDTH_DOTS / w, LABEL_HEIGHT_DOTS / h);
}
