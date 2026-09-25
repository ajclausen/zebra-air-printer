import { classRegistry, Textbox, type TextboxProps, type TOptions } from 'fabric';
import type { VerticalAlign } from '@/doc/types';

export interface LabelTextboxProps extends TextboxProps {
  /** Minimum box height; the object is at least this tall. */
  boxHeight: number;
  /** Where the text block sits when the box is taller than the text. */
  verticalAlign: VerticalAlign;
  inset: number;
}

/**
 * A Textbox with a fixed minimum height and vertical alignment, so text can be
 * centered in a box (inverted banners, auto-fit signs). Fabric draws text,
 * cursor, and selection relative to `_getTopOffset`, so shifting it moves all
 * three together.
 */
export class LabelTextbox extends Textbox {
  static override type = 'LabelTextbox';

  declare boxHeight: number;
  declare verticalAlign: VerticalAlign;
  /** Horizontal padding inside the box (used for inverted text so it does not touch the edge). */
  declare inset: number;
  /** Height of the laid-out lines, without the extra box space. */
  declare textBlockHeight: number;

  constructor(text: string, options: TOptions<LabelTextboxProps> = {}) {
    super(text, options);
  }

  override _wrapText(lines: string[], desiredWidth: number): string[][] {
    return super._wrapText(lines, Math.max(1, desiredWidth - 2 * (this.inset ?? 0)));
  }

  override _getLineLeftOffset(lineIndex: number): number {
    const base = super._getLineLeftOffset(lineIndex);
    const inset = this.inset ?? 0;
    if (this.textAlign === 'right') return base - inset;
    if (this.textAlign === 'center') return base;
    return base + inset;
  }

  override initDimensions(): void {
    super.initDimensions();
    this.textBlockHeight = this.height;
    this.height = Math.max(this.height, this.boxHeight ?? 0);
  }

  override _getTopOffset(): number {
    const free = Math.max(0, this.height - (this.textBlockHeight ?? this.height));
    const align = this.verticalAlign ?? 'top';
    const shift = align === 'middle' ? free / 2 : align === 'bottom' ? free : 0;
    return -this.height / 2 + shift;
  }

  /**
   * Largest font size (whole dots) at which the text fits `width` x `height`
   * without breaking words. Leaves the object at that size.
   */
  fitToBox(width: number, height: number, maxSize = 2000): number {
    const fits = (size: number): boolean => {
      this.set({ fontSize: size, width });
      this.initDimensions();
      return this.textBlockHeight <= height + 0.5 && this.dynamicMinWidth + 2 * (this.inset ?? 0) <= width + 0.5;
    };
    let lo = 4;
    let hi = Math.max(lo, Math.min(maxSize, Math.ceil(height * 1.1)));
    if (!fits(lo)) return lo;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    fits(lo);
    return lo;
  }
}

classRegistry.setClass(LabelTextbox);
