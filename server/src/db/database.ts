// SQLite storage (node:sqlite). Schema changes are append-only migrations versioned
// with PRAGMA user_version.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Each entry upgrades the schema from version i to i + 1. Never edit a shipped migration. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE designs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('design', 'template')),
    category TEXT,
    orientation TEXT NOT NULL CHECK (orientation IN ('portrait', 'landscape')),
    thumbnail TEXT,
    variables TEXT NOT NULL DEFAULT '[]',
    document TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_printed_at TEXT,
    print_count INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
  );
  CREATE INDEX designs_updated_at ON designs (updated_at DESC);

  CREATE TABLE history (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    design_id TEXT,
    printed_by TEXT,
    label_count INTEGER NOT NULL,
    copies INTEGER NOT NULL,
    job_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX history_created_at ON history (created_at DESC);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_expires_at ON sessions (expires_at);
  `,

  // 2: history covers every LPrint job (studio, import, AirPrint), with job state and
  // stored-image counts. history_jobs maps LPrint jobs to entries for ingestion.
  `
  ALTER TABLE history ADD COLUMN source TEXT NOT NULL DEFAULT 'studio'
    CHECK (source IN ('studio', 'import', 'airprint'));
  ALTER TABLE history ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown';
  ALTER TABLE history ADD COLUMN host TEXT;
  ALTER TABLE history ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
  -- Studio prints always stored one image per label.
  UPDATE history SET image_count = label_count;
  CREATE INDEX history_source_created_at ON history (source, created_at DESC);

  -- One row per LPrint job. job_created is LPrint's creation time ('' = not known yet);
  -- seen = 1 once the ingestion poller has matched the row to a job in LPrint's list.
  -- history_id becomes NULL when the entry is deleted, leaving a tombstone so the
  -- job is not ingested again while LPrint still lists it.
  CREATE TABLE history_jobs (
    job_id INTEGER NOT NULL,
    job_created TEXT NOT NULL DEFAULT '',
    history_id TEXT REFERENCES history (id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'unknown',
    seen INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT
  );
  -- Dedupes ingestion: an LPrint job (id + creation time) maps to at most one entry.
  -- Keyed on creation time too, because LPrint can reuse job ids.
  CREATE UNIQUE INDEX history_jobs_job ON history_jobs (job_id, job_created) WHERE seen = 1;
  CREATE INDEX history_jobs_job_id ON history_jobs (job_id);
  CREATE INDEX history_jobs_history_id ON history_jobs (history_id);

  INSERT INTO history_jobs (job_id, history_id, state)
    SELECT CAST(j.value AS INTEGER), h.id, 'unknown' FROM history h, json_each(h.job_ids) j;
  `,
];

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): void {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(
      `Database schema version ${current} is newer than this build supports (${migrations.length}); refusing to start`,
    );
  }
  for (let version = current; version < migrations.length; version++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Opens (creating if needed) the studio database in WAL mode and applies migrations. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** Runs fn inside a transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
