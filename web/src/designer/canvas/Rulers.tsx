import { PRINTER_DPI } from '@eco/shared';
import { useEffect, useRef } from 'react';
import type { Size, Unit } from '@/doc/geometry';
import type { ComputedViewport } from '../viewport';

export const RULER_SIZE = 20;

interface RulerProps {
  axis: 'x' | 'y';
  length: number;
  viewport: ComputedViewport;
  label: Size;
  unit: Unit;
  /** Selection extent in dots along this axis, highlighted on the ruler. */
  highlight: [number, number] | null;
}

/** Tick spacing in dots: minor, mid, major (labelled). */
function tickPlan(unit: Unit, zoom: number): { minor: number; mid: number; major: number; labelEvery: number; factor: number } {
  if (unit === 'mm') {
    const mm = PRINTER_DPI / 25.4;
    const dense = mm * zoom >= 4;
    return { minor: dense ? mm : mm * 5, mid: mm * 5, major: mm * 10, labelEvery: mm * 10, factor: 10 };
  }
  const eighth = PRINTER_DPI / 8;
  const dense = eighth * zoom >= 5;
  return { minor: dense ? eighth : PRINTER_DPI / 4, mid: PRINTER_DPI / 2, major: PRINTER_DPI, labelEvery: PRINTER_DPI, factor: 1 };
}

function Ruler({ axis, length, viewport, label, unit, highlight }: RulerProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = axis === 'x' ? length : RULER_SIZE;
    const h = axis === 'x' ? RULER_SIZE : length;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { zoom } = viewport;
    const origin = axis === 'x' ? viewport.offsetX : viewport.offsetY;
    const extent = axis === 'x' ? label.width : label.height;
    const toScreen = (dots: number) => origin + dots * zoom;

    // Label extent band.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    if (axis === 'x') ctx.fillRect(toScreen(0), 0, extent * zoom, RULER_SIZE);
    else ctx.fillRect(0, toScreen(0), RULER_SIZE, extent * zoom);

    if (highlight) {
      ctx.fillStyle = 'rgba(47, 91, 255, 0.16)';
      const [a, b] = highlight;
      if (axis === 'x') ctx.fillRect(toScreen(a), 0, (b - a) * zoom, RULER_SIZE);
      else ctx.fillRect(0, toScreen(a), RULER_SIZE, (b - a) * zoom);
    }

    const plan = tickPlan(unit, zoom);
    ctx.strokeStyle = '#9aa0a9';
    ctx.fillStyle = '#6b707a';
    ctx.font = '500 9.5px Inter, sans-serif';
    ctx.lineWidth = 1;
    const count = Math.round(extent / plan.minor);
    ctx.beginPath();
    for (let i = 0; i <= count; i++) {
      const dots = i * plan.minor;
      if (dots > extent + 0.5) break;
      const isMajor = Math.abs(dots / plan.major - Math.round(dots / plan.major)) < 1e-6;
      const isMid = Math.abs(dots / plan.mid - Math.round(dots / plan.mid)) < 1e-6;
      const tick = isMajor ? 9 : isMid ? 6 : 3;
      const p = Math.round(toScreen(dots)) + 0.5;
      if (axis === 'x') {
        ctx.moveTo(p, RULER_SIZE);
        ctx.lineTo(p, RULER_SIZE - tick);
      } else {
        ctx.moveTo(RULER_SIZE, p);
        ctx.lineTo(RULER_SIZE - tick, p);
      }
      if (isMajor && dots > 0) {
        const text = String(Math.round((dots / plan.labelEvery) * plan.factor));
        if (axis === 'x') ctx.fillText(text, p + 3, 10);
        else {
          ctx.save();
          ctx.translate(10, p + 3);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.stroke();
    // Baseline.
    ctx.strokeStyle = '#c5c9d0';
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(0, RULER_SIZE - 0.5);
      ctx.lineTo(w, RULER_SIZE - 0.5);
    } else {
      ctx.moveTo(RULER_SIZE - 0.5, 0);
      ctx.lineTo(RULER_SIZE - 0.5, h);
    }
    ctx.stroke();
  }, [axis, length, viewport, label, unit, highlight]);

  return <canvas ref={ref} aria-hidden className="block" />;
}

export function Rulers({
  container,
  viewport,
  label,
  unit,
  selection,
}: {
  container: Size;
  viewport: ComputedViewport;
  label: Size;
  unit: Unit;
  selection: { left: number; top: number; right: number; bottom: number } | null;
}) {
  // The rulers sit on the workspace edges; offset the viewport so ticks line up.
  const xViewport = { ...viewport, offsetX: viewport.offsetX - RULER_SIZE };
  const yViewport = { ...viewport, offsetY: viewport.offsetY - RULER_SIZE };
  return (
    <>
      <div className="pointer-events-none absolute top-0 right-0 left-[20px] z-10 bg-surface/90 backdrop-blur-sm">
        <Ruler axis="x" length={container.width - RULER_SIZE} viewport={xViewport} label={label} unit={unit} highlight={selection ? [selection.left, selection.right] : null} />
      </div>
      <div className="pointer-events-none absolute top-[20px] bottom-0 left-0 z-10 bg-surface/90 backdrop-blur-sm">
        <Ruler axis="y" length={container.height - RULER_SIZE} viewport={yViewport} label={label} unit={unit} highlight={selection ? [selection.top, selection.bottom] : null} />
      </div>
      <div className="pointer-events-none absolute top-0 left-0 z-10 flex size-[20px] items-center justify-center border-r border-b border-line-strong bg-surface text-[9px] font-medium text-ink-4">
        {unit}
      </div>
    </>
  );
}
