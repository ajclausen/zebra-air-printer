import { describe, expect, it } from 'vitest';
import { emptyDocument, shapeElement } from './elements';
import { align, changeOrientation, distribute, duplicateElements, expandToGroups, group, nudge, reorder, ungroup } from './operations';
import type { LabelDocument } from './types';

function docWith(...specs: Array<{ id: string; x?: number; y?: number; width?: number; height?: number; groupId?: string; locked?: boolean }>): LabelDocument {
  return { ...emptyDocument('portrait'), elements: specs.map((s) => shapeElement({ width: 100, height: 50, x: 0, y: 0, ...s })) };
}

const ids = (doc: LabelDocument) => doc.elements.map((el) => el.id);

describe('reorder', () => {
  const doc = docWith({ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' });

  it('brings to front and sends to back, keeping relative order', () => {
    expect(ids(reorder(doc, ['a', 'c'], 'front'))).toEqual(['b', 'd', 'a', 'c']);
    expect(ids(reorder(doc, ['b', 'd'], 'back'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('steps forward and backward by one', () => {
    expect(ids(reorder(doc, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(reorder(doc, ['d'], 'forward'))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(reorder(doc, ['c', 'd'], 'backward'))).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('align', () => {
  it('aligns a single element to the label', () => {
    const doc = docWith({ id: 'a', x: 10, y: 10 });
    expect(align(doc, ['a'], 'center').elements[0]).toMatchObject({ x: 356 }); // (812 - 100) / 2
    expect(align(doc, ['a'], 'bottom').elements[0]).toMatchObject({ y: 1168 });
  });

  it('aligns several elements to their shared bounds, skipping locked ones', () => {
    const doc = docWith({ id: 'a', x: 10 }, { id: 'b', x: 200 }, { id: 'c', x: 500, locked: true });
    const out = align(doc, ['a', 'b', 'c'], 'right');
    expect(out.elements.map((el) => el.x)).toEqual([200, 200, 500]);
  });

  it('moves a group as one unit', () => {
    const doc = docWith({ id: 'a', x: 0, groupId: 'g' }, { id: 'b', x: 150, groupId: 'g' });
    const out = align(doc, ['a', 'b'], 'right');
    expect(out.elements.map((el) => el.x)).toEqual([562, 712]);
  });
});

describe('distribute', () => {
  it('spaces three or more elements evenly', () => {
    const doc = docWith({ id: 'a', x: 0 }, { id: 'b', x: 120 }, { id: 'c', x: 600 });
    expect(distribute(doc, ['a', 'b', 'c'], 'horizontal').elements.map((el) => el.x)).toEqual([0, 300, 600]);
  });

  it('does nothing for fewer than three', () => {
    const doc = docWith({ id: 'a', x: 0 }, { id: 'b', x: 120 });
    expect(distribute(doc, ['a', 'b'], 'horizontal')).toEqual(doc);
  });
});

describe('grouping', () => {
  it('groups, expands selection to the group, and ungroups', () => {
    const doc = group(docWith({ id: 'a' }, { id: 'b' }, { id: 'c' }), ['a', 'b']);
    expect(doc.elements[0]!.groupId).toBeTruthy();
    expect(doc.elements[0]!.groupId).toBe(doc.elements[1]!.groupId);
    expect(expandToGroups(doc, ['a'])).toEqual(['a', 'b']);
    expect(expandToGroups(doc, ['c'])).toEqual(['c']);
    const ungrouped = ungroup(doc, ['a', 'b']);
    expect(ungrouped.elements.every((el) => !el.groupId)).toBe(true);
  });
});

describe('nudge and duplicate', () => {
  it('nudges unlocked elements only', () => {
    const doc = docWith({ id: 'a', x: 5, y: 5 }, { id: 'b', x: 5, y: 5, locked: true });
    expect(nudge(doc, ['a', 'b'], 10, -1).elements.map((el) => [el.x, el.y])).toEqual([
      [15, 4],
      [5, 5],
    ]);
  });

  it('duplicates with new ids, an offset, and a fresh shared group id', () => {
    const doc = docWith({ id: 'a', x: 0, groupId: 'g' }, { id: 'b', x: 50, groupId: 'g' });
    const result = duplicateElements(doc, ['a', 'b']);
    expect(result.doc.elements).toHaveLength(4);
    const [c, d] = result.doc.elements.slice(2);
    expect(result.ids).toEqual([c!.id, d!.id]);
    expect(c!.id).not.toBe('a');
    expect(c!.x).toBe(24);
    expect(c!.groupId).toBe(d!.groupId);
    expect(c!.groupId).not.toBe('g');
  });
});

describe('changeOrientation', () => {
  it('keeps content centered when switching orientation', () => {
    const doc = docWith({ id: 'a', x: 356, y: 584 }); // centered in portrait
    const landscape = changeOrientation(doc, 'landscape');
    expect(landscape.orientation).toBe('landscape');
    expect(landscape.elements[0]).toMatchObject({ x: 559, y: 381 }); // centered in 1218 x 812
    expect(changeOrientation(landscape, 'portrait').elements[0]).toMatchObject({ x: 356, y: 584 });
  });
});
