import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesignRepository } from '../src/db/designs.js';
import { migrate, MIGRATIONS, openDatabase, schemaVersion } from '../src/db/database.js';
import { HistoryRepository } from '../src/db/history.js';
import { DEFAULT_SETTINGS, SettingsRepository } from '../src/db/settings.js';
import { RetentionService } from '../src/services/retention.js';
import { PrintStore } from '../src/storage/print-store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'eco-storage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;

describe('migrations', () => {
  it('creates the schema in WAL mode and records the version', () => {
    const db = openDatabase(path.join(dir, 'nested', 'studio.db'));
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string;
    }>).map((r) => r.name);
    expect(tables).toEqual(['admin', 'designs', 'history', 'history_jobs', 'sessions', 'settings']);
    db.close();
  });

  it('is idempotent across restarts and keeps data', () => {
    const file = path.join(dir, 'studio.db');
    const first = openDatabase(file);
    new SettingsRepository(first).save({ ...DEFAULT_SETTINGS, studioName: 'Warehouse' });
    first.close();
    const second = openDatabase(file);
    expect(schemaVersion(second)).toBe(MIGRATIONS.length);
    expect(new SettingsRepository(second).get().studioName).toBe('Warehouse');
    second.close();
  });

  it('applies only pending migrations, in order', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, ['CREATE TABLE a (x)']);
    expect(schemaVersion(db)).toBe(1);
    migrate(db, ['CREATE TABLE a (x)', 'ALTER TABLE a ADD COLUMN y', 'CREATE TABLE b (z)']);
    expect(schemaVersion(db)).toBe(3);
    const columns = (db.prepare('PRAGMA table_info(a)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(['x', 'y']);
  });

  it('rolls back a failing migration', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrate(db, ['CREATE TABLE ok (x)', 'CREATE TABLE bad (x); SELECT * FROM missing'])).toThrow();
    expect(schemaVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'bad'").get()).toBeUndefined();
  });

  it('upgrades a version 1 database and backfills history', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 1));
    db.prepare(
      `INSERT INTO history (id, name, design_id, printed_by, label_count, copies, job_ids, created_at)
       VALUES ('h1', 'Old print', NULL, 'Andrew', 3, 2, '[5,6,7]', '2026-09-01T00:00:00.000Z'),
              ('h2', 'Partial', NULL, NULL, 2, 1, '[]', '2026-09-02T00:00:00.000Z')`,
    ).run();

    migrate(db);
    expect(schemaVersion(db)).toBe(2);
    const entries = new HistoryRepository(db).list(10);
    expect(entries.map((e) => [e.id, e.source, e.state, e.imageCount, e.host, e.jobIds, e.previewUrl])).toEqual([
      ['h2', 'studio', 'unknown', 2, null, [], '/api/history/h2/images/0.png'],
      ['h1', 'studio', 'unknown', 3, null, [5, 6, 7], '/api/history/h1/images/0.png'],
    ]);
    const jobs = db.prepare('SELECT job_id, job_created, history_id, state, seen FROM history_jobs ORDER BY job_id').all();
    expect(jobs.map((j) => ({ ...j }))).toEqual([5, 6, 7].map((id) => ({
      job_id: id,
      job_created: '',
      history_id: 'h1',
      state: 'unknown',
      seen: 0,
    })));
  });

  it('dedupes matched LPrint jobs by id and creation time', () => {
    const db = openDatabase(':memory:');
    const history = new HistoryRepository(db);
    const entry = (id: string) => ({
      id,
      name: id,
      source: 'airprint' as const,
      state: 'completed' as const,
      designId: null,
      printedBy: null,
      host: null,
      labelCount: 1,
      copies: 1,
      imageCount: 0,
      createdAt: new Date('2026-09-25T00:00:00Z'),
    });
    history.insertIngested(entry('a'), 5, '2026-09-25T00:00:00.000Z', new Date());
    expect(() => history.insertIngested(entry('b'), 5, '2026-09-25T00:00:00.000Z', new Date())).toThrow();
    expect(history.get('b')).toBeNull(); // the transaction rolled back
    history.insertIngested(entry('c'), 5, '2026-09-26T00:00:00.000Z', new Date());
    expect(history.jobsById(5).map((j) => j.historyId)).toEqual(['c', 'a']);
  });

  it('refuses to open a database from a newer build', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this build/);
  });
});

describe('DesignRepository', () => {
  let db: DatabaseSync;
  let now: Date;
  let designs: DesignRepository;
  const input = (name: string, extra: object = {}) => ({
    name,
    kind: 'design' as const,
    orientation: 'portrait' as const,
    document: { version: 1, objects: [name] },
    ...extra,
  });

  beforeEach(() => {
    db = openDatabase(':memory:');
    now = new Date('2026-09-25T12:00:00Z');
    designs = new DesignRepository(db, () => now);
  });

  it('creates and reads designs with defaults', () => {
    const created = designs.create(input('Box'));
    expect(created).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
      name: 'Box',
      kind: 'design',
      category: null,
      orientation: 'portrait',
      thumbnail: null,
      variables: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastPrintedAt: null,
      printCount: 0,
      deletedAt: null,
      document: { version: 1, objects: ['Box'] },
    });
    expect(designs.get(created.id)).toEqual(created);
  });

  it('lists newest first with filters and search, without documents', () => {
    designs.create(input('Old shipping', { category: 'Shipping' }));
    now = new Date(now.getTime() + 1000);
    const tag = designs.create(input('Asset tag', { kind: 'template', category: 'Inventory' }));
    now = new Date(now.getTime() + 1000);
    designs.create(input('100% off_sign'));

    expect(designs.list().map((d) => d.name)).toEqual(['100% off_sign', 'Asset tag', 'Old shipping']);
    expect(designs.list({ kind: 'template' }).map((d) => d.id)).toEqual([tag.id]);
    expect(designs.list({ category: 'Shipping' }).map((d) => d.name)).toEqual(['Old shipping']);
    expect(designs.list({ q: 'TAG' }).map((d) => d.name)).toEqual(['Asset tag']);
    expect(designs.list({ q: 'invent' }).map((d) => d.name)).toEqual(['Asset tag']);
    // LIKE wildcards in the query are literal.
    expect(designs.list({ q: '%' }).map((d) => d.name)).toEqual(['100% off_sign']);
    expect(designs.list({ q: '_' }).map((d) => d.name)).toEqual(['100% off_sign']);
    expect(designs.list()[0]).not.toHaveProperty('document');
  });

  it('updates, duplicates, soft-deletes, restores, and purges', () => {
    const d = designs.create(input('Sign'));
    now = new Date(now.getTime() + 5000);
    const updated = designs.update(d.id, input('Sign v2', { category: 'Signage', variables: [{ key: 'n', label: 'N' }] }))!;
    expect(updated.name).toBe('Sign v2');
    expect(updated.updatedAt).toBe(now.toISOString());
    expect(updated.createdAt).toBe(d.createdAt);
    expect(updated.variables).toEqual([{ key: 'n', label: 'N' }]);
    expect(designs.update('missing', input('x'))).toBeNull();

    const copy = designs.duplicate(d.id)!;
    expect(copy.name).toBe('Sign v2 (copy)');
    expect(copy.id).not.toBe(d.id);
    expect(copy.document).toEqual(updated.document);

    expect(designs.softDelete(d.id)).toBe(true);
    expect(designs.get(d.id)!.deletedAt).toBe(now.toISOString());
    expect(designs.list().map((x) => x.id)).toEqual([copy.id]);
    expect(designs.list({ includeDeleted: true })).toHaveLength(2);

    expect(designs.restore(d.id)!.deletedAt).toBeNull();
    expect(designs.purge(d.id)).toBe(true);
    expect(designs.get(d.id)).toBeNull();
    expect(designs.purge(d.id)).toBe(false);
  });

  it('records prints', () => {
    const d = designs.create(input('Tag'));
    designs.recordPrint(d.id, new Date('2026-09-26T00:00:00Z'));
    designs.recordPrint(d.id, new Date('2026-09-27T00:00:00Z'));
    expect(designs.get(d.id)).toMatchObject({ printCount: 2, lastPrintedAt: '2026-09-27T00:00:00.000Z' });
  });
});

describe('SettingsRepository', () => {
  it('returns defaults, then saved values', () => {
    const settings = new SettingsRepository(openDatabase(':memory:'));
    expect(settings.get()).toEqual({ studioName: 'ECO Label Studio', historyRetentionDays: 90, defaultCopies: 1 });
    expect(settings.save({ studioName: 'Dock', historyRetentionDays: 30, defaultCopies: 2 })).toEqual({
      studioName: 'Dock',
      historyRetentionDays: 30,
      defaultCopies: 2,
    });
  });
});

describe('HistoryRepository', () => {
  it('pages newest first with an exclusive before cursor', () => {
    const history = new HistoryRepository(openDatabase(':memory:'));
    for (let i = 0; i < 5; i++) {
      history.insert({
        id: `h${i}`,
        name: `Job ${i}`,
        source: 'studio',
        state: 'pending',
        designId: null,
        printedBy: null,
        host: null,
        labelCount: 1,
        copies: 1,
        imageCount: 1,
        createdAt: new Date(Date.UTC(2026, 8, 20 + i)),
      });
    }
    expect(history.list(2).map((h) => h.id)).toEqual(['h4', 'h3']);
    expect(history.list(2, new Date(Date.UTC(2026, 8, 23))).map((h) => h.id)).toEqual(['h2', 'h1']);
    history.addSubmittedJob('h0', 5);
    history.addSubmittedJob('h0', 6);
    expect(history.get('h0')!.jobIds).toEqual([5, 6]);
  });
});

describe('RetentionService', () => {
  it('deletes history rows and image directories past the retention window', async () => {
    const db = openDatabase(':memory:');
    const history = new HistoryRepository(db);
    const settings = new SettingsRepository(db);
    const store = new PrintStore(path.join(dir, 'prints'));
    const now = new Date('2026-09-25T12:00:00Z');
    settings.save({ ...DEFAULT_SETTINGS, historyRetentionDays: 30 });

    const add = async (id: string, ageDays: number) => {
      history.insert({
        id,
        name: id,
        source: 'studio',
        state: 'pending',
        designId: null,
        printedBy: null,
        host: null,
        labelCount: 1,
        copies: 1,
        imageCount: 1,
        createdAt: new Date(now.getTime() - ageDays * DAY),
      });
      await store.write(id, [Buffer.from('png')]);
    };
    await add('old', 31);
    await add('edge', 29.9);
    await add('new', 1);

    // An orphaned directory (no history row) older than the grace period, and a fresh one.
    const orphan = path.join(dir, 'prints', 'orphan');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(path.join(orphan, '0.png'), 'x');
    const hourAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    utimesSync(orphan, hourAgo, hourAgo);
    mkdirSync(path.join(dir, 'prints', 'inflight'), { recursive: true });
    const recent = new Date(now.getTime() - 60 * 1000);
    utimesSync(path.join(dir, 'prints', 'inflight'), recent, recent);

    const result = await new RetentionService(history, settings, store, () => now).prune();
    expect(result).toEqual({ historyDeleted: 1, orphanDirsDeleted: 1 });
    expect([...history.allIds()].sort()).toEqual(['edge', 'new']);
    expect(existsSync(path.join(dir, 'prints', 'old'))).toBe(false);
    expect(existsSync(path.join(dir, 'prints', 'edge', '0.png'))).toBe(true);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(path.join(dir, 'prints', 'inflight'))).toBe(true);
  });

  it('copes with a missing prints directory', async () => {
    const db = openDatabase(':memory:');
    const service = new RetentionService(
      new HistoryRepository(db),
      new SettingsRepository(db),
      new PrintStore(path.join(dir, 'does-not-exist')),
    );
    expect(await service.prune()).toEqual({ historyDeleted: 0, orphanDirsDeleted: 0 });
  });
});
