import { describe, expect, it } from 'vitest';
import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';
import { createBitmap, isPureMonochrome } from '@/render/bitmap';
import { composeLabel, findLabel, fitScale, inkMask, uprightTurns, type InkMask, type Rect } from './detect';

const DPI = 100;

function blankMask(width: number, height: number): InkMask {
  return { width, height, data: new Uint8Array(width * height) };
}

function fill(mask: InkMask, x: number, y: number, w: number, h: number): void {
  for (let yy = y; yy < y + h; yy++) mask.data.fill(1, yy * mask.width + x, yy * mask.width + x + w);
}

/** Text-like lines: short dashes with gaps, like words. */
function text(mask: InkMask, x: number, y: number, w: number, lines: number, lineHeight = 14): void {
  for (let i = 0; i < lines; i++) {
    for (let xx = x; xx < x + w; xx += 12) fill(mask, xx, y + i * lineHeight, 8, 6);
  }
}

/** Barcode: bars perpendicular to the long axis, with varying widths. */
function barcode(mask: InkMask, x: number, y: number, w: number, h: number, bars: 'vertical' | 'horizontal'): void {
  const span = bars === 'vertical' ? w : h;
  for (let i = 0, pos = 0; pos < span; i++) {
    const thick = 1 + (i % 3);
    if (bars === 'vertical') fill(mask, x + pos, y, Math.min(thick, span - pos), h);
    else fill(mask, x, y + pos, w, Math.min(thick, span - pos));
    pos += thick + 1 + (i % 2);
  }
}

/**
 * A FedEx-style Letter page at 100 dpi: sparse instructions on top, a thick
 * full-width fold rule, and a landscape 5.6" x 3.9" label below with its
 * tracking barcode on the right (or left) end and blank bands inside it.
 */
function fedexPage(barcodeEnd: 'right' | 'left' = 'right'): { mask: InkMask; label: Rect } {
  const mask = blankMask(850, 1100);
  text(mask, 80, 150, 690, 12);
  fill(mask, 60, 548, 730, 5);
  const label: Rect = { x: 60, y: 650, width: 560, height: 390 };
  const codeX = barcodeEnd === 'right' ? label.x + 420 : label.x;
  const textX = barcodeEnd === 'right' ? label.x : label.x + 410;
  text(mask, textX, label.y, 150, 6);
  text(mask, textX, label.y + 200, 150, 6); // 0.8" blank band above: inside the label
  fill(mask, label.x + 250, label.y + 100, 80, 80); // the 2D code block
  barcode(mask, codeX, label.y, 140, label.height, 'horizontal');
  return { mask, label };
}

function expectCropNear(crop: Rect, target: Rect, slack = 4): void {
  expect(Math.abs(crop.x - target.x)).toBeLessThanOrEqual(slack);
  expect(Math.abs(crop.y - target.y)).toBeLessThanOrEqual(slack);
  expect(Math.abs(crop.x + crop.width - (target.x + target.width))).toBeLessThanOrEqual(slack);
  expect(Math.abs(crop.y + crop.height - (target.y + target.height))).toBeLessThanOrEqual(slack);
}

describe('findLabel', () => {
  it('finds the whole label on a FedEx-style Letter page and skips the instructions and fold rule', () => {
    const { mask, label } = fedexPage();
    const found = findLabel(mask, DPI);
    expect(found.fallback).toBe(false);
    expectCropNear(found.crop, label);
  });

  it('keeps a label whole when its own blank band is wider than the gap to the instructions', () => {
    // No fold rule: address block, a ~1" blank band, barcode, then instructions only 0.6" below.
    const mask = blankMask(850, 1100);
    text(mask, 100, 60, 380, 19); // address, y 60..~318
    barcode(mask, 100, 440, 380, 200, 'vertical'); // barcode, y 440..640
    text(mask, 60, 700, 730, 10); // instructions
    const found = findLabel(mask, DPI);
    expect(found.fallback).toBe(false);
    expectCropNear(found.crop, { x: 100, y: 60, width: 380, height: 580 });
  });

  it('never crops across a fold rule, even when label and instructions together would fit', () => {
    const mask = blankMask(850, 1100);
    text(mask, 100, 60, 380, 20); // label text, y 60..~332
    barcode(mask, 100, 390, 380, 200, 'vertical'); // y 390..590
    fill(mask, 40, 600, 770, 3); // fold rule
    text(mask, 100, 620, 380, 2); // a little instruction text right below
    const found = findLabel(mask, DPI);
    expect(found.fallback).toBe(false);
    expect(found.crop.y + found.crop.height).toBeLessThanOrEqual(600);
    expectCropNear(found.crop, { x: 100, y: 60, width: 380, height: 530 });
  });

  it('uses a page that is already 4x6 whole, in either orientation', () => {
    for (const [w, h] of [
      [400, 600],
      [600, 400],
    ] as const) {
      const mask = blankMask(w, h);
      text(mask, 20, 20, 100, 3);
      expect(findLabel(mask, DPI)).toEqual({ crop: { x: 0, y: 0, width: w, height: h }, fallback: false });
    }
  });

  it('falls back to all the ink when nothing fits on a label', () => {
    const mask = blankMask(850, 1100);
    fill(mask, 50, 50, 700, 900);
    const found = findLabel(mask, DPI);
    expect(found.fallback).toBe(true);
    expectCropNear(found.crop, { x: 50, y: 50, width: 700, height: 900 });
  });

  it('falls back to the whole page when it is blank', () => {
    expect(findLabel(blankMask(850, 1100), DPI)).toEqual({ crop: { x: 0, y: 0, width: 850, height: 1100 }, fallback: true });
  });

  it('crops to the ink when the resolution is unknown', () => {
    const mask = blankMask(500, 500);
    fill(mask, 100, 120, 200, 150);
    const found = findLabel(mask, null);
    expect(found.fallback).toBe(false);
    expectCropNear(found.crop, { x: 100, y: 120, width: 200, height: 150 });
  });

  it('uses a label-shaped image of unknown resolution whole', () => {
    const mask = blankMask(800, 1200);
    fill(mask, 100, 100, 50, 50);
    expect(findLabel(mask, null).crop).toEqual({ x: 0, y: 0, width: 800, height: 1200 });
  });
});

describe('uprightTurns', () => {
  it('turns clockwise when the barcode is on the right', () => {
    const { mask } = fedexPage('right');
    expect(uprightTurns(mask, findLabel(mask, DPI).crop)).toBe(1);
  });

  it('turns counter-clockwise when the barcode is on the left', () => {
    const { mask } = fedexPage('left');
    expect(uprightTurns(mask, findLabel(mask, DPI).crop)).toBe(3);
  });

  it('leaves portrait crops alone', () => {
    const mask = blankMask(400, 600);
    expect(uprightTurns(mask, { x: 0, y: 0, width: 400, height: 600 })).toBe(0);
  });
});

describe('composeLabel', () => {
  it('centers the thresholded crop on a pure black and white 812 x 1218 label', () => {
    const crop = createBitmap(10, 20);
    // Mid-gray (should become black) at the top-left pixel; light gray elsewhere stays white.
    crop.data.set([100, 100, 100, 255], 0);
    crop.data.set([200, 200, 200, 255], 4);
    const out = composeLabel(crop, 0);
    expect([out.width, out.height]).toEqual([LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS]);
    expect(isPureMonochrome(out)).toBe(true);
    const ox = (LABEL_WIDTH_DOTS - 10) / 2;
    const oy = (LABEL_HEIGHT_DOTS - 20) / 2;
    expect(out.data[(oy * LABEL_WIDTH_DOTS + ox) * 4]).toBe(0);
    expect(out.data[(oy * LABEL_WIDTH_DOTS + ox + 1) * 4]).toBe(255);
  });

  it('rotates landscape crops clockwise so their right end is at the bottom', () => {
    const crop = createBitmap(30, 10);
    crop.data.set([0, 0, 0, 255], (0 * 30 + 29) * 4); // top-right corner
    const out = composeLabel(crop, 1);
    // After a clockwise turn the crop is 10 x 30 and the top-right corner is the bottom-right.
    const ox = (LABEL_WIDTH_DOTS - 10) / 2;
    const oy = (LABEL_HEIGHT_DOTS - 30) / 2;
    expect(out.data[((oy + 29) * LABEL_WIDTH_DOTS + ox + 9) * 4]).toBe(0);
  });

  it('refuses a crop that does not fit', () => {
    expect(() => composeLabel(createBitmap(900, 10), 0)).toThrow(/must fit/);
  });
});

describe('fitScale', () => {
  it('keeps crops that fit at 1:1 and shrinks ones that do not', () => {
    expect(fitScale({ width: 1142, height: 791 }, 1)).toBe(1);
    expect(fitScale({ width: 1624, height: 2436 }, 0)).toBe(0.5);
    expect(fitScale({ width: 1624, height: 2436 }, 0, 0.25)).toBe(0.25);
  });
});

describe('inkMask', () => {
  it('marks dark opaque pixels as ink and treats transparency as paper', () => {
    const bitmap = createBitmap(3, 1);
    bitmap.data.set([0, 0, 0, 255, 250, 250, 250, 255, 0, 0, 0, 0]);
    expect([...inkMask(bitmap).data]).toEqual([1, 0, 0]);
  });
});
