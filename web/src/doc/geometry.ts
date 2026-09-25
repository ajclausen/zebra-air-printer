import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS, PRINTER_DPI, type Orientation } from '@eco/shared';

export type Unit = 'in' | 'mm';

export interface Size {
  width: number;
  height: number;
}

/** Canvas size in dots for an orientation. */
export function labelSize(orientation: Orientation): Size {
  return orientation === 'portrait'
    ? { width: LABEL_WIDTH_DOTS, height: LABEL_HEIGHT_DOTS }
    : { width: LABEL_HEIGHT_DOTS, height: LABEL_WIDTH_DOTS };
}

const MM_PER_INCH = 25.4;

export function dotsToUnit(dots: number, unit: Unit): number {
  const inches = dots / PRINTER_DPI;
  return unit === 'in' ? inches : inches * MM_PER_INCH;
}

export function unitToDots(value: number, unit: Unit): number {
  const inches = unit === 'in' ? value : value / MM_PER_INCH;
  return Math.round(inches * PRINTER_DPI);
}

/** Format dots for a numeric input: inches to 2 decimals, mm to 1. */
export function formatUnit(dots: number, unit: Unit): string {
  const value = dotsToUnit(dots, unit);
  const digits = unit === 'in' ? 2 : 1;
  return String(Number(value.toFixed(digits)));
}

export const inches = (value: number): number => Math.round(value * PRINTER_DPI);

/** Label corner radius on the physical stock (about 1/8 inch). */
export const LABEL_CORNER_RADIUS_DOTS = 25;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
