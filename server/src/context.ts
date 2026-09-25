import type { DatabaseSync } from 'node:sqlite';
import { AdminAuth } from './auth/admin-auth.js';
import { RateLimiter } from './auth/rate-limiter.js';
import { AdminRepository } from './db/admin.js';
import { DesignRepository } from './db/designs.js';
import { HistoryRepository } from './db/history.js';
import { SettingsRepository } from './db/settings.js';
import type { Printer } from './printer/printer.js';
import { StatusCache } from './printer/status-cache.js';
import { PrintService } from './services/print-service.js';
import { HistoryIngestService, type IngestLogger } from './services/history-ingest.js';
import { RetentionService } from './services/retention.js';
import { CaptureStore } from './storage/capture-store.js';
import { PrintStore } from './storage/print-store.js';
import type { CommandRunner, TextReader } from './system/exec.js';
import { SystemControl } from './system/system-control.js';
import { SystemInfoService } from './system/system-info.js';
import path from 'node:path';

export interface ContextOptions {
  db: DatabaseSync;
  printer: Printer;
  dataDir: string;
  tlsDir: string;
  healthDir: string;
  /** Page captures from the patched LPrint driver; defaults to <dataDir>/fake-capture. */
  captureDir?: string;
  staticDir: string | null;
  allowedOrigins: string[];
  version: string;
  run: CommandRunner;
  readText: TextReader;
  now?: () => Date;
  /** Login attempts allowed per IP per minute. */
  loginAttemptsPerMinute?: number;
  /** Delay before self-restart / reboot commands run, so the 202 response gets out first. */
  deferredCommandDelayMs?: number;
}

/** Everything route handlers need, wired once per app instance. */
export interface AppContext {
  options: ContextOptions;
  now: () => Date;
  designs: DesignRepository;
  history: HistoryRepository;
  settings: SettingsRepository;
  auth: AdminAuth;
  loginLimiter: RateLimiter;
  printer: Printer;
  status: StatusCache;
  store: PrintStore;
  prints: PrintService;
  retention: RetentionService;
  ingest: HistoryIngestService;
  systemInfo: SystemInfoService;
  systemControl: SystemControl;
}

const silentLogger: IngestLogger = { info() {}, warn() {}, error() {} };

export function createContext(options: ContextOptions, log: IngestLogger = silentLogger): AppContext {
  const now = options.now ?? (() => new Date());
  const designs = new DesignRepository(options.db, now);
  const history = new HistoryRepository(options.db);
  const settings = new SettingsRepository(options.db);
  const store = new PrintStore(path.join(options.dataDir, 'prints'));
  const status = new StatusCache(() => options.printer.getStatus(), 2000);
  return {
    options,
    now,
    designs,
    history,
    settings,
    auth: new AdminAuth(new AdminRepository(options.db), now),
    loginLimiter: new RateLimiter(options.loginAttemptsPerMinute ?? 5, 60_000, () => now().getTime()),
    printer: options.printer,
    status,
    store,
    prints: new PrintService({ printer: options.printer, status, designs, history, store, now }),
    retention: new RetentionService(history, settings, store, now),
    ingest: new HistoryIngestService({
      printer: options.printer,
      history,
      store,
      captures: new CaptureStore(options.captureDir ?? path.join(options.dataDir, 'fake-capture')),
      log,
      now,
    }),
    systemInfo: new SystemInfoService({
      run: options.run,
      readText: options.readText,
      dataDir: options.dataDir,
      tlsDir: options.tlsDir,
      healthDir: options.healthDir,
      studioVersion: options.version,
    }),
    systemControl: new SystemControl(options.run),
  };
}
