// Shared contract between the Label Studio web app and server.
// All HTTP bodies are JSON unless noted. All routes live under /api.

// ---------------------------------------------------------------------------
// Label geometry
// ---------------------------------------------------------------------------

/** Printer resolution of the Zebra ZP 450 (dots per inch). */
export const PRINTER_DPI = 203;

/** 4x6 inch label in printer dots, portrait. Every print image uses this size. */
export const LABEL_WIDTH_DOTS = 812;
export const LABEL_HEIGHT_DOTS = 1218;

export type Orientation = 'portrait' | 'landscape';

// ---------------------------------------------------------------------------
// Designs and templates (shared office library)
// ---------------------------------------------------------------------------

export type DesignKind = 'design' | 'template';

/** A field the user fills in at print time, referenced in text as {{key}}. */
export interface DesignVariable {
  key: string;
  label: string;
  defaultValue?: string;
}

export interface DesignSummary {
  id: string;
  name: string;
  kind: DesignKind;
  category: string | null;
  orientation: Orientation;
  /** PNG data URL, roughly 240px on the long side. */
  thumbnail: string | null;
  variables: DesignVariable[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastPrintedAt: string | null;
  printCount: number;
  deletedAt: string | null;
}

export interface Design extends DesignSummary {
  /**
   * Editor document. Opaque to the server: the web app owns this format
   * (it includes a format version so the web app can migrate old designs).
   */
  document: unknown;
}

export interface DesignInput {
  name: string;
  kind: DesignKind;
  category?: string | null;
  orientation: Orientation;
  thumbnail?: string | null;
  variables?: DesignVariable[];
  document: unknown;
}

/** GET /api/designs?kind=&q=&category=&deleted=0|1 -> DesignSummary[] (sorted by updatedAt desc) */
/** GET /api/designs/:id -> Design */
/** POST /api/designs (DesignInput) -> Design */
/** PUT /api/designs/:id (DesignInput) -> Design */
/** POST /api/designs/:id/duplicate -> Design */
/** DELETE /api/designs/:id -> 204 (soft delete: sets deletedAt) */
/** POST /api/designs/:id/restore -> Design (admin) */
/** DELETE /api/designs/:id?purge=1 -> 204 (admin, permanent) */

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

export interface PrintRequest {
  /** Human-readable job name shown in the queue and history. */
  name: string;
  /**
   * One entry per distinct label, as PNG data URLs. Each image MUST be exactly
   * LABEL_WIDTH_DOTS x LABEL_HEIGHT_DOTS, portrait (landscape designs are
   * rotated 90 degrees clockwise by the web app before sending), and pure
   * black/white (every pixel #000000 or #FFFFFF). Max 200 images.
   */
  images: string[];
  /** Copies of each image. 1-100. */
  copies: number;
  /** Library design this was printed from, if any. */
  designId?: string | null;
  /** Optional free-text name of the person printing (remembered in the browser). */
  printedBy?: string | null;
}

export interface PrintResponse {
  historyId: string;
  jobIds: number[];
}

/** POST /api/print (PrintRequest) -> PrintResponse. Body limit 50 MB. */

export interface HistoryEntry {
  id: string;
  name: string;
  designId: string | null;
  printedBy: string | null;
  labelCount: number; // images.length
  copies: number;
  jobIds: number[];
  /** URL of the first label image, e.g. /api/history/:id/images/0.png */
  previewUrl: string;
  createdAt: string;
}

/** GET /api/history?limit=50&before=<iso> -> HistoryEntry[] (newest first) */
/** GET /api/history/:id/images/:index.png -> image/png */
/**
 * POST /api/history/:id/reprint -> PrintResponse (re-sends stored images as a new history entry).
 * Optional body: ReprintRequest; omitted fields reuse the original entry's values.
 */
/** DELETE /api/history/:id -> 204 (admin; removes the entry and its stored images) */

export interface ReprintRequest {
  copies?: number; // 1-100
  printedBy?: string | null;
}

// ---------------------------------------------------------------------------
// Printer status (from LPrint over IPP)
// ---------------------------------------------------------------------------

export type PrinterState = 'idle' | 'processing' | 'stopped' | 'unreachable';

export interface QueueJob {
  id: number;
  name: string;
  user: string | null;
  state: 'pending' | 'held' | 'processing' | 'stopped' | 'canceled' | 'aborted' | 'completed';
  createdAt: string | null;
  /** 'studio' when submitted by Label Studio, otherwise 'airprint'. */
  source: 'studio' | 'airprint';
}

export interface PrinterStatus {
  name: string;
  state: PrinterState;
  /** IPP printer-state-reasons minus "none", e.g. ["media-empty", "offline"]. */
  reasons: string[];
  /** Plain-language message for the UI, or null when everything is fine. */
  message: string | null;
  queue: QueueJob[]; // not-completed jobs, oldest first
  darkness: number | null; // printer-darkness-configured, 0-100
  speed: number | null; // print-speed-default in inches/sec, null = printer default
  mediaReady: string | null;
  checkedAt: string;
}

/** GET /api/printer -> PrinterStatus */
/** DELETE /api/printer/jobs/:id -> 204 (cancel one queued job; open to everyone) */
/**
 * POST /api/printer/test -> PrintResponse (admin; prints a server-generated ZPL test label).
 * Test prints are not recorded in history, so historyId is "".
 */

// ---------------------------------------------------------------------------
// Admin (session cookie "eco_admin", HttpOnly, Secure, SameSite=Strict)
// ---------------------------------------------------------------------------

export interface AdminState {
  /** False until the first admin password is set. */
  configured: boolean;
  loggedIn: boolean;
}

/** GET /api/admin/state -> AdminState */
/** POST /api/admin/setup { password } -> AdminState (only when !configured; min 8 chars) */
/** POST /api/admin/login { password } -> AdminState (401 on wrong password; rate limited) */
/** POST /api/admin/logout -> AdminState */
/** POST /api/admin/password { current, next } -> 204 */

export interface StudioSettings {
  studioName: string; // shown in the header, default "ECO Label Studio"
  historyRetentionDays: number; // default 90
  defaultCopies: number; // default 1
}

/** GET /api/settings -> StudioSettings (public) */
/** PUT /api/admin/settings (StudioSettings) -> StudioSettings */

export interface PrinterSettingsInput {
  darkness?: number; // 0-100 -> printer-darkness-configured
  speed?: number | null; // inches/sec 2-6, null resets to printer default
}

/** PUT /api/admin/printer (PrinterSettingsInput) -> PrinterStatus */

export type ServiceName = 'lprint' | 'avahi-daemon' | 'eco-studio';

export interface ServiceStatus {
  name: ServiceName;
  active: string; // systemd ActiveState, e.g. "active", "failed"
  sub: string; // systemd SubState, e.g. "running"
  since: string | null;
  restarts: number | null; // NRestarts
}

export interface HealthCheck {
  /** 'studio' is the Label Studio check added by deploy/provision.sh. */
  name: 'network' | 'lprint' | 'advertise' | 'studio';
  consecutiveFailures: number;
  nextActionAt: string | null;
}

export interface SystemInfo {
  hostname: string;
  addresses: string[]; // non-loopback IPv4/IPv6
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  memory: { totalBytes: number; availableBytes: number };
  disk: { totalBytes: number; freeBytes: number };
  cpuTempC: number | null;
  wifi: { ssid: string | null; signalPercent: number | null } | null;
  services: ServiceStatus[];
  health: HealthCheck[];
  versions: { studio: string; node: string; lprint: string | null };
  certificate: { notAfter: string | null; fingerprintSha256: string | null };
}

/** GET /api/admin/system -> SystemInfo */
/** POST /api/admin/services/:name/restart -> 202 (ServiceName only) */
/** POST /api/admin/reboot -> 202 */
/** GET /api/admin/logs?unit=lprint|eco-studio|eco-printer-health&lines=200 -> { lines: string[] } */

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** GET /api/health -> { ok: true, version } (used by eco-printer-health) */
/** GET /ca.crt -> the local CA certificate (application/x-x509-ca-cert), public */

export interface ApiError {
  error: string; // machine-readable code, e.g. "not_found", "invalid_image"
  message: string; // human-readable
}
