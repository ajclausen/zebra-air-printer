// Keeps print history in step with LPrint's job list:
// - records jobs sent straight to LPrint (AirPrint/IPP) as 'airprint' entries,
// - tracks job state for every entry (worst state across its jobs),
// - turns the page bitmaps captured by the patched LPrint driver into stored PNGs,
// - cleans up capture files.

import type { HistoryJobState } from '@eco/shared';
import { FINAL_JOB_STATES, type HistoryJob, type HistoryRepository } from '../db/history.js';
import { newId } from '../ids.js';
import { pbmToLabelPng } from '../images/pbm.js';
import { STUDIO_USER_NAME, type Printer, type PrinterJob } from '../printer/printer.js';
import type { CaptureStore, CaptureFile } from '../storage/capture-store.js';
import type { PrintStore } from '../storage/print-store.js';

const HOUR_MS = 60 * 60 * 1000;
/** A studio submission matches an LPrint job created this close to the entry. */
const MATCH_WINDOW_MS = 10 * 60 * 1000;
/** Sightings are written back at most this often when nothing else changed. */
const SEEN_REFRESH_MS = HOUR_MS;
const TOMBSTONE_TTL_MS = 7 * 24 * HOUR_MS;
const MAX_NAME_LENGTH = 200;

export interface IngestLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface IngestDeps {
  printer: Printer;
  history: HistoryRepository;
  store: PrintStore;
  captures: CaptureStore;
  log: IngestLogger;
  now?: () => Date;
}

export interface IngestResult {
  /** False when the printer's job list was unavailable. */
  listed: boolean;
  added: number;
  updated: number;
  imagesStored: number;
  capturesDeleted: number;
}

export function historyState(state: PrinterJob['state']): HistoryJobState {
  switch (state) {
    case 'pending':
    case 'held':
      return 'pending';
    case 'processing':
    case 'stopped':
      return 'processing';
    case 'canceled':
    case 'aborted':
    case 'completed':
      return state;
    default:
      return 'unknown';
  }
}

/** Labels printed per copy for an AirPrint job: impressions so far, at least 1 once completed. */
function airprintLabelCount(job: PrinterJob, state: HistoryJobState): number {
  const impressions = Math.max(0, job.impressionsCompleted ?? 0);
  return state === 'completed' ? Math.max(1, impressions) : impressions;
}

export class HistoryIngestService {
  private readonly now: () => Date;
  private running: Promise<IngestResult> | null = null;

  constructor(private readonly deps: IngestDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Runs one ingestion pass; concurrent callers share the pass in progress. */
  poll(): Promise<IngestResult> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<IngestResult> {
    const result: IngestResult = { listed: false, added: 0, updated: 0, imagesStored: 0, capturesDeleted: 0 };
    const jobs = await this.deps.printer.listJobs();
    // Job id -> row it matched in this pass (null: listed but not in history, e.g. a test print).
    const matched = new Map<number, HistoryJob | null>();
    if (jobs) {
      result.listed = true;
      for (const job of jobs) {
        try {
          matched.set(job.id, this.ingestJob(job, result));
        } catch (err) {
          this.deps.log.error({ err, jobId: job.id }, 'history ingestion failed for job');
        }
      }
      this.deps.history.pruneTombstones(new Date(this.now().getTime() - TOMBSTONE_TTL_MS));
    }
    await this.processCaptures(jobs, matched, result);
    if (result.added || result.updated || result.imagesStored || result.capturesDeleted) {
      this.deps.log.info({ ...result }, 'history ingestion');
    }
    return result;
  }

  /** Matches one listed job to history (or records it) and returns its row. */
  private ingestJob(job: PrinterJob, result: IngestResult): HistoryJob | null {
    const { history } = this.deps;
    const now = this.now();
    const state = historyState(job.state);
    const created = job.createdAt ?? '';
    const rows = history.jobsById(job.id);

    // Same job seen before (id + creation time; LPrint may reuse ids).
    let row = rows.find((r) => r.seen && r.jobCreated === created);
    // A studio submission not matched yet: same id, entry created around the same time.
    row ??= rows.find(
      (r) =>
        !r.seen &&
        r.historyId !== null &&
        job.user === STUDIO_USER_NAME &&
        (job.createdAt === null ||
          (r.entryCreatedAt !== null &&
            Math.abs(Date.parse(r.entryCreatedAt) - Date.parse(job.createdAt)) <= MATCH_WINDOW_MS)),
    );

    if (row) {
      const stale = !row.lastSeenAt || now.getTime() - Date.parse(row.lastSeenAt) > SEEN_REFRESH_MS;
      if (!row.seen || row.state !== state || stale) {
        history.markSeen(row.rowid, created, state, now);
      }
      if (row.historyId && (row.state !== state || !row.seen)) {
        history.refreshState(row.historyId);
        if (row.entrySource === 'airprint') history.setLabelCount(row.historyId, airprintLabelCount(job, state));
        result.updated++;
      }
      return { ...row, seen: true, jobCreated: created, state };
    }

    // Anything else from Label Studio (the ZPL test print) is not part of history.
    if (job.user === STUDIO_USER_NAME) return null;

    const createdAt = job.createdAt ? new Date(job.createdAt) : now;
    const entry = history.insertIngested(
      {
        id: newId(),
        name: (job.name ?? `Job ${job.id}`).slice(0, MAX_NAME_LENGTH),
        source: 'airprint',
        state,
        designId: null,
        printedBy: job.user,
        host: job.host,
        labelCount: airprintLabelCount(job, state),
        copies: 1,
        imageCount: 0,
        createdAt,
      },
      job.id,
      created,
      now,
    );
    result.added++;
    this.deps.log.info({ jobId: job.id, historyId: entry.id, user: job.user, host: job.host }, 'recorded AirPrint job');
    return history.jobsById(job.id).find((r) => r.historyId === entry.id) ?? null;
  }

  /**
   * Stores captured pages for finished AirPrint jobs and deletes captures that are no
   * longer needed. Only jobs present in the current listing are processed, so a
   * reused job id never picks up another job's pages.
   */
  private async processCaptures(
    jobs: PrinterJob[] | null,
    matched: Map<number, HistoryJob | null>,
    result: IngestResult,
  ): Promise<void> {
    const { captures, history } = this.deps;
    const files = await captures.list();
    if (files.length === 0) return;
    const now = this.now().getTime();
    const byJob = new Map<number, CaptureFile[]>();
    for (const file of files) {
      if (file.jobId !== null) byJob.set(file.jobId, [...(byJob.get(file.jobId) ?? []), file]);
    }
    const handled = new Set<CaptureFile>();
    const remove = async (list: CaptureFile[]) => {
      await captures.remove(list);
      list.forEach((f) => handled.add(f));
      result.capturesDeleted += list.length;
    };

    if (jobs) {
      const listed = new Map(jobs.map((j) => [j.id, j]));
      for (const [jobId, pages] of byJob) {
        const job = listed.get(jobId);
        if (!job || !FINAL_JOB_STATES.has(historyState(job.state))) continue;
        const row = matched.get(jobId) ?? null;
        try {
          if (row?.historyId) {
            const entry = history.get(row.historyId);
            if (entry?.source === 'airprint' && entry.imageCount === 0) {
              result.imagesStored += await this.storeCaptures(entry.id, jobId, pages);
            }
          }
          // Studio/import entries already have their PNGs; other jobs have no entry.
          await remove(pages);
        } catch (err) {
          this.deps.log.error({ err, jobId }, 'could not process captured pages');
        }
      }
    }

    // Age-based cleanup: anything older than a day, and unknown jobs after an hour.
    const known = history.knownJobIds();
    const expired = files.filter((f) => {
      if (handled.has(f)) return false;
      const age = now - f.mtime.getTime();
      if (age > 24 * HOUR_MS) return true;
      if (f.name.startsWith('.')) return false; // a capture still being written
      const unknown = f.jobId === null || (!known.has(f.jobId) && !matched.has(f.jobId));
      return unknown && age > HOUR_MS;
    });
    if (expired.length > 0) await remove(expired);
  }

  private async storeCaptures(historyId: string, jobId: number, pages: CaptureFile[]): Promise<number> {
    const pngs: Buffer[] = [];
    for (const page of pages) {
      try {
        const { png, resizedFrom } = pbmToLabelPng(await this.deps.captures.read(page));
        if (resizedFrom) {
          this.deps.log.warn(
            { jobId, page: page.page, width: resizedFrom.width, height: resizedFrom.height },
            'captured page is not 812x1218; padded/cropped to fit',
          );
        }
        pngs.push(png);
      } catch (err) {
        this.deps.log.warn({ err, jobId, file: page.name }, 'skipping unreadable captured page');
      }
    }
    if (pngs.length === 0) return 0;
    await this.deps.store.write(historyId, pngs);
    this.deps.history.setImageCount(historyId, pngs.length);
    return pngs.length;
  }
}
