import type { HistoryRepository } from '../db/history.js';
import type { SettingsRepository } from '../db/settings.js';
import type { PrintStore } from '../storage/print-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Image directories without a history row are only removed once they are this old,
 *  so a print in progress (images written, row not yet visible) is never touched. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

export interface PruneResult {
  historyDeleted: number;
  orphanDirsDeleted: number;
}

/** Deletes history rows and their image directories older than historyRetentionDays. */
export class RetentionService {
  constructor(
    private readonly history: HistoryRepository,
    private readonly settings: SettingsRepository,
    private readonly store: PrintStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prune(): Promise<PruneResult> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - this.settings.get().historyRetentionDays * DAY_MS);
    const deleted = this.history.deleteOlderThan(cutoff);
    for (const id of deleted) await this.store.remove(id);

    const known = this.history.allIds();
    let orphans = 0;
    for (const dir of await this.store.list()) {
      if (!known.has(dir.id) && now.getTime() - dir.mtime.getTime() > ORPHAN_GRACE_MS) {
        await this.store.remove(dir.id);
        orphans++;
      }
    }
    return { historyDeleted: deleted.length, orphanDirsDeleted: orphans };
  }
}
