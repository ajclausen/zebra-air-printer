import type { DatabaseSync } from 'node:sqlite';
import type { HistoryEntry } from '@eco/shared';

interface HistoryRow {
  id: string;
  name: string;
  design_id: string | null;
  printed_by: string | null;
  label_count: number;
  copies: number;
  job_ids: string;
  created_at: string;
}

export interface NewHistoryEntry {
  id: string;
  name: string;
  designId: string | null;
  printedBy: string | null;
  labelCount: number;
  copies: number;
  createdAt: Date;
}

export function previewUrl(historyId: string): string {
  return `/api/history/${historyId}/images/0.png`;
}

function toEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    name: row.name,
    designId: row.design_id,
    printedBy: row.printed_by,
    labelCount: row.label_count,
    copies: row.copies,
    jobIds: JSON.parse(row.job_ids) as number[],
    previewUrl: previewUrl(row.id),
    createdAt: row.created_at,
  };
}

export class HistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(entry: NewHistoryEntry): HistoryEntry {
    this.db
      .prepare(
        `INSERT INTO history (id, name, design_id, printed_by, label_count, copies, job_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?)`,
      )
      .run(
        entry.id,
        entry.name,
        entry.designId,
        entry.printedBy,
        entry.labelCount,
        entry.copies,
        entry.createdAt.toISOString(),
      );
    return this.get(entry.id)!;
  }

  setJobIds(id: string, jobIds: number[]): void {
    this.db.prepare('UPDATE history SET job_ids = ? WHERE id = ?').run(JSON.stringify(jobIds), id);
  }

  get(id: string): HistoryEntry | null {
    const row = this.db.prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** Newest first. `before` is an exclusive upper bound on createdAt. */
  list(limit: number, before?: Date): HistoryEntry[] {
    const rows = before
      ? this.db
          .prepare('SELECT * FROM history WHERE created_at < ? ORDER BY created_at DESC, id LIMIT ?')
          .all(before.toISOString(), limit)
      : this.db.prepare('SELECT * FROM history ORDER BY created_at DESC, id LIMIT ?').all(limit);
    return (rows as unknown as HistoryRow[]).map(toEntry);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM history WHERE id = ?').run(id).changes > 0;
  }

  /** Deletes entries created before `cutoff`; returns their ids so image directories can be removed. */
  deleteOlderThan(cutoff: Date): string[] {
    const rows = this.db
      .prepare('DELETE FROM history WHERE created_at < ? RETURNING id')
      .all(cutoff.toISOString()) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  allIds(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM history').all() as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }
}
