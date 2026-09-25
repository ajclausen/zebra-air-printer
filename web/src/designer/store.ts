import type { DesignKind, DesignVariable, Orientation } from '@eco/shared';
import { create } from 'zustand';
import { cloneWithNewIds, emptyDocument } from '@/doc/elements';
import type { Unit } from '@/doc/geometry';
import { migrateDocument } from '@/doc/migrate';
import * as ops from '@/doc/operations';
import type { LabelDocument, LabelElement } from '@/doc/types';

/** Identity of the open design in the shared library (null id = never saved). */
export interface DesignMeta {
  designId: string | null;
  name: string;
  kind: DesignKind;
  category: string | null;
}

export const UNTITLED = 'Untitled label';

const HISTORY_LIMIT = 100;
/** Edits with the same coalesce key within this window become one undo step. */
const COALESCE_MS = 900;

interface EditorState {
  doc: LabelDocument;
  selection: string[];
  past: LabelDocument[];
  future: LabelDocument[];
  meta: DesignMeta;
  /** The document as last saved to the library, for the unsaved-changes indicator. */
  savedDoc: LabelDocument | null;
  /** False until the user picks a template or starts a blank label. */
  started: boolean;
  unit: Unit;
  clipboard: LabelElement[];
  /** Id of a text element that should enter inline editing once it exists on the canvas. */
  editRequest: string | null;
  lastCommit: { key: string; at: number } | null;
}

interface EditorActions {
  /** Apply an edit as one undoable step. */
  commit: (recipe: (doc: LabelDocument) => LabelDocument, options?: { select?: string[]; coalesce?: string }) => void;
  load: (doc: LabelDocument, meta: DesignMeta, options?: { saved?: boolean }) => void;
  startBlank: (orientation?: Orientation) => void;
  setSelection: (ids: string[]) => void;
  update: (id: string, patch: Partial<LabelElement>, coalesce?: string) => void;
  updateMany: (patches: Record<string, Partial<LabelElement>>, coalesce?: string) => void;
  add: (elements: LabelElement[], options?: { edit?: boolean }) => void;
  remove: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  copy: (ids: string[]) => void;
  cut: (ids: string[]) => void;
  paste: () => void;
  reorder: (ids: string[], move: ops.OrderMove) => void;
  align: (ids: string[], alignment: ops.Alignment) => void;
  distribute: (ids: string[], axis: 'horizontal' | 'vertical') => void;
  group: (ids: string[]) => void;
  ungroup: (ids: string[]) => void;
  setLocked: (ids: string[], locked: boolean) => void;
  nudge: (ids: string[], dx: number, dy: number) => void;
  setOrientation: (orientation: Orientation) => void;
  setField: (field: DesignVariable) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Write values the canvas derives from layout (barcode size, grown text
   * height) without creating an undo step or marking the design unsaved.
   */
  syncDerived: (patches: Record<string, Partial<LabelElement>>) => void;
  setMeta: (meta: Partial<DesignMeta>) => void;
  markSaved: (meta: Partial<DesignMeta>) => void;
  setUnit: (unit: Unit) => void;
  clearEditRequest: () => void;
}

export type EditorStore = EditorState & EditorActions;

const initialMeta: DesignMeta = { designId: null, name: UNTITLED, kind: 'design', category: null };

function keepSelection(doc: LabelDocument, selection: string[]): string[] {
  const ids = new Set(doc.elements.map((el) => el.id));
  return selection.filter((id) => ids.has(id));
}

export const useEditor = create<EditorStore>()((set, get) => ({
  doc: emptyDocument(),
  selection: [],
  past: [],
  future: [],
  meta: initialMeta,
  savedDoc: null,
  started: false,
  unit: 'in',
  clipboard: [],
  editRequest: null,
  lastCommit: null,

  commit: (recipe, options = {}) => {
    const state = get();
    const next = recipe(state.doc);
    if (next === state.doc && !options.select) return;
    const now = Date.now();
    const coalescing =
      options.coalesce !== undefined && state.lastCommit?.key === options.coalesce && now - state.lastCommit.at < COALESCE_MS;
    const past = next === state.doc || coalescing ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT);
    set({
      doc: next,
      past,
      future: next === state.doc ? state.future : [],
      selection: keepSelection(next, options.select ?? state.selection),
      started: true,
      lastCommit: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
    });
  },

  load: (doc, meta, options = {}) =>
    set({
      doc,
      meta,
      selection: [],
      past: [],
      future: [],
      started: true,
      savedDoc: options.saved ? doc : null,
      lastCommit: null,
      editRequest: null,
    }),

  startBlank: (orientation = get().doc.orientation) =>
    set({ doc: emptyDocument(orientation), meta: initialMeta, selection: [], past: [], future: [], started: true, savedDoc: null }),

  setSelection: (ids) => {
    const current = get().selection;
    if (current.length === ids.length && current.every((id, i) => id === ids[i])) return;
    set({ selection: ids });
  },

  update: (id, patch, coalesce) => get().commit((doc) => ops.patchElements(doc, { [id]: patch }), { coalesce }),
  updateMany: (patches, coalesce) => get().commit((doc) => ops.patchElements(doc, patches), { coalesce }),

  add: (elements, options = {}) => {
    get().commit((doc) => ops.addElements(doc, elements), { select: elements.map((el) => el.id) });
    if (options.edit && elements[0]?.type === 'text') set({ editRequest: elements[0].id });
  },

  remove: (ids) => {
    const removable = get().doc.elements.filter((el) => ids.includes(el.id) && !el.locked).map((el) => el.id);
    if (removable.length) get().commit((doc) => ops.removeElements(doc, removable), { select: [] });
  },

  duplicate: (ids) => {
    if (!ids.length) return;
    let newIds: string[] = [];
    get().commit((doc) => {
      const result = ops.duplicateElements(doc, ids);
      newIds = result.ids;
      return result.doc;
    });
    set({ selection: newIds });
  },

  copy: (ids) => {
    const elements = get().doc.elements.filter((el) => ids.includes(el.id));
    if (elements.length) set({ clipboard: structuredClone(elements) });
  },

  cut: (ids) => {
    get().copy(ids);
    get().remove(ids);
  },

  paste: () => {
    const { clipboard } = get();
    if (!clipboard.length) return;
    const copies = cloneWithNewIds(clipboard).map((el) => ({ ...el, x: el.x + 24, y: el.y + 24, locked: false }));
    // Successive pastes cascade instead of stacking exactly.
    set({ clipboard: copies });
    get().commit((doc) => ops.addElements(doc, copies), { select: copies.map((el) => el.id) });
  },

  reorder: (ids, move) => get().commit((doc) => ops.reorder(doc, ids, move)),
  align: (ids, alignment) => get().commit((doc) => ops.align(doc, ids, alignment)),
  distribute: (ids, axis) => get().commit((doc) => ops.distribute(doc, ids, axis)),
  group: (ids) => get().commit((doc) => ops.group(doc, ids)),
  ungroup: (ids) => get().commit((doc) => ops.ungroup(doc, ids)),
  setLocked: (ids, locked) => get().commit((doc) => ops.patchElements(doc, Object.fromEntries(ids.map((id) => [id, { locked }])))),
  nudge: (ids, dx, dy) => get().commit((doc) => ops.nudge(doc, ids, dx, dy), { coalesce: `nudge:${ids.join(',')}` }),
  setOrientation: (orientation) => get().commit((doc) => ops.changeOrientation(doc, orientation)),

  setField: (field) =>
    get().commit(
      (doc) => ({ ...doc, fields: [...doc.fields.filter((f) => f.key !== field.key), field] }),
      { coalesce: `field:${field.key}` },
    ),

  undo: () => {
    const { past, doc, future, selection } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future], selection: keepSelection(previous, selection), lastCommit: null });
  },

  redo: () => {
    const { past, doc, future, selection } = get();
    const next = future[0];
    if (!next) return;
    set({ doc: next, past: [...past, doc], future: future.slice(1), selection: keepSelection(next, selection), lastCommit: null });
  },

  syncDerived: (patches) => {
    const { doc, savedDoc, past } = get();
    const next = ops.patchElements(doc, patches);
    if (next === doc) return;
    // Apply the same derived values to the undo stack's top so undo does not "undo" layout.
    const top = past[past.length - 1];
    const patchedPast = top ? [...past.slice(0, -1), ops.patchElements(top, patches)] : past;
    set({ doc: next, past: patchedPast, savedDoc: savedDoc === doc ? next : savedDoc });
  },

  setMeta: (meta) => set({ meta: { ...get().meta, ...meta } }),
  markSaved: (meta) => set({ meta: { ...get().meta, ...meta }, savedDoc: get().doc }),
  setUnit: (unit) => set({ unit }),
  clearEditRequest: () => set({ editRequest: null }),
}));

export const selectSelectedElements = (state: EditorStore): LabelElement[] =>
  state.doc.elements.filter((el) => state.selection.includes(el.id));

export const selectIsDirty = (state: EditorStore): boolean => state.savedDoc !== state.doc && state.doc.elements.length > 0;

// ---------------------------------------------------------------------------
// Autosave: the working document survives reloads. Saving to the library is explicit.
// ---------------------------------------------------------------------------

const AUTOSAVE_KEY = 'eco.studio.working.v1';

interface AutosaveRecord {
  doc: LabelDocument;
  meta: DesignMeta;
  saved: boolean;
  started: boolean;
  unit: Unit;
}

export function restoreAutosave(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const record = JSON.parse(raw) as Partial<AutosaveRecord>;
    const doc = migrateDocument(record.doc);
    const meta = { ...initialMeta, ...record.meta };
    useEditor.setState({
      doc,
      meta,
      started: Boolean(record.started),
      savedDoc: record.saved ? doc : null,
      unit: record.unit === 'mm' ? 'mm' : 'in',
    });
    return true;
  } catch (error) {
    console.warn('Discarding unreadable autosave', error);
    localStorage.removeItem(AUTOSAVE_KEY);
    return false;
  }
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    const { doc, meta, savedDoc, started, unit } = useEditor.getState();
    const record: AutosaveRecord = { doc, meta, saved: savedDoc === doc, started, unit };
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(record));
    } catch (error) {
      // Quota exceeded (very large images): keep working; the library save still works.
      console.warn('Autosave failed', error);
    }
  };
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.doc === prev.doc && state.meta === prev.meta && state.started === prev.started && state.unit === prev.unit && state.savedDoc === prev.savedDoc) return;
    clearTimeout(timer);
    timer = setTimeout(write, 400);
  });
  const flush = () => {
    clearTimeout(timer);
    write();
  };
  window.addEventListener('pagehide', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    clearTimeout(timer);
  };
}
