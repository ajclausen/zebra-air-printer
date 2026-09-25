import type { Orientation } from '@eco/shared';
import { cloneWithNewIds, elementBounds, newId } from './elements';
import { labelSize } from './geometry';
import type { LabelDocument, LabelElement } from './types';

/**
 * Pure document edits used by the editor. Each returns a new document (or
 * element list) and never mutates its input.
 */

type Patch = Partial<LabelElement>;

export function patchElements(doc: LabelDocument, patches: Record<string, Patch>): LabelDocument {
  let changed = false;
  const elements = doc.elements.map((el) => {
    const patch = patches[el.id];
    if (!patch) return el;
    changed = true;
    return { ...el, ...patch } as LabelElement;
  });
  return changed ? { ...doc, elements } : doc;
}

export function removeElements(doc: LabelDocument, ids: readonly string[]): LabelDocument {
  const drop = new Set(ids);
  return { ...doc, elements: doc.elements.filter((el) => !drop.has(el.id)) };
}

export function addElements(doc: LabelDocument, elements: LabelElement[]): LabelDocument {
  return { ...doc, elements: [...doc.elements, ...elements] };
}

/** Copies placed `offset` dots down-right of the originals, above everything. */
export function duplicateElements(doc: LabelDocument, ids: readonly string[], offset = 24): { doc: LabelDocument; ids: string[] } {
  const originals = doc.elements.filter((el) => ids.includes(el.id));
  const copies = cloneWithNewIds(originals).map((el) => ({ ...el, x: el.x + offset, y: el.y + offset, locked: false }));
  return { doc: addElements(doc, copies), ids: copies.map((el) => el.id) };
}

// ---------------------------------------------------------------------------
// Layer order
// ---------------------------------------------------------------------------

export type OrderMove = 'forward' | 'backward' | 'front' | 'back';

export function reorder(doc: LabelDocument, ids: readonly string[], move: OrderMove): LabelDocument {
  const selected = new Set(ids);
  const elements = [...doc.elements];
  if (move === 'front' || move === 'back') {
    const moving = elements.filter((el) => selected.has(el.id));
    const rest = elements.filter((el) => !selected.has(el.id));
    return { ...doc, elements: move === 'front' ? [...rest, ...moving] : [...moving, ...rest] };
  }
  // Step each selected element past its nearest unselected neighbour, keeping relative order.
  if (move === 'forward') {
    for (let i = elements.length - 2; i >= 0; i--) {
      if (selected.has(elements[i]!.id) && !selected.has(elements[i + 1]!.id)) {
        [elements[i], elements[i + 1]] = [elements[i + 1]!, elements[i]!];
      }
    }
  } else {
    for (let i = 1; i < elements.length; i++) {
      if (selected.has(elements[i]!.id) && !selected.has(elements[i - 1]!.id)) {
        [elements[i], elements[i - 1]] = [elements[i - 1]!, elements[i]!];
      }
    }
  }
  return { ...doc, elements };
}

// ---------------------------------------------------------------------------
// Alignment and distribution
// ---------------------------------------------------------------------------

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function unionBounds(elements: LabelElement[]): Box {
  const boxes = elements.map(elementBounds);
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/**
 * Align elements to each other, or to the label when only one element (or one
 * group) is selected. Elements that share a group move together.
 */
export function align(doc: LabelDocument, ids: readonly string[], alignment: Alignment): LabelDocument {
  const selected = doc.elements.filter((el) => ids.includes(el.id) && !el.locked);
  if (selected.length === 0) return doc;
  const units = groupUnits(selected);
  const size = labelSize(doc.orientation);
  const target: Box = units.length === 1 ? { left: 0, top: 0, right: size.width, bottom: size.height } : unionBounds(selected);

  const patches: Record<string, Patch> = {};
  for (const unit of units) {
    const b = unionBounds(unit);
    let dx = 0;
    let dy = 0;
    if (alignment === 'left') dx = target.left - b.left;
    if (alignment === 'right') dx = target.right - b.right;
    if (alignment === 'center') dx = (target.left + target.right) / 2 - (b.left + b.right) / 2;
    if (alignment === 'top') dy = target.top - b.top;
    if (alignment === 'bottom') dy = target.bottom - b.bottom;
    if (alignment === 'middle') dy = (target.top + target.bottom) / 2 - (b.top + b.bottom) / 2;
    for (const el of unit) patches[el.id] = { x: Math.round(el.x + dx), y: Math.round(el.y + dy) };
  }
  return patchElements(doc, patches);
}

/** Space elements (or groups) evenly between the outermost two along an axis. */
export function distribute(doc: LabelDocument, ids: readonly string[], axis: 'horizontal' | 'vertical'): LabelDocument {
  const units = groupUnits(doc.elements.filter((el) => ids.includes(el.id) && !el.locked));
  if (units.length < 3) return doc;
  const withBounds = units.map((unit) => ({ unit, box: unionBounds(unit) }));
  const start = axis === 'horizontal' ? 'left' : 'top';
  const end = axis === 'horizontal' ? 'right' : 'bottom';
  withBounds.sort((a, b) => a.box[start] - b.box[start]);
  const first = withBounds[0]!.box;
  const last = withBounds[withBounds.length - 1]!.box;
  const occupied = withBounds.reduce((sum, { box }) => sum + (box[end] - box[start]), 0);
  const gap = (last[end] - first[start] - occupied) / (withBounds.length - 1);

  const patches: Record<string, Patch> = {};
  let cursor = first[start];
  for (const { unit, box } of withBounds) {
    const delta = cursor - box[start];
    for (const el of unit) {
      patches[el.id] = axis === 'horizontal' ? { x: Math.round(el.x + delta) } : { y: Math.round(el.y + delta) };
    }
    cursor += box[end] - box[start] + gap;
  }
  return patchElements(doc, patches);
}

/** Split elements into movable units: each group is one unit, ungrouped elements are their own. */
function groupUnits(elements: LabelElement[]): LabelElement[][] {
  const groups = new Map<string, LabelElement[]>();
  const units: LabelElement[][] = [];
  for (const el of elements) {
    if (!el.groupId) {
      units.push([el]);
      continue;
    }
    let unit = groups.get(el.groupId);
    if (!unit) {
      unit = [];
      groups.set(el.groupId, unit);
      units.push(unit);
    }
    unit.push(el);
  }
  return units;
}

// ---------------------------------------------------------------------------
// Grouping, locking, nudging
// ---------------------------------------------------------------------------

export function group(doc: LabelDocument, ids: readonly string[]): LabelDocument {
  if (ids.length < 2) return doc;
  const groupId = newId('grp');
  return patchElements(doc, Object.fromEntries(ids.map((id) => [id, { groupId }])));
}

export function ungroup(doc: LabelDocument, ids: readonly string[]): LabelDocument {
  return patchElements(doc, Object.fromEntries(ids.map((id) => [id, { groupId: null }])));
}

/** All ids in the same groups as `ids`, so selecting one member selects the group. */
export function expandToGroups(doc: LabelDocument, ids: readonly string[]): string[] {
  const groupIds = new Set(doc.elements.filter((el) => ids.includes(el.id) && el.groupId).map((el) => el.groupId));
  if (groupIds.size === 0) return [...ids];
  return doc.elements.filter((el) => ids.includes(el.id) || (el.groupId && groupIds.has(el.groupId))).map((el) => el.id);
}

export function nudge(doc: LabelDocument, ids: readonly string[], dx: number, dy: number): LabelDocument {
  const patches: Record<string, Patch> = {};
  for (const el of doc.elements) {
    if (ids.includes(el.id) && !el.locked) patches[el.id] = { x: el.x + dx, y: el.y + dy };
  }
  return patchElements(doc, patches);
}

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

/**
 * Switch orientation, moving the content so its center stays at the label
 * center. Element sizes are unchanged.
 */
export function changeOrientation(doc: LabelDocument, orientation: Orientation): LabelDocument {
  if (doc.orientation === orientation) return doc;
  const from = labelSize(doc.orientation);
  const to = labelSize(orientation);
  const dx = Math.round((to.width - from.width) / 2);
  const dy = Math.round((to.height - from.height) / 2);
  return { ...doc, orientation, elements: doc.elements.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy })) };
}
