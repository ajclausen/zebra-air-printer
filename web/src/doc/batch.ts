import Papa from 'papaparse';
import type { LabelInstance } from './types';

/** The server accepts at most this many images per print job. */
export const MAX_LABELS_PER_JOB = 200;

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchError';
  }
}

// ---------------------------------------------------------------------------
// Sequences ({{counter}})
// ---------------------------------------------------------------------------

export interface SequenceOptions {
  start: number;
  end: number;
  /** Positive step size; the direction follows start -> end. */
  step: number;
  /** Zero-pad numbers to this many digits (0 = no padding). */
  pad: number;
  prefix: string;
  suffix: string;
}

export const DEFAULT_SEQUENCE: SequenceOptions = { start: 1, end: 10, step: 1, pad: 0, prefix: '', suffix: '' };

export function sequenceLength(options: SequenceOptions): number {
  const { start, end, step } = options;
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(step) || step <= 0) return 0;
  return Math.floor(Math.abs(end - start) / step) + 1;
}

export function formatSequenceValue(n: number, options: Pick<SequenceOptions, 'pad' | 'prefix' | 'suffix'>): string {
  const digits = String(Math.abs(n)).padStart(Math.max(0, options.pad), '0');
  return `${options.prefix}${n < 0 ? '-' : ''}${digits}${options.suffix}`;
}

/** Expand a sequence into counter values. Throws BatchError on invalid input or more than 200 labels. */
export function expandSequence(options: SequenceOptions): string[] {
  const { start, end, step } = options;
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new BatchError('Start and end must be whole numbers.');
  if (!Number.isInteger(step) || step <= 0) throw new BatchError('Step must be a whole number of 1 or more.');
  const count = sequenceLength(options);
  if (count > MAX_LABELS_PER_JOB) {
    throw new BatchError(`That is ${count} labels. One print job can hold up to ${MAX_LABELS_PER_JOB}; split it into smaller runs.`);
  }
  const direction = end >= start ? 1 : -1;
  const values: string[] = [];
  for (let i = 0; i < count; i++) values.push(formatSequenceValue(start + direction * step * i, options));
  return values;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** Parse CSV text with a header row. Blank lines are skipped; ragged rows are padded. */
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const [headerRow, ...body] = result.data;
  if (!headerRow || headerRow.every((h) => !h.trim())) throw new BatchError('The CSV file is empty. Add a header row and at least one row of values.');
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = body.map((row) => headers.map((_, i) => (row[i] ?? '').trim()));
  if (rows.length === 0) throw new BatchError('The CSV file has a header row but no values below it.');
  return { headers, rows };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map each field key to the CSV column with the same name (ignoring case,
 * spaces, and punctuation). Unmatched fields map to null.
 */
export function autoMapColumns(fieldKeys: string[], headers: string[]): Record<string, string | null> {
  const byName = new Map(headers.map((h) => [normalizeName(h), h]));
  return Object.fromEntries(fieldKeys.map((key) => [key, byName.get(normalizeName(key)) ?? null]));
}

/** Special mapping target: the column drives {{counter}}. */
export const COUNTER_KEY = '__counter__';

/**
 * Turn CSV rows into label instances. `mapping` maps field keys (and optionally
 * COUNTER_KEY) to header names; unmapped fields fall back to `defaults`.
 */
export function expandCsv(table: CsvTable, mapping: Record<string, string | null>, defaults: Record<string, string> = {}): LabelInstance[] {
  if (table.rows.length > MAX_LABELS_PER_JOB) {
    throw new BatchError(`The CSV has ${table.rows.length} rows. One print job can hold up to ${MAX_LABELS_PER_JOB}; split the file.`);
  }
  const columnIndex = (header: string | null | undefined) => (header ? table.headers.indexOf(header) : -1);
  return table.rows.map((row, rowIndex) => {
    const values: Record<string, string> = { ...defaults };
    let counter = String(rowIndex + 1);
    for (const [key, header] of Object.entries(mapping)) {
      const index = columnIndex(header);
      if (index < 0) continue;
      const cell = row[index] ?? '';
      if (key === COUNTER_KEY) counter = cell;
      else values[key] = cell;
    }
    return { values, counter };
  });
}

/** One instance per sequence value, sharing the same field values. */
export function expandSequenceInstances(options: SequenceOptions, values: Record<string, string>): LabelInstance[] {
  return expandSequence(options).map((counter) => ({ values: { ...values }, counter }));
}
