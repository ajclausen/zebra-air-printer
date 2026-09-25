import { PRINTER_DPI } from '@eco/shared';
import { create } from 'zustand';
import type { Size } from '@/doc/geometry';

/** Screen pixels per dot at "actual size" (a CSS inch is 96px). */
export const ACTUAL_SIZE_ZOOM = 96 / PRINTER_DPI;
export const MIN_ZOOM = ACTUAL_SIZE_ZOOM * 0.25;
export const MAX_ZOOM = ACTUAL_SIZE_ZOOM * 8;
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2, 3, 4].map((f) => f * ACTUAL_SIZE_ZOOM);

/** Space kept around the label when fitting (room for rulers and handles). */
const FIT_MARGIN = { x: 72, y: 64 };

interface ViewportStore {
  /** null = fit to the workspace. */
  zoom: number | null;
  /** Pan in screen pixels relative to the centered position. */
  panX: number;
  panY: number;
  setZoom: (zoom: number | null, anchor?: { x: number; y: number; container: Size; label: Size }) => void;
  panBy: (dx: number, dy: number) => void;
  reset: () => void;
}

export const useViewport = create<ViewportStore>()((set, get) => ({
  zoom: null,
  panX: 0,
  panY: 0,
  setZoom: (zoom, anchor) => {
    if (zoom === null) return set({ zoom: null, panX: 0, panY: 0 });
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (!anchor) return set({ zoom: clamped });
    // Keep the label point under the cursor fixed while zooming.
    const current = computeViewport(anchor.container, anchor.label, get());
    const sceneX = (anchor.x - current.offsetX) / current.zoom;
    const sceneY = (anchor.y - current.offsetY) / current.zoom;
    const centeredX = (anchor.container.width - anchor.label.width * clamped) / 2;
    const centeredY = (anchor.container.height - anchor.label.height * clamped) / 2;
    set({ zoom: clamped, panX: anchor.x - sceneX * clamped - centeredX, panY: anchor.y - sceneY * clamped - centeredY });
  },
  panBy: (dx, dy) => set({ panX: get().panX + dx, panY: get().panY + dy }),
  reset: () => set({ zoom: null, panX: 0, panY: 0 }),
}));

export function fitZoom(container: Size, label: Size): number {
  const zx = (container.width - FIT_MARGIN.x * 2) / label.width;
  const zy = (container.height - FIT_MARGIN.y * 2) / label.height;
  return Math.max(MIN_ZOOM, Math.min(zx, zy, ACTUAL_SIZE_ZOOM * 3));
}

export interface ComputedViewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Screen transform for the label: zoom plus the label's top-left in
 * workspace pixels. Pan is clamped so part of the label always stays visible.
 */
export function computeViewport(container: Size, label: Size, state: Pick<ViewportStore, 'zoom' | 'panX' | 'panY'>): ComputedViewport {
  const zoom = state.zoom ?? fitZoom(container, label);
  const w = label.width * zoom;
  const h = label.height * zoom;
  const limitX = Math.max(0, (w - container.width) / 2 + 120);
  const limitY = Math.max(0, (h - container.height) / 2 + 120);
  const panX = Math.min(limitX, Math.max(-limitX, state.panX));
  const panY = Math.min(limitY, Math.max(-limitY, state.panY));
  return {
    zoom,
    offsetX: Math.round((container.width - w) / 2 + panX),
    offsetY: Math.round((container.height - h) / 2 + panY),
  };
}

export function zoomPercent(zoom: number): number {
  return Math.round((zoom / ACTUAL_SIZE_ZOOM) * 100);
}
