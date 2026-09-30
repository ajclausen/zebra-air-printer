import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { elementBounds } from '@/doc/elements';
import { labelSize, LABEL_CORNER_RADIUS_DOTS, type Size } from '@/doc/geometry';
import { isPdf } from '@/import/prepare';
import { cn } from '@/lib/utils';
import { useEditor } from '../store';
import { computeViewport, useViewport } from '../viewport';
import { CanvasController } from './CanvasController';
import { Rulers, RULER_SIZE } from './Rulers';

let activeController: CanvasController | null = null;

/** The editor's canvas controller, for components that need to talk to Fabric directly. */
export function getCanvasController(): CanvasController | null {
  return activeController;
}

/** Content errors (e.g. invalid barcode data) reported by the canvas, keyed by element id. */
export const useContentErrors = (() => {
  let errors: Record<string, string> = {};
  const listeners = new Set<() => void>();
  return Object.assign(
    () => {
      const [, force] = useState(0);
      useEffect(() => {
        const listener = () => force((n) => n + 1);
        listeners.add(listener);
        return () => void listeners.delete(listener);
      }, []);
      return errors;
    },
    {
      set(next: Record<string, string>) {
        const same = Object.keys(next).length === Object.keys(errors).length && Object.entries(next).every(([k, v]) => errors[k] === v);
        if (same) return;
        errors = next;
        for (const l of listeners) l();
      },
      get: () => errors,
    },
  );
})();

function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export function Workspace({ children, onDropFiles }: { children?: React.ReactNode; onDropFiles?: (files: File[], point: { x: number; y: number }) => void }) {
  const [containerRef, container] = useElementSize<HTMLDivElement>();
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);
  const [dragging, setDragging] = useState<'image' | 'pdf' | false>(false);

  const { doc, selection, unit, editRequest } = useEditor(
    useShallow((s) => ({ doc: s.doc, selection: s.selection, unit: s.unit, editRequest: s.editRequest })),
  );
  const viewportState = useViewport(useShallow((s) => ({ zoom: s.zoom, panX: s.panX, panY: s.panY })));
  const label = useMemo(() => labelSize(doc.orientation), [doc.orientation]);
  const canvasArea = useMemo(() => ({ width: container.width, height: container.height }), [container.width, container.height]);
  const viewport = useMemo(() => computeViewport(canvasArea, label, viewportState), [canvasArea, label, viewportState]);

  // Create the Fabric canvas once. Fabric rewrites the DOM around its canvas, so it lives outside React.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const element = document.createElement('canvas');
    host.appendChild(element);
    const store = useEditor.getState;
    const controller = new CanvasController(element, {
      getDoc: () => store().doc,
      getSelection: () => store().selection,
      setSelection: (ids) => store().setSelection(ids),
      commitPatches: (patches) => store().updateMany(patches),
      syncDerived: (patches) => store().syncDerived(patches),
      removeElements: (ids) => store().remove(ids),
      onContentErrors: (errors) => useContentErrors.set(errors),
    });
    controllerRef.current = controller;
    activeController = controller;
    controller.sync(store().doc);
    return () => {
      controller.dispose();
      if (activeController === controller) activeController = null;
      controllerRef.current = null;
      host.replaceChildren();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.sync(doc);
  }, [doc]);
  useEffect(() => {
    controllerRef.current?.applySelection(selection);
  }, [selection]);
  useEffect(() => {
    if (container.width > 0 && container.height > 0) controllerRef.current?.setViewport({ ...container, ...viewport });
  }, [container, viewport]);
  useEffect(() => {
    if (!editRequest) return;
    controllerRef.current?.requestEdit(editRequest);
    useEditor.getState().clearEditRequest();
  }, [editRequest]);

  // Wheel: pinch or Ctrl/Cmd+wheel zooms about the cursor; plain wheel pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const state = useViewport.getState();
      const size = { width: el.clientWidth, height: el.clientHeight };
      const lbl = labelSize(useEditor.getState().doc.orientation);
      if (event.ctrlKey || event.metaKey) {
        const current = computeViewport(size, lbl, state).zoom;
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
        state.setZoom(current * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top, container: size, label: lbl });
      } else {
        state.panBy(-event.deltaX, -event.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef]);

  const selectionBounds = useMemo(() => {
    const selected = doc.elements.filter((el) => selection.includes(el.id));
    if (!selected.length) return null;
    const boxes = selected.map(elementBounds);
    return {
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    };
  }, [doc.elements, selection]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith('image/') || isPdf(f));
      if (!files.length || !onDropFiles) return;
      const point = controllerRef.current?.clientToScene(event.clientX, event.clientY) ?? { x: 0, y: 0 };
      onDropFiles(files, point);
    },
    [onDropFiles],
  );

  const paperStyle = {
    left: viewport.offsetX,
    top: viewport.offsetY,
    width: label.width * viewport.zoom,
    height: label.height * viewport.zoom,
    borderRadius: LABEL_CORNER_RADIUS_DOTS * viewport.zoom,
  };

  return (
    <div
      ref={containerRef}
      className="desk relative min-h-0 min-w-0 flex-1 overflow-hidden"
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes('Files')) {
          event.preventDefault();
          setDragging([...event.dataTransfer.items].some((item) => item.type === 'application/pdf') ? 'pdf' : 'image');
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
      data-testid="workspace"
    >
      {/* The label stock: white thermal paper with die-cut corners. */}
      <div aria-hidden className="pointer-events-none absolute bg-paper shadow-label" style={paperStyle} />
      <div ref={hostRef} className="absolute inset-0" data-testid="label-canvas" />
      {container.width > 0 && (
        <Rulers container={canvasArea} viewport={viewport} label={label} unit={unit} selection={selectionBounds} />
      )}
      {dragging && (
        <div
          className={cn('pointer-events-none absolute z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-cobalt bg-cobalt/5')}
          style={paperStyle}
        >
          <span className="rounded-md bg-paper px-3 py-1.5 text-sm font-medium text-cobalt shadow-pop">{dragging === 'pdf' ? 'Drop to print the shipping label' : 'Drop to add the image'}</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 z-20" style={{ paddingLeft: RULER_SIZE, paddingTop: RULER_SIZE }}>
        {children}
      </div>
    </div>
  );
}
