import type { Canvas, FabricObject, TBBox } from 'fabric';
import type { Size } from '@/doc/geometry';

/** Screen pixels within which an edge snaps. */
const SNAP_PX = 6;

interface Guide {
  axis: 'x' | 'y';
  /** Position on the snapped axis, in label dots. */
  at: number;
  /** Extent along the other axis, in label dots. */
  from: number;
  to: number;
}

interface Candidate {
  at: number;
  from: number;
  to: number;
}

function edges(box: TBBox, axis: 'x' | 'y'): number[] {
  return axis === 'x' ? [box.left, box.left + box.width / 2, box.left + box.width] : [box.top, box.top + box.height / 2, box.top + box.height];
}

/**
 * Snap a moving object's edges and center to the label's edges and center and
 * to other objects, and draw the guides that explain the snap.
 */
export class SnapGuides {
  private guides: Guide[] = [];

  constructor(
    private readonly canvas: Canvas,
    private readonly getLabel: () => Size,
    private readonly getZoom: () => number,
  ) {}

  snap(target: FabricObject | undefined, others: FabricObject[]): void {
    this.guides = [];
    if (!target) return;
    target.setCoords();
    const box = target.getBoundingRect();
    const label = this.getLabel();
    const threshold = SNAP_PX / this.getZoom();
    const otherBoxes = others.map((o) => o.getBoundingRect());

    const candidates = (axis: 'x' | 'y'): Candidate[] => {
      const span = axis === 'x' ? label.height : label.width;
      const size = axis === 'x' ? label.width : label.height;
      const list: Candidate[] = [0, size / 2, size].map((at) => ({ at, from: 0, to: span }));
      for (const other of otherBoxes) {
        const [from, to] = axis === 'x' ? [other.top, other.top + other.height] : [other.left, other.left + other.width];
        for (const at of edges(other, axis)) list.push({ at, from, to });
      }
      return list;
    };

    for (const axis of ['x', 'y'] as const) {
      let best: { delta: number; candidate: Candidate } | null = null;
      for (const edge of edges(box, axis)) {
        for (const candidate of candidates(axis)) {
          const delta = candidate.at - edge;
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, candidate };
        }
      }
      if (!best) continue;
      if (axis === 'x') target.set('left', target.left + best.delta);
      else target.set('top', target.top + best.delta);
      const [ownFrom, ownTo] = axis === 'x' ? [box.top, box.top + box.height] : [box.left, box.left + box.width];
      this.guides.push({
        axis,
        at: best.candidate.at,
        from: Math.min(best.candidate.from, ownFrom),
        to: Math.max(best.candidate.to, ownTo),
      });
    }
    target.setCoords();
  }

  clear(): void {
    this.guides = [];
  }

  draw(ctx: CanvasRenderingContext2D, viewport: { zoom: number; offsetX: number; offsetY: number }): void {
    if (this.guides.length === 0) return;
    const { zoom, offsetX, offsetY } = viewport;
    ctx.save();
    ctx.strokeStyle = '#e5337a';
    ctx.lineWidth = 1;
    for (const guide of this.guides) {
      ctx.beginPath();
      if (guide.axis === 'x') {
        const x = Math.round(guide.at * zoom + offsetX) + 0.5;
        ctx.moveTo(x, guide.from * zoom + offsetY - 8);
        ctx.lineTo(x, guide.to * zoom + offsetY + 8);
      } else {
        const y = Math.round(guide.at * zoom + offsetY) + 0.5;
        ctx.moveTo(guide.from * zoom + offsetX - 8, y);
        ctx.lineTo(guide.to * zoom + offsetX + 8, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    void this.canvas;
  }
}
