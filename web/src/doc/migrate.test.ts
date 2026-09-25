import { describe, expect, it } from 'vitest';
import { documentFields, emptyDocument, textElement } from './elements';
import { DocumentFormatError, migrateDocument } from './migrate';
import { DOCUMENT_FORMAT_VERSION } from './types';

describe('migrateDocument', () => {
  it('upgrades a pre-release document without formatVersion', () => {
    const doc = migrateDocument({ orientation: 'landscape', elements: [{ type: 'text', id: 't1', text: 'Hi' }] });
    expect(doc.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
    expect(doc.orientation).toBe('landscape');
    expect(doc.elements).toHaveLength(1);
    expect(doc.elements[0]).toMatchObject({ id: 't1', type: 'text', text: 'Hi', font: 'sans', fontSize: 48, autoFit: false });
  });

  it('round-trips a current document unchanged', () => {
    const original = { ...emptyDocument('portrait'), elements: [textElement({ text: '{{Name}}', font: 'condensed', fontWeight: 700 })] };
    expect(migrateDocument(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('drops unknown element types and images without a data URL', () => {
    const doc = migrateDocument({
      formatVersion: 1,
      orientation: 'portrait',
      elements: [{ type: 'hologram' }, { type: 'image', src: 'https://example.com/x.png' }, { type: 'line', width: 100 }, 'junk'],
    });
    expect(doc.elements.map((e) => e.type)).toEqual(['line']);
  });

  it('clamps and repairs invalid values', () => {
    const doc = migrateDocument({
      formatVersion: 1,
      orientation: 'sideways',
      elements: [
        { type: 'text', font: 'comic-sans', fontSize: -5, align: 'justify', width: 0 },
        { type: 'barcode', symbology: 'qrcode', angle: 95, moduleSize: 2.6 },
        { type: 'shape', fill: 'red', strokeWidth: 'thick' },
      ],
    });
    expect(doc.orientation).toBe('portrait');
    expect(doc.elements[0]).toMatchObject({ font: 'sans', fontSize: 4, align: 'left', width: 1 });
    expect(doc.elements[1]).toMatchObject({ symbology: 'qrcode', angle: 90, moduleSize: 3 });
    expect(doc.elements[2]).toMatchObject({ fill: 'none', strokeWidth: 6 });
  });

  it('keeps valid field metadata and drops invalid entries', () => {
    const doc = migrateDocument({
      formatVersion: 1,
      elements: [{ type: 'text', text: '{{Plate}} {{Expires}}' }],
      fields: [{ key: 'Plate', label: 'License plate', defaultValue: 'ABC 123' }, { key: '' }, { label: 'no key' }],
    });
    expect(doc.fields).toEqual([{ key: 'Plate', label: 'License plate', defaultValue: 'ABC 123' }]);
    expect(documentFields(doc)).toEqual([
      { key: 'Plate', label: 'License plate', defaultValue: 'ABC 123' },
      { key: 'Expires', label: 'Expires' },
    ]);
  });

  it('rejects non-documents and documents from the future', () => {
    expect(() => migrateDocument(null)).toThrow(DocumentFormatError);
    expect(() => migrateDocument([1, 2])).toThrow(DocumentFormatError);
    expect(() => migrateDocument({ formatVersion: DOCUMENT_FORMAT_VERSION + 1 })).toThrow(/newer version/);
  });
});
