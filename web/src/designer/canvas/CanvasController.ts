import { ActiveSelection, cache, Canvas, FabricObject, Point, type TPointerEventInfo } from 'fabric';
import { defaultFieldValues } from '@/doc/elements';
import { ensureDocumentFonts, isFontReady } from '@/doc/fonts';
import { labelSize, type Size } from '@/doc/geometry';
import { expandToGroups } from '@/doc/operations';
import type { BarcodeElement, LabelDocument, LabelElement, TextElement } from '@/doc/types';
import { isMatrix } from '@/render/barcode';
import { LabelTextbox } from '@/render/LabelTextbox';
import {
  absoluteTransform,
  barcodeNaturalSize,
  canUpdateInPlace,
  createObject,
  isLabelObject,
  updateObject,
  type ContentResolver,
  type LabelObject,
} from '@/render/objects';
import { editorResolver } from '@/render/print';
import { textControls } from './controls';
import { SnapGuides } from './snapping';

const COBALT = '#2f5bff';

// Editor-wide selection styling. Print rendering uses StaticCanvas, which never draws controls.
Object.assign(FabricObject.ownDefaults, {
  borderColor: COBALT,
  cornerColor: '#ffffff',
  cornerStrokeColor: COBALT,
  cornerStyle: 'rect',
  cornerSize: 9,
  touchCornerSize: 30,
  transparentCorners: false,
  borderScaleFactor: 1.5,
  padding: 0,
  lockSkewingX: true,
  lockSkewingY: true,
  lockScalingFlip: true,
  snapAngle: 15,
  snapThreshold: 4,
});
Object.assign(ActiveSelection.ownDefaults, { borderDashArray: [5, 4], hasControls: true });

export interface ViewportState {
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface CanvasCallbacks {
  getDoc: () => LabelDocument;
  getSelection: () => string[];
  setSelection: (ids: string[]) => void;
  commitPatches: (patches: Record<string, Partial<LabelElement>>) => void;
  syncDerived: (patches: Record<string, Partial<LabelElement>>) => void;
  removeElements: (ids: string[]) => void;
  /** Called when a barcode's data cannot be encoded (or becomes valid again). */
  onContentErrors?: (errors: Record<string, string>) => void;
}

const round = (value: number) => Math.round(value);

function normalizeAngle(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  const rounded = Math.round(a * 10) / 10;
  return rounded === 360 ? 0 : rounded;
}

/**
 * Owns the Fabric canvas for the editor and keeps it in step with the document:
 * the store is the source of truth; Fabric objects are a projection of it.
 * User edits on the canvas are read back into element patches.
 */
export class CanvasController {
  readonly canvas: Canvas;
  private readonly objects = new Map<string, LabelObject>();
  /** The element each object was last built from. */
  private readonly synced = new Map<string, LabelElement>();
  /** Latest async build per element; stale builds are dropped. */
  private readonly versions = new Map<string, number>();
  private readonly contentErrors = new Map<string, string>();
  private readonly guides: SnapGuides;
  private resolver: ContentResolver;
  private viewport: ViewportState = { width: 1, height: 1, zoom: 1, offsetX: 0, offsetY: 0 };
  private labelSize: Size = labelSize('portrait');
  private applyingSelection = false;
  private hovered: LabelObject | null = null;
  private editingHeight = new Map<string, number>();
  private pendingEdit: string | null = null;
  /** Fabric fires object:modified right after editing ends; the text commit already covers it. */
  private justExitedEditing: FabricObject | null = null;
  private disposed = false;

  constructor(element: HTMLCanvasElement, private readonly callbacks: CanvasCallbacks) {
    this.canvas = new Canvas(element, {
      preserveObjectStacking: true,
      selectionColor: 'rgba(47, 91, 255, 0.07)',
      selectionBorderColor: COBALT,
      selectionLineWidth: 1,
      uniformScaling: true,
      controlsAboveOverlay: true,
      renderOnAddRemove: false,
      targetFindTolerance: 4,
      imageSmoothingEnabled: true,
    });
    this.resolver = editorResolver({});
    this.guides = new SnapGuides(this.canvas, () => this.labelSize, () => this.viewport.zoom);
    this.bindEvents();
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  setViewport(viewport: ViewportState): void {
    this.viewport = viewport;
    this.canvas.setDimensions({ width: viewport.width, height: viewport.height });
    this.canvas.setViewportTransform([viewport.zoom, 0, 0, viewport.zoom, viewport.offsetX, viewport.offsetY]);
    this.canvas.requestRenderAll();
  }

  /** Convert a client (screen) point to label coordinates in dots. */
  clientToScene(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
    const { zoom, offsetX, offsetY } = this.viewport;
    return { x: (clientX - rect.left - offsetX) / zoom, y: (clientY - rect.top - offsetY) / zoom };
  }

  /** Convert label coordinates (dots) to a client (screen) point. */
  sceneToClient(x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
    const { zoom, offsetX, offsetY } = this.viewport;
    return { x: rect.left + offsetX + x * zoom, y: rect.top + offsetY + y * zoom };
  }

  // -------------------------------------------------------------------------
  // Document -> canvas
  // -------------------------------------------------------------------------

  /** Bring the canvas in line with the document. Safe to call on every store change. */
  sync(doc: LabelDocument): void {
    if (this.disposed) return;
    this.labelSize = labelSize(doc.orientation);
    this.resolver = editorResolver(defaultFieldValues(doc));
    void ensureDocumentFonts(doc).then((loadedNew) => {
      if (loadedNew && !this.disposed) this.relayoutText();
    });
    const ids = new Set(doc.elements.map((el) => el.id));

    for (const [id, obj] of this.objects) {
      if (ids.has(id)) continue;
      this.canvas.remove(obj);
      this.objects.delete(id);
      this.synced.delete(id);
      this.versions.delete(id);
      this.contentErrors.delete(id);
    }

    const changed = doc.elements.filter((el) => this.synced.get(el.id) !== el);
    if (changed.length > 0) {
      const restore = this.releaseSelectionFor(changed.map((el) => el.id));
      for (const el of changed) this.syncElement(el);
      if (restore) this.applySelection(this.callbacks.getSelection(), true);
    }
    this.applyOrder(doc);
    this.reportContentErrors();
    this.canvas.requestRenderAll();
  }

  /** Re-measure all text after a font finishes loading (Fabric caches glyph widths per family). */
  private relayoutText(): void {
    cache.clearFontCache();
    for (const [id, el] of this.synced) if (el.type === 'text') this.synced.delete(id);
    this.sync(this.callbacks.getDoc());
  }

  /**
   * Objects inside a multi-selection are positioned relative to it. Drop the
   * selection before moving them so the new absolute positions apply cleanly.
   */
  private releaseSelectionFor(ids: string[]): boolean {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof ActiveSelection)) return false;
    const members = active.getObjects().filter(isLabelObject);
    if (!members.some((obj) => ids.includes(obj.elementId))) return false;
    this.applyingSelection = true;
    this.canvas.discardActiveObject();
    this.applyingSelection = false;
    return true;
  }

  private syncElement(el: LabelElement): void {
    const previous = this.synced.get(el.id);
    this.synced.set(el.id, el);
    const version = (this.versions.get(el.id) ?? 0) + 1;
    this.versions.set(el.id, version);
    const existing = this.objects.get(el.id);
    const resolver = this.resolver;

    const isCurrent = () => !this.disposed && this.versions.get(el.id) === version;

    if (existing && canUpdateInPlace(existing, el)) {
      const task = updateObject(existing, el, resolver);
      const finish = () => {
        if (!isCurrent()) return;
        this.decorate(existing, el);
        this.afterLayout(existing, el, previous);
        this.canvas.requestRenderAll();
      };
      if (el.type === 'text' || el.type === 'shape' || el.type === 'line') {
        // Synchronous updates: finish now so selection and snapping see the new geometry.
        void task;
        finish();
      } else {
        task.then(finish, (error) => console.error('Could not update element', error));
      }
      return;
    }

    createObject(el, resolver).then(
      (obj) => {
        if (!isCurrent()) return;
        const old = this.objects.get(el.id);
        const wasActive = old ? this.canvas.getActiveObjects().includes(old) : false;
        if (old) this.canvas.remove(old);
        this.objects.set(el.id, obj);
        this.decorate(obj, el);
        this.canvas.add(obj);
        this.applyOrder(this.callbacks.getDoc());
        this.afterLayout(obj, el, previous);
        if (wasActive || this.callbacks.getSelection().includes(el.id)) this.applySelection(this.callbacks.getSelection(), true);
        this.maybeStartEditing();
        this.canvas.requestRenderAll();
      },
      (error) => console.error('Could not draw element', error),
    );
  }

  /** Write back sizes that come from layout rather than from the user. */
  private afterLayout(obj: LabelObject, el: LabelElement, _previous: LabelElement | undefined): void {
    if (obj.contentError) this.contentErrors.set(el.id, obj.contentError);
    else this.contentErrors.delete(el.id);

    if (el.type === 'barcode') {
      if (obj.contentError) return;
      const natural = barcodeNaturalSize(obj, el);
      if (natural.width !== el.width || natural.height !== el.height) {
        this.callbacks.syncDerived({ [el.id]: { width: natural.width, height: natural.height } });
      }
    } else if (el.type === 'text' && !el.autoFit && isFontReady(el.font, el.fontWeight, el.italic)) {
      // Text that grew past its box keeps the grown height, so bounds and alignment stay accurate.
      const height = Math.ceil((obj as unknown as LabelTextbox).height);
      if (height > el.height) this.callbacks.syncDerived({ [el.id]: { height } satisfies Partial<TextElement> });
    }
    this.reportContentErrors();
  }

  private reportContentErrors(): void {
    this.callbacks.onContentErrors?.(Object.fromEntries(this.contentErrors));
  }

  private applyOrder(doc: LabelDocument): void {
    let index = 0;
    for (const el of doc.elements) {
      const obj = this.objects.get(el.id);
      if (!obj) continue;
      if (this.canvas.getObjects()[index] !== obj) this.canvas.moveObjectTo(obj, index);
      index++;
    }
  }

  /** Interaction settings for an element's object. */
  private decorate(obj: LabelObject, el: LabelElement): void {
    const locked = Boolean(el.locked);
    const barcode = el.type === 'barcode';
    obj.set({
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked || barcode,
      hasControls: !locked,
      hoverCursor: locked ? 'default' : 'move',
    });
    if (el.type === 'text' && obj instanceof LabelTextbox) {
      Object.assign(obj, { autoFit: el.autoFit });
      obj.editable = !locked;
      obj.controls = textControls(el.autoFit, obj.controls);
    }
    const matrixBarcode = barcode && isMatrix((el as BarcodeElement).symbology);
    const line = el.type === 'line';
    obj.setControlsVisibility({
      mtr: !barcode,
      ml: !matrixBarcode,
      mr: !matrixBarcode,
      mt: !matrixBarcode && !line,
      mb: !matrixBarcode && !line,
    });
    obj.setCoords();
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /** Make the canvas selection match `ids`. */
  applySelection(ids: string[], force = false): void {
    const current = this.canvas.getActiveObjects().filter(isLabelObject).map((obj) => obj.elementId);
    if (!force && current.length === ids.length && ids.every((id) => current.includes(id))) return;
    const objs = ids.map((id) => this.objects.get(id)).filter((obj): obj is LabelObject => Boolean(obj));
    this.applyingSelection = true;
    try {
      const active = this.canvas.getActiveObject();
      if (active && isLabelObject(active) && (active as unknown as LabelTextbox).isEditing) return;
      this.canvas.discardActiveObject();
      if (objs.length === 1) this.canvas.setActiveObject(objs[0]!);
      else if (objs.length > 1) this.canvas.setActiveObject(new ActiveSelection(objs, { canvas: this.canvas }));
    } finally {
      this.applyingSelection = false;
    }
    this.canvas.requestRenderAll();
  }

  private selectionFromCanvas(): void {
    if (this.applyingSelection) return;
    const ids = this.canvas.getActiveObjects().filter(isLabelObject).map((obj) => obj.elementId);
    const expanded = expandToGroups(this.callbacks.getDoc(), ids);
    this.callbacks.setSelection(expanded);
    if (expanded.length !== ids.length) this.applySelection(expanded, true);
  }

  // -------------------------------------------------------------------------
  // Text editing
  // -------------------------------------------------------------------------

  /** Enter inline editing for a text element once its object exists. */
  requestEdit(id: string): void {
    this.pendingEdit = id;
    this.maybeStartEditing();
  }

  private maybeStartEditing(): void {
    if (!this.pendingEdit) return;
    const obj = this.objects.get(this.pendingEdit);
    if (!(obj instanceof LabelTextbox)) return;
    this.pendingEdit = null;
    this.canvas.setActiveObject(obj);
    obj.enterEditing();
    obj.selectAll();
    this.canvas.requestRenderAll();
  }

  private findElement(id: string): LabelElement | undefined {
    return this.callbacks.getDoc().elements.find((el) => el.id === id);
  }

  private onEditingEntered(target: LabelTextbox & LabelObject): void {
    const el = this.findElement(target.elementId);
    if (el?.type === 'text' && el.uppercase && target.text !== el.text) {
      // Edit the real text; the uppercase display returns when editing ends.
      target.set('text', el.text);
      target.initDimensions();
      target.setSelectionEnd(el.text.length);
    }
    this.editingHeight.set(target.elementId, target.height);
  }

  /** Keep the top edge still while the text grows or shrinks. */
  private onTextChanged(target: LabelTextbox & LabelObject): void {
    const before = this.editingHeight.get(target.elementId) ?? target.height;
    const delta = target.height - before;
    if (delta !== 0) {
      const rad = (target.angle * Math.PI) / 180;
      target.set({ left: target.left - (Math.sin(rad) * delta) / 2, top: target.top + (Math.cos(rad) * delta) / 2 });
      target.setCoords();
    }
    this.editingHeight.set(target.elementId, target.height);
  }

  private onEditingExited(target: LabelTextbox & LabelObject): void {
    this.justExitedEditing = target;
    queueMicrotask(() => {
      this.justExitedEditing = null;
    });
    this.editingHeight.delete(target.elementId);
    const el = this.findElement(target.elementId);
    if (el?.type !== 'text') return;
    const text = target.text;
    if (!text.trim()) {
      this.callbacks.removeElements([el.id]);
      return;
    }
    // Force a re-render from the element even if the text is unchanged (restores uppercase display).
    this.synced.delete(el.id);
    // Editing never moves the box: keep the element's position and let sync lay out the new text.
    if (text !== el.text) this.callbacks.commitPatches({ [el.id]: { text } });
    else this.sync(this.callbacks.getDoc());
  }

  // -------------------------------------------------------------------------
  // Canvas -> document
  // -------------------------------------------------------------------------

  /** Element patch describing an object's current transform on the canvas. */
  private readBack(obj: LabelObject, el: LabelElement): Partial<LabelElement> {
    const t = absoluteTransform(obj);
    const angle = normalizeAngle(t.angle);
    switch (el.type) {
      case 'text': {
        const tb = obj as unknown as LabelTextbox;
        const scaled = Math.abs(t.scaleX - 1) > 1e-3 || Math.abs(t.scaleY - 1) > 1e-3;
        const fontScale = !el.autoFit && scaled ? t.scaleY : 1;
        const width = tb.width * t.scaleX;
        const boxHeight = tb.boxHeight * t.scaleY;
        const shownHeight = tb.height * t.scaleY;
        return {
          x: round(t.centerX - width / 2),
          y: round(t.centerY - shownHeight / 2),
          width: Math.max(8, round(width)),
          height: Math.max(8, round(fontScale === 1 ? boxHeight : shownHeight)),
          angle,
          fontSize: Math.max(4, Math.round(el.fontSize * fontScale)),
        };
      }
      case 'barcode': {
        const quarter = el.angle === 90 || el.angle === 270;
        const sx = quarter ? t.scaleY : t.scaleX;
        const sy = quarter ? t.scaleX : t.scaleY;
        const matrix = isMatrix(el.symbology);
        const moduleSize = Math.max(1, Math.round(el.moduleSize * (matrix ? Math.max(sx, sy) : sx)));
        const barHeight = matrix ? el.barHeight : Math.max(10, Math.round(el.barHeight * sy));
        const width = el.width * (moduleSize / el.moduleSize);
        const height = matrix ? el.height * (moduleSize / el.moduleSize) : el.height + (barHeight - el.barHeight);
        return { x: round(t.centerX - width / 2), y: round(t.centerY - height / 2), moduleSize, barHeight };
      }
      case 'shape': {
        const sw = el.strokeWidth;
        const width = (obj.width ?? 0) * t.scaleX + sw;
        const height = (obj.height ?? 0) * t.scaleY + sw;
        return { x: round(t.centerX - width / 2), y: round(t.centerY - height / 2), width: Math.max(1, round(width)), height: Math.max(1, round(height)), angle };
      }
      default: {
        const width = obj.width * t.scaleX;
        const height = obj.height * t.scaleY;
        return { x: round(t.centerX - width / 2), y: round(t.centerY - height / 2), width: Math.max(1, round(width)), height: Math.max(1, round(height)), angle };
      }
    }
  }

  private onModified(target: FabricObject | undefined): void {
    if (!target || target === this.justExitedEditing) return;
    const objs = target instanceof ActiveSelection ? target.getObjects() : [target];
    const patches: Record<string, Partial<LabelElement>> = {};
    for (const obj of objs) {
      if (!isLabelObject(obj)) continue;
      const el = this.findElement(obj.elementId);
      if (el) patches[el.id] = this.readBack(obj, el);
    }
    if (Object.keys(patches).length) this.callbacks.commitPatches(patches);
  }

  // -------------------------------------------------------------------------
  // Events and overlay drawing
  // -------------------------------------------------------------------------

  private bindEvents(): void {
    const c = this.canvas;
    c.on('selection:created', () => this.selectionFromCanvas());
    c.on('selection:updated', () => this.selectionFromCanvas());
    c.on('selection:cleared', () => this.selectionFromCanvas());
    c.on('object:modified', (e) => {
      this.guides.clear();
      this.onModified(e.target);
    });
    c.on('object:moving', (e) => this.guides.snap(e.target, this.objectsExcept(e.target)));
    c.on('mouse:up', () => {
      this.guides.clear();
      c.requestRenderAll();
    });
    c.on('mouse:over', (e: TPointerEventInfo & { target?: FabricObject }) => {
      this.hovered = e.target && isLabelObject(e.target) ? e.target : null;
      c.requestRenderAll();
    });
    c.on('mouse:out', () => {
      this.hovered = null;
      c.requestRenderAll();
    });
    c.on('text:editing:entered', (e) => this.onEditingEntered(e.target as LabelTextbox & LabelObject));
    c.on('text:changed', (e) => this.onTextChanged(e.target as LabelTextbox & LabelObject));
    c.on('text:editing:exited', (e) => this.onEditingExited(e.target as LabelTextbox & LabelObject));
    c.on('after:render', ({ ctx }) => this.drawOverlay(ctx));
  }

  private objectsExcept(target: FabricObject | undefined): FabricObject[] {
    const moving = new Set<FabricObject>(target instanceof ActiveSelection ? target.getObjects() : target ? [target] : []);
    return [...this.objects.values()].filter((obj) => !moving.has(obj) && obj.visible);
  }

  /** Dim everything outside the label, then draw hover outlines and snap guides. */
  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const { zoom, offsetX, offsetY } = this.viewport;
    const { width, height } = this.labelSize;
    const x = offsetX;
    const y = offsetY;
    const w = width * zoom;
    const h = height * zoom;
    const radius = 25 * zoom;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.canvas.width, this.canvas.height);
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = 'rgba(227, 229, 233, 0.78)';
    ctx.fill('evenodd');

    const active = this.canvas.getActiveObjects();
    if (this.hovered && !active.includes(this.hovered)) {
      const coords = this.hovered.getCoords().map((p) => new Point(p.x * zoom + offsetX, p.y * zoom + offsetY));
      ctx.beginPath();
      coords.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.strokeStyle = COBALT;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    this.guides.draw(ctx, this.viewport);
  }

  dispose(): void {
    this.disposed = true;
    void this.canvas.dispose();
  }
}
