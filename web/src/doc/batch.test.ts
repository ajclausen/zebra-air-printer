import { describe, expect, it } from 'vitest';
import {
  autoMapColumns,
  BatchError,
  COUNTER_KEY,
  expandCsv,
  expandSequence,
  expandSequenceInstances,
  parseCsv,
  sequenceLength,
} from './batch';

const seq = { start: 1, end: 5, step: 1, pad: 0, prefix: '', suffix: '' };

describe('expandSequence', () => {
  it('counts up inclusively', () => {
    expect(expandSequence(seq)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('applies step, padding, prefix and suffix', () => {
    expect(expandSequence({ start: 8, end: 14, step: 3, pad: 4, prefix: 'BIN-', suffix: '/A' })).toEqual([
      'BIN-0008/A',
      'BIN-0011/A',
      'BIN-0014/A',
    ]);
  });

  it('counts down when end is below start', () => {
    expect(expandSequence({ ...seq, start: 3, end: 1 })).toEqual(['3', '2', '1']);
  });

  it('stops before overshooting the end', () => {
    expect(expandSequence({ ...seq, start: 1, end: 6, step: 2 })).toEqual(['1', '3', '5']);
  });

  it('pads negative numbers after the sign', () => {
    expect(expandSequence({ ...seq, start: -2, end: -1, pad: 3 })).toEqual(['-002', '-001']);
  });

  it('rejects invalid steps and oversize runs', () => {
    expect(() => expandSequence({ ...seq, step: 0 })).toThrow(BatchError);
    expect(() => expandSequence({ ...seq, step: 1.5 })).toThrow(BatchError);
    expect(() => expandSequence({ ...seq, end: 201 })).toThrow(/up to 200/);
    expect(expandSequence({ ...seq, end: 200 })).toHaveLength(200);
  });

  it('reports length without expanding', () => {
    expect(sequenceLength({ ...seq, end: 1000 })).toBe(1000);
    expect(sequenceLength({ ...seq, step: -1 })).toBe(0);
  });

  it('builds instances that share field values', () => {
    const instances = expandSequenceInstances({ ...seq, end: 2 }, { Room: '4B' });
    expect(instances).toEqual([
      { values: { Room: '4B' }, counter: '1' },
      { values: { Room: '4B' }, counter: '2' },
    ]);
    expect(instances[0]!.values).not.toBe(instances[1]!.values);
  });
});

describe('CSV', () => {
  const csv = '﻿Name, Company ,Asset #\nAda,ECO,A-1\n\n"Grace, Admiral",Navy,A-2\nLinus,ECO\n';

  it('parses headers and rows, trimming, skipping blanks, padding ragged rows, handling quotes and BOM', () => {
    expect(parseCsv(csv)).toEqual({
      headers: ['Name', 'Company', 'Asset #'],
      rows: [
        ['Ada', 'ECO', 'A-1'],
        ['Grace, Admiral', 'Navy', 'A-2'],
        ['Linus', 'ECO', ''],
      ],
    });
  });

  it('rejects empty files and header-only files', () => {
    expect(() => parseCsv('')).toThrow(BatchError);
    expect(() => parseCsv('Name,Company\n')).toThrow(/no values/);
  });

  it('auto-maps columns by normalized name', () => {
    expect(autoMapColumns(['name', 'Asset', 'Asset#', 'Plate'], ['Name', 'Company', 'Asset #'])).toEqual({
      name: 'Name',
      Asset: 'Asset #',
      'Asset#': 'Asset #',
      Plate: null,
    });
  });

  it('expands rows into instances, with defaults for unmapped fields and an optional counter column', () => {
    const table = parseCsv(csv);
    const instances = expandCsv(table, { Name: 'Name', Tag: 'Asset #', Site: null, [COUNTER_KEY]: 'Company' }, { Site: 'HQ' });
    expect(instances).toEqual([
      { values: { Site: 'HQ', Name: 'Ada', Tag: 'A-1' }, counter: 'ECO' },
      { values: { Site: 'HQ', Name: 'Grace, Admiral', Tag: 'A-2' }, counter: 'Navy' },
      { values: { Site: 'HQ', Name: 'Linus', Tag: '' }, counter: 'ECO' },
    ]);
  });

  it('numbers rows as the counter when no counter column is mapped', () => {
    const instances = expandCsv(parseCsv('A\nx\ny'), { A: 'A' });
    expect(instances.map((i) => i.counter)).toEqual(['1', '2']);
  });

  it('refuses more than 200 rows', () => {
    const big = ['A', ...Array.from({ length: 201 }, (_, i) => String(i))].join('\n');
    expect(() => expandCsv(parseCsv(big), { A: 'A' })).toThrow(/up to 200/);
  });
});
