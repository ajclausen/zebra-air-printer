import type { DatabaseSync } from 'node:sqlite';
import type { HistoryEntry, HistoryJobState, HistorySource } from '@eco/shared';
import { transaction } from './database.js';

interface HistoryRow {
  id: string;
  name: string;
  source: HistorySource;
  state: HistoryJobState;
  design_id: string | null;
  printed_by: string | null;
  host: string | null;
  label_count: number;
  copies: number;
  job_ids: string;
  image_count: number;
  created_at: string;
}

export interface NewHistoryEntry {
  id: string;
  name: string;
  source: HistorySource;
  state: HistoryJobState;
  designId: string | null;
  printedBy: string | null;
  host: string | null;
  labelCount: number;
  copies: number;
  imageCount: number;
  createdAt: Date;
}

/** A row of history_jobs: one LPrint job and the entry it belongs to (null = deleted entry). */
export interface HistoryJob {
  rowid: number;
  jobId: number;
  jobCreated: string;
  historyId: string | null;
  state: HistoryJobState;
  seen: boolean;
  lastSeenAt: string | null;
  /** created_at of the owning entry, when there is one. */
  entryCreatedAt: string | null;
  entrySource: HistorySource | null;
}

export const FINAL_JOB_STATES: ReadonlySet<HistoryJobState> = new Set(['completed', 'canceled', 'aborted']);

// Worst first: an entry shows the worst state among its jobs.
const STATE_RANK: Record<HistoryJobState, number> = {
  aborted: 5,
  canceled: 4,
  processing: 3,
  pending: 2,
  unknown: 1,
  completed: 0,
};

export function worstState(states: HistoryJobState[]): HistoryJobState {
  if (states.length === 0) return 'unknown';
  return states.reduce((worst, s) => (STATE_RANK[s] > STATE_RANK[worst] ? s : worst));
}

export function previewUrl(historyId: string): string {
  return `/api/history/${historyId}/images/0.png`;
}

function toEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    state: row.state,
    designId: row.design_id,
    printedBy: row.printed_by,
    host: row.host,
    labelCount: row.label_count,
    copies: row.copies,
    jobIds: JSON.parse(row.job_ids) as number[],
    imageCount: row.image_count,
    previewUrl: row.image_count > 0 ? previewUrl(row.id) : null,
    createdAt: row.created_at,
  };
}

const JOB_COLUMNS = `hj.rowid AS rowid, hj.job_id AS job_id, hj.job_created AS job_created,
  hj.history_id AS history_id, hj.state AS state, hj.seen AS seen, hj.last_seen_at AS last_seen_at,
  h.created_at AS entry_created_at, h.source AS entry_source`;

interface JobRow {
  rowid: number;
  job_id: number;
  job_created: string;
  history_id: string | null;
  state: HistoryJobState;
  seen: number;
  last_seen_at: string | null;
  entry_created_at: string | null;
  entry_source: HistorySource | null;
}

function toJob(row: JobRow): HistoryJob {
  return {
    rowid: Number(row.rowid),
    jobId: row.job_id,
    jobCreated: row.job_created,
    historyId: row.history_id,
    state: row.state,
    seen: row.seen === 1,
    lastSeenAt: row.last_seen_at,
    entryCreatedAt: row.entry_created_at,
    entrySource: row.entry_source,
  };
}

export class HistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(entry: NewHistoryEntry): HistoryEntry {
    this.db
      .prepare(
        `INSERT INTO history (id, name, source, state, design_id, printed_by, host, label_count, copies,
           job_ids, image_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(
        entry.id,
        entry.name,
        entry.source,
        entry.state,
        entry.designId,
        entry.printedBy,
        entry.host,
        entry.labelCount,
        entry.copies,
        entry.imageCount,
        entry.createdAt.toISOString(),
      );
    return this.get(entry.id)!;
  }

  /** Records a job the studio just submitted (not yet matched against LPrint's job list). */
  addSubmittedJob(historyId: string, jobId: number): void {
    transaction(this.db, () => {
      this.db
        .prepare("INSERT INTO history_jobs (job_id, history_id, state, seen) VALUES (?, ?, 'pending', 0)")
        .run(jobId, historyId);
      this.db
        .prepare('UPDATE history SET job_ids = json_insert(job_ids, \'$[#]\', ?) WHERE id = ?')
        .run(jobId, historyId);
    });
  }

  /** Records an AirPrint job found in LPrint's job list, as a new entry. */
  insertIngested(entry: NewHistoryEntry, jobId: number, jobCreated: string, at: Date): HistoryEntry {
    return transaction(this.db, () => {
      this.insert(entry);
      this.db
        .prepare(
          `INSERT INTO history_jobs (job_id, job_created, history_id, state, seen, last_seen_at)
           VALUES (?, ?, ?, ?, 1, ?)`,
        )
        .run(jobId, jobCreated, entry.id, entry.state, at.toISOString());
      this.db.prepare('UPDATE history SET job_ids = json_array(?) WHERE id = ?').run(jobId, entry.id);
      return this.get(entry.id)!;
    });
  }

  get(id: string): HistoryEntry | null {
    const row = this.db.prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** Newest first. `before` is an exclusive upper bound on createdAt. */
  list(limit: number, before?: Date, source?: HistorySource): HistoryEntry[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (before) {
      where.push('created_at < ?');
      params.push(before.toISOString());
    }
    if (source) {
      where.push('source = ?');
      params.push(source);
    }
    const sql = `SELECT * FROM history ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id LIMIT ?`;
    return (this.db.prepare(sql).all(...params, limit) as unknown as HistoryRow[]).map(toEntry);
  }

  setImageCount(id: string, count: number): void {
    this.db.prepare('UPDATE history SET image_count = ? WHERE id = ?').run(count, id);
  }

  setLabelCount(id: string, count: number): void {
    this.db.prepare('UPDATE history SET label_count = ? WHERE id = ?').run(count, id);
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

  // --- LPrint job tracking --------------------------------------------------

  /** All rows for an LPrint job id, newest first. */
  jobsById(jobId: number): HistoryJob[] {
    const rows = this.db
      .prepare(
        `SELECT ${JOB_COLUMNS} FROM history_jobs hj LEFT JOIN history h ON h.id = hj.history_id
         WHERE hj.job_id = ? ORDER BY hj.rowid DESC`,
      )
      .all(jobId) as unknown as JobRow[];
    return rows.map(toJob);
  }

  jobsForEntry(historyId: string): HistoryJob[] {
    const rows = this.db
      .prepare(
        `SELECT ${JOB_COLUMNS} FROM history_jobs hj LEFT JOIN history h ON h.id = hj.history_id
         WHERE hj.history_id = ? ORDER BY hj.rowid`,
      )
      .all(historyId) as unknown as JobRow[];
    return rows.map(toJob);
  }

  /** Records a sighting of the job in LPrint's list (and the creation time on first match). */
  markSeen(rowid: number, jobCreated: string, state: HistoryJobState, at: Date): void {
    this.db
      .prepare('UPDATE history_jobs SET job_created = ?, state = ?, seen = 1, last_seen_at = ? WHERE rowid = ?')
      .run(jobCreated, state, at.toISOString(), rowid);
  }

  /** Sets the entry's state to the worst state among its jobs. Returns the new state. */
  refreshState(historyId: string): HistoryJobState {
    const states = this.jobsForEntry(historyId).map((j) => j.state);
    const state = worstState(states);
    this.db.prepare('UPDATE history SET state = ? WHERE id = ?').run(state, historyId);
    return state;
  }

  /** LPrint job ids that have any row (including tombstones of deleted entries). */
  knownJobIds(): Set<number> {
    const rows = this.db.prepare('SELECT DISTINCT job_id FROM history_jobs').all() as Array<{ job_id: number }>;
    return new Set(rows.map((r) => r.job_id));
  }

  /** Drops tombstones (rows of deleted entries) not seen in LPrint's list since `before`. */
  pruneTombstones(before: Date): number {
    return Number(
      this.db
        .prepare('DELETE FROM history_jobs WHERE history_id IS NULL AND (last_seen_at IS NULL OR last_seen_at < ?)')
        .run(before.toISOString()).changes,
    );
  }
}
