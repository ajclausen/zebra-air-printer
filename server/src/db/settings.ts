import type { DatabaseSync } from 'node:sqlite';
import type { StudioSettings } from '@eco/shared';

export const DEFAULT_SETTINGS: StudioSettings = {
  studioName: 'ECO Label Studio',
  historyRetentionDays: 90,
  defaultCopies: 1,
};

/** Key/value settings, stored as JSON values so new settings need no migration. */
export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(): StudioSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof StudioSettings>) {
      if (typeof stored[key] === typeof DEFAULT_SETTINGS[key]) (settings as Record<string, unknown>)[key] = stored[key];
    }
    return settings;
  }

  save(settings: StudioSettings): StudioSettings {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    );
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof StudioSettings>) {
      upsert.run(key, JSON.stringify(settings[key]));
    }
    return this.get();
  }
}
