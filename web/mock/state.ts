import { randomBytes, randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { deflateSync } from 'node:zlib';
import type { Connect } from 'vite';

import { LABEL_HEIGHT_DOTS, LABEL_WIDTH_DOTS } from '@eco/shared';
import type {
  AdminState,
  ApiError,
  Design,
  DesignInput,
  DesignSummary,
  DesignVariable,
  HistoryEntry,
  PrinterSettingsInput,
  PrinterState,
  PrinterStatus,
  PrintRequest,
  PrintResponse,
  QueueJob,
  ServiceName,
  ServiceStatus,
  StudioSettings,
  SystemInfo,
} from '@eco/shared';

import { seedDesigns } from './seed';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface StoredJob {
  id: number;
  name: string;
  user: string | null;
  source: 'studio' | 'airprint';
  copies: number;
  createdAt: string;
  state: 'pending' | 'processing';
}

interface StoredHistoryEntry {
  id: string;
  name: string;
  designId: string | null;
  printedBy: string | null;
  copies: number;
  jobIds: number[];
  images: Buffer[];
  createdAt: string;
}

interface PrinterOverride {
  state: PrinterState;
  reasons: string[];
  message: string | null;
}

interface ServiceRecord {
  since: string;
  restarts: number;
}

interface Store {
  designs: Map<string, Design>;
  history: Map<string, StoredHistoryEntry>;
  jobs: Map<number, StoredJob>;
  nextJobId: number;
  printerOverride: PrinterOverride | null;
  printerSettings: { darkness: number; speed: number | null };
  settings: StudioSettings;
  adminConfigured: boolean;
  adminPassword: string | null;
  adminSessions: Set<string>;
  uptimeBaseSeconds: number;
  uptimeAnchor: Date;
  serviceState: Record<ServiceName, ServiceRecord>;
  certNotAfter: string;
  certFingerprint: string;
}

const SERVICE_NAMES: readonly ServiceName[] = ['lprint', 'avahi-daemon', 'eco-studio'];
const BASE_UPTIME_SECONDS = 3 * 24 * 3600 + 4 * 3600; // 3 days, 4 hours
const MS_PER_COPY = 1500;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

function createEmptyServiceState(anchor: Date): Record<ServiceName, ServiceRecord> {
  const since = anchor.toISOString();
  return {
    lprint: { since, restarts: 0 },
    'avahi-daemon': { since, restarts: 0 },
    'eco-studio': { since, restarts: 1 },
  };
}

function createEmptyStore(): Store {
  const anchor = new Date();
  return {
    designs: new Map(),
    history: new Map(),
    jobs: new Map(),
    nextJobId: 101,
    printerOverride: null,
    printerSettings: { darkness: 70, speed: null },
    settings: { studioName: 'ECO Label Studio', historyRetentionDays: 90, defaultCopies: 1 },
    adminConfigured: false,
    adminPassword: null,
    adminSessions: new Set(),
    uptimeBaseSeconds: BASE_UPTIME_SECONDS,
    uptimeAnchor: anchor,
    serviceState: createEmptyServiceState(anchor),
    certNotAfter: '',
    certFingerprint: '',
  };
}

/** Resets every field to a fresh startup state, in place (keeps the same object identity). */
function resetStore(store: Store): void {
  store.designs.clear();
  store.history.clear();
  store.jobs.clear();
  store.nextJobId = 101;
  store.printerOverride = null;
  store.printerSettings = { darkness: 70, speed: null };
  store.settings = { studioName: 'ECO Label Studio', historyRetentionDays: 90, defaultCopies: 1 };
  store.adminSessions.clear();

  const envPassword = process.env.MOCK_ADMIN_PASSWORD;
  store.adminConfigured = Boolean(envPassword);
  store.adminPassword = envPassword && envPassword.length > 0 ? envPassword : null;

  const anchor = new Date();
  store.uptimeBaseSeconds = BASE_UPTIME_SECONDS;
  store.uptimeAnchor = anchor;
  store.serviceState = createEmptyServiceState(anchor);
  store.certNotAfter = buildCertNotAfter(anchor);
  store.certFingerprint = buildCertFingerprint();

  seedStore(store);
}

function createStore(): Store {
  const store = createEmptyStore();
  resetStore(store);
  return store;
}

function seedStore(store: Store): void {
  const base = Date.now();
  for (const [index, input] of seedDesigns.entries()) {
    const daysAgo = 4 - (index % 4);
    const at = new Date(base - daysAgo * 24 * 60 * 60 * 1000 - index * 37 * 60 * 1000);
    createDesign(store, input, at);
  }
}

function buildCertNotAfter(anchor: Date): string {
  return new Date(anchor.getTime() + 700 * 24 * 60 * 60 * 1000).toISOString();
}

function buildCertFingerprint(): string {
  const bytes = randomBytes(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}

function sendNoContent(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.end();
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: code, message } satisfies ApiError);
}

function pickRandom<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('pickRandom called with an empty array');
  return item;
}

function delay(): Promise<void> {
  const ms = 120 + Math.random() * 130; // 120-250ms
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'too_large', 'Request body exceeds the 50 MB limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err: Error) => reject(err));
  });
}

async function readJsonBody(req: Connect.IncomingMessage): Promise<unknown> {
  const buf = await readBody(req);
  if (buf.length === 0) return undefined;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_body', 'Request body is not valid JSON.');
  }
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    const seg = pathParts[i];
    if (part === undefined || seg === undefined) return null;
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(seg);
    } else if (part !== seg) {
      return null;
    }
  }
  return params;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

const SESSION_COOKIE = 'eco_admin';

function getSessionToken(req: Connect.IncomingMessage): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

function isLoggedIn(store: Store, req: Connect.IncomingMessage): boolean {
  const token = getSessionToken(req);
  return token !== undefined && store.adminSessions.has(token);
}

function requireAdmin(store: Store, req: Connect.IncomingMessage): void {
  if (!isLoggedIn(store, req)) {
    throw new HttpError(401, 'unauthorized', 'Log in to the admin console first.');
  }
}

function createSession(store: Store): string {
  const token = randomUUID();
  store.adminSessions.add(token);
  return token;
}

function setSessionCookie(res: ServerResponse, token: string): void {
  // No Secure flag: dev server is plain http.
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

/** Validates an optional `string | null` field, defaulting missing/null to null. */
function stringOrNullField(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_body', `${field} must be a string or null.`);
  return value;
}

function validateDesignInput(body: unknown): DesignInput {
  const b = asRecord(body);
  if (typeof b.name !== 'string' || b.name.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'name must be a non-empty string.');
  }
  if (b.kind !== 'design' && b.kind !== 'template') {
    throw new HttpError(400, 'invalid_body', 'kind must be "design" or "template".');
  }
  if (b.orientation !== 'portrait' && b.orientation !== 'landscape') {
    throw new HttpError(400, 'invalid_body', 'orientation must be "portrait" or "landscape".');
  }
  const category = stringOrNullField(b.category, 'category');
  const thumbnail = stringOrNullField(b.thumbnail, 'thumbnail');
  const variables = validateVariables(b.variables);
  return {
    name: b.name,
    kind: b.kind,
    orientation: b.orientation,
    category,
    thumbnail,
    variables,
    document: 'document' in b ? b.document : null,
  };
}

function validateVariables(value: unknown): DesignVariable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid_body', 'variables must be an array.');
  return value.map((item, index) => {
    const v = asRecord(item);
    if (typeof v.key !== 'string' || typeof v.label !== 'string') {
      throw new HttpError(400, 'invalid_body', `variables[${index}] must have a string key and label.`);
    }
    if (v.defaultValue !== undefined && typeof v.defaultValue !== 'string') {
      throw new HttpError(400, 'invalid_body', `variables[${index}].defaultValue must be a string.`);
    }
    const variable: DesignVariable = { key: v.key, label: v.label };
    if (typeof v.defaultValue === 'string') variable.defaultValue = v.defaultValue;
    return variable;
  });
}

function validatePrintRequest(body: unknown): PrintRequest {
  const b = asRecord(body);
  if (typeof b.name !== 'string' || b.name.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'name must be a non-empty string.');
  }
  if (!Array.isArray(b.images) || b.images.length === 0) {
    throw new HttpError(400, 'invalid_body', 'images must be a non-empty array.');
  }
  if (b.images.length > 200) {
    throw new HttpError(400, 'invalid_body', 'images must contain at most 200 entries.');
  }
  if (!b.images.every((img: unknown) => typeof img === 'string')) {
    throw new HttpError(400, 'invalid_body', 'images must be an array of data URL strings.');
  }
  if (typeof b.copies !== 'number' || !Number.isInteger(b.copies) || b.copies < 1 || b.copies > 100) {
    throw new HttpError(400, 'invalid_body', 'copies must be an integer between 1 and 100.');
  }
  const designId = stringOrNullField(b.designId, 'designId');
  const printedBy = stringOrNullField(b.printedBy, 'printedBy');
  return {
    name: b.name,
    images: b.images as string[],
    copies: b.copies,
    designId,
    printedBy,
  };
}

function validateStudioSettings(body: unknown): StudioSettings {
  const b = asRecord(body);
  if (typeof b.studioName !== 'string' || b.studioName.trim() === '' || b.studioName.length > 60) {
    throw new HttpError(400, 'invalid_body', 'studioName must be 1-60 characters.');
  }
  if (
    typeof b.historyRetentionDays !== 'number' ||
    !Number.isInteger(b.historyRetentionDays) ||
    b.historyRetentionDays < 1 ||
    b.historyRetentionDays > 3650
  ) {
    throw new HttpError(400, 'invalid_body', 'historyRetentionDays must be an integer between 1 and 3650.');
  }
  if (
    typeof b.defaultCopies !== 'number' ||
    !Number.isInteger(b.defaultCopies) ||
    b.defaultCopies < 1 ||
    b.defaultCopies > 100
  ) {
    throw new HttpError(400, 'invalid_body', 'defaultCopies must be an integer between 1 and 100.');
  }
  return { studioName: b.studioName, historyRetentionDays: b.historyRetentionDays, defaultCopies: b.defaultCopies };
}

function validatePrinterSettingsInput(body: unknown): PrinterSettingsInput {
  const b = asRecord(body);
  const result: PrinterSettingsInput = {};
  if (b.darkness !== undefined) {
    if (typeof b.darkness !== 'number' || !Number.isInteger(b.darkness) || b.darkness < 0 || b.darkness > 100) {
      throw new HttpError(400, 'invalid_body', 'darkness must be an integer between 0 and 100.');
    }
    result.darkness = b.darkness;
  }
  if (b.speed !== undefined) {
    if (b.speed === null) {
      result.speed = null;
    } else if (typeof b.speed === 'number' && b.speed >= 2 && b.speed <= 6) {
      result.speed = b.speed;
    } else {
      throw new HttpError(400, 'invalid_body', 'speed must be null or a number between 2 and 6.');
    }
  }
  return result;
}

function isPrinterState(value: unknown): value is PrinterState {
  return value === 'idle' || value === 'processing' || value === 'stopped' || value === 'unreachable';
}

interface MockPrinterOverrideInput {
  state?: PrinterState;
  reasons?: string[];
  message?: string | null;
}

function validateMockPrinterOverride(body: unknown): MockPrinterOverrideInput {
  if (body === undefined) return {};
  const b = asRecord(body);
  const result: MockPrinterOverrideInput = {};
  if (b.state !== undefined) {
    if (!isPrinterState(b.state)) {
      throw new HttpError(400, 'invalid_body', 'state must be one of idle, processing, stopped, unreachable.');
    }
    result.state = b.state;
  }
  if (b.reasons !== undefined) {
    if (!Array.isArray(b.reasons) || !b.reasons.every((r: unknown) => typeof r === 'string')) {
      throw new HttpError(400, 'invalid_body', 'reasons must be an array of strings.');
    }
    result.reasons = b.reasons as string[];
  }
  if (b.message !== undefined) {
    if (b.message === null) {
      result.message = null;
    } else if (typeof b.message === 'string') {
      result.message = b.message;
    } else {
      throw new HttpError(400, 'invalid_body', 'message must be a string or null.');
    }
  }
  return result;
}

function extractPassword(body: unknown): string {
  const b = asRecord(body);
  if (typeof b.password !== 'string') throw new HttpError(400, 'invalid_body', 'password must be a string.');
  return b.password;
}

function extractPasswordChange(body: unknown): { current: string; next: string } {
  const b = asRecord(body);
  if (typeof b.current !== 'string' || typeof b.next !== 'string') {
    throw new HttpError(400, 'invalid_body', 'current and next must be strings.');
  }
  return { current: b.current, next: b.next };
}

function isServiceName(value: string): value is ServiceName {
  return SERVICE_NAMES.includes(value as ServiceName);
}

type LogUnit = 'lprint' | 'eco-studio' | 'eco-printer-health';

function isLogUnit(value: string | null): value is LogUnit {
  return value === 'lprint' || value === 'eco-studio' || value === 'eco-printer-health';
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

function toSummary(design: Design): DesignSummary {
  const { document: _document, ...summary } = design;
  return summary;
}

function createDesign(store: Store, input: DesignInput, at: Date): Design {
  const iso = at.toISOString();
  const design: Design = {
    id: randomUUID(),
    name: input.name,
    kind: input.kind,
    category: input.category ?? null,
    orientation: input.orientation,
    thumbnail: input.thumbnail ?? null,
    variables: input.variables ?? [],
    document: input.document,
    createdAt: iso,
    updatedAt: iso,
    lastPrintedAt: null,
    printCount: 0,
    deletedAt: null,
  };
  store.designs.set(design.id, design);
  return design;
}

function getDesignOrThrow(store: Store, id: string): Design {
  const design = store.designs.get(id);
  if (!design) throw new HttpError(404, 'not_found', 'Design not found.');
  return design;
}

function updateDesign(store: Store, id: string, input: DesignInput, at: Date): Design {
  const existing = getDesignOrThrow(store, id);
  const updated: Design = {
    ...existing,
    name: input.name,
    kind: input.kind,
    category: input.category ?? null,
    orientation: input.orientation,
    thumbnail: input.thumbnail ?? null,
    variables: input.variables ?? [],
    document: input.document,
    updatedAt: at.toISOString(),
  };
  store.designs.set(id, updated);
  return updated;
}

function duplicateDesign(store: Store, id: string, at: Date): Design {
  const existing = getDesignOrThrow(store, id);
  const iso = at.toISOString();
  const copy: Design = {
    ...existing,
    id: randomUUID(),
    name: `${existing.name} copy`,
    kind: 'design',
    createdAt: iso,
    updatedAt: iso,
    lastPrintedAt: null,
    printCount: 0,
    deletedAt: null,
  };
  store.designs.set(copy.id, copy);
  return copy;
}

function deleteDesign(store: Store, id: string, purge: boolean, at: Date): void {
  const existing = getDesignOrThrow(store, id);
  if (purge) {
    store.designs.delete(id);
  } else {
    store.designs.set(id, { ...existing, deletedAt: at.toISOString() });
  }
}

function restoreDesign(store: Store, id: string): Design {
  const existing = getDesignOrThrow(store, id);
  const restored = { ...existing, deletedAt: null };
  store.designs.set(id, restored);
  return restored;
}

function listDesigns(store: Store, url: URL): DesignSummary[] {
  const kind = url.searchParams.get('kind');
  const q = url.searchParams.get('q');
  const category = url.searchParams.get('category');
  const includeDeleted = url.searchParams.get('deleted') === '1';

  let list = [...store.designs.values()];
  if (!includeDeleted) list = list.filter((d) => d.deletedAt === null);
  if (kind) list = list.filter((d) => d.kind === kind);
  if (category) list = list.filter((d) => d.category === category);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (d) => d.name.toLowerCase().includes(needle) || (d.category ?? '').toLowerCase().includes(needle),
    );
  }
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list.map(toSummary);
}

// ---------------------------------------------------------------------------
// PNG encoding / decoding (no image libraries — the contract requires plain
// black/white 812x1218 PNGs, so a minimal hand-rolled codec is enough).
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf.readUInt8(i);
    const entry = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0;
    crc = entry ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** Decodes a `data:image/png;base64,...` URL and checks it is a real, correctly-sized label PNG. */
function decodePngImage(dataUrl: string, index: number): Buffer {
  const label = `Image ${index + 1}`;
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new HttpError(400, 'invalid_image', `${label} is not a PNG data URL.`);
  }
  const bytes = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new HttpError(400, 'invalid_image', `${label} is not a valid PNG.`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== LABEL_WIDTH_DOTS || height !== LABEL_HEIGHT_DOTS) {
    throw new HttpError(
      400,
      'invalid_image',
      `${label} is ${width}x${height}; expected ${LABEL_WIDTH_DOTS}x${LABEL_HEIGHT_DOTS}.`,
    );
  }
  return bytes;
}

/** Builds a valid 812x1218 grayscale PNG: white with a black border, used for admin test prints. */
function buildTestLabelPng(): Buffer {
  const width = LABEL_WIDTH_DOTS;
  const height = LABEL_HEIGHT_DOTS;
  const borderPx = 12;
  const raw = Buffer.alloc(height * (1 + width));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width);
    raw[rowStart] = 0; // filter type: none
    const isBorderRow = y < borderPx || y >= height - borderPx;
    for (let x = 0; x < width; x++) {
      const isBorderCol = x < borderPx || x >= width - borderPx;
      raw[rowStart + 1 + x] = isBorderRow || isBorderCol ? 0 : 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Print / history / queue
// ---------------------------------------------------------------------------

interface EnqueuePrintInput {
  name: string;
  designId: string | null;
  printedBy: string | null;
  copies: number;
  images: Buffer[];
}

function enqueuePrint(store: Store, input: EnqueuePrintInput, at: Date): PrintResponse {
  const id = randomUUID();
  const createdAt = at.toISOString();
  const total = input.images.length;

  const jobIds = input.images.map((_image, index) => {
    const jobId = store.nextJobId++;
    store.jobs.set(jobId, {
      id: jobId,
      name: total > 1 ? `${input.name} (${index + 1}/${total})` : input.name,
      user: 'label-studio',
      source: 'studio',
      copies: input.copies,
      createdAt,
      state: 'pending',
    });
    return jobId;
  });

  store.history.set(id, {
    id,
    name: input.name,
    designId: input.designId,
    printedBy: input.printedBy,
    copies: input.copies,
    jobIds,
    images: input.images,
    createdAt,
  });

  if (input.designId) {
    const design = store.designs.get(input.designId);
    if (design) {
      store.designs.set(design.id, { ...design, printCount: design.printCount + 1, lastPrintedAt: createdAt });
    }
  }

  return { historyId: id, jobIds };
}

function createPrint(store: Store, request: PrintRequest, at: Date): PrintResponse {
  const images = request.images.map((image, index) => decodePngImage(image, index));
  return enqueuePrint(
    store,
    { name: request.name, designId: request.designId ?? null, printedBy: request.printedBy ?? null, copies: request.copies, images },
    at,
  );
}

function reprintHistory(store: Store, entry: StoredHistoryEntry, at: Date): PrintResponse {
  return enqueuePrint(
    store,
    { name: entry.name, designId: entry.designId, printedBy: entry.printedBy, copies: entry.copies, images: entry.images },
    at,
  );
}

function toHistoryEntry(entry: StoredHistoryEntry): HistoryEntry {
  return {
    id: entry.id,
    name: entry.name,
    designId: entry.designId,
    printedBy: entry.printedBy,
    labelCount: entry.images.length,
    copies: entry.copies,
    jobIds: entry.jobIds,
    previewUrl: `/api/history/${entry.id}/images/0.png`,
    createdAt: entry.createdAt,
  };
}

function listHistory(store: Store, url: URL): HistoryEntry[] {
  const before = url.searchParams.get('before');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? clampInt(Number(limitParam), 1, 1000) : 50;

  let list = [...store.history.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (before) list = list.filter((h) => h.createdAt < before);
  list = list.slice(0, limit);
  return list.map(toHistoryEntry);
}

// ---------------------------------------------------------------------------
// Printer / queue simulation
// ---------------------------------------------------------------------------

function jobDurationMs(copies: number): number {
  return MS_PER_COPY * copies;
}

/**
 * Advances the queue to `now`: the oldest active job is 'processing', jobs
 * behind it stay 'pending', and any job whose processing window has elapsed
 * is removed (as if it completed). Purely computed from timestamps, no timers.
 */
function refreshQueue(store: Store, now: Date): void {
  const active = [...store.jobs.values()]
    .filter((job) => job.state === 'pending' || job.state === 'processing')
    .sort((a, b) => a.id - b.id);

  let cursor: Date | null = null;
  let headIsActive = true;

  for (const job of active) {
    if (cursor === null) cursor = new Date(job.createdAt);
    if (!headIsActive) {
      job.state = 'pending';
      continue;
    }
    const end: Date = new Date(cursor.getTime() + jobDurationMs(job.copies));
    if (end.getTime() <= now.getTime()) {
      store.jobs.delete(job.id);
      cursor = end;
    } else {
      job.state = 'processing';
      headIsActive = false;
    }
  }
}

function toQueueJob(job: StoredJob): QueueJob {
  return { id: job.id, name: job.name, user: job.user, state: job.state, createdAt: job.createdAt, source: job.source };
}

function getPrinterStatus(store: Store, at: Date): PrinterStatus {
  refreshQueue(store, at);
  const queue = [...store.jobs.values()].sort((a, b) => a.id - b.id).map(toQueueJob);
  const override = store.printerOverride;
  const derivedState: PrinterState = queue.some((job) => job.state === 'processing') ? 'processing' : 'idle';

  return {
    name: 'Zebra_ZP_450',
    state: override?.state ?? derivedState,
    reasons: override?.reasons ?? [],
    message: override ? override.message : null,
    queue,
    darkness: store.printerSettings.darkness,
    speed: store.printerSettings.speed,
    mediaReady: 'na_index-4x6_4x6in',
    checkedAt: at.toISOString(),
  };
}

function defaultOverrideMessage(state: PrinterState, reasons: string[]): string | null {
  if (state === 'stopped' && reasons.includes('media-empty')) {
    return 'The printer is out of labels. Load a new roll and close the lid.';
  }
  if (state === 'unreachable') {
    return 'The printer is not responding. Check that it is on and the USB cable is connected.';
  }
  return null;
}

function applyPrinterOverride(store: Store, input: MockPrinterOverrideInput): void {
  const state = input.state ?? store.printerOverride?.state ?? 'idle';
  const reasons = input.reasons ?? store.printerOverride?.reasons ?? [];
  // An explicit message always wins. Otherwise recompute the state/reasons default
  // (rather than reusing a stale message from a prior, different override).
  const message = input.message !== undefined ? input.message : defaultOverrideMessage(state, reasons);
  store.printerOverride = { state, reasons, message };
}

// ---------------------------------------------------------------------------
// Admin: system info & logs
// ---------------------------------------------------------------------------

const GIB = 1024 ** 3;

function jitter(base: number, span: number): number {
  return base + (Math.random() * 2 - 1) * span;
}

function buildServiceStatuses(store: Store): ServiceStatus[] {
  return SERVICE_NAMES.map((name) => ({
    name,
    active: 'active',
    sub: 'running',
    since: store.serviceState[name].since,
    restarts: store.serviceState[name].restarts,
  }));
}

function buildSystemInfo(store: Store, at: Date): SystemInfo {
  const uptimeSeconds = store.uptimeBaseSeconds + (at.getTime() - store.uptimeAnchor.getTime()) / 1000;
  return {
    hostname: 'eco-printer',
    addresses: ['192.168.1.42', 'fe80::1c2b:3aff:fe4d:5e6f'],
    uptimeSeconds: Math.round(uptimeSeconds),
    loadAverage: [
      Math.max(0, Number(jitter(0.3, 0.1).toFixed(2))),
      Math.max(0, Number(jitter(0.35, 0.1).toFixed(2))),
      Math.max(0, Number(jitter(0.4, 0.1).toFixed(2))),
    ],
    memory: { totalBytes: 8 * GIB, availableBytes: Math.round(jitter(5.9, 0.15) * GIB) },
    disk: { totalBytes: 58 * GIB, freeBytes: Math.round(jitter(41, 0.5) * GIB) },
    cpuTempC: Number(jitter(50, 3).toFixed(1)),
    wifi: { ssid: 'ECO-Office', signalPercent: Math.round(jitter(71, 3)) },
    services: buildServiceStatuses(store),
    health: [
      { name: 'network', consecutiveFailures: 0, nextActionAt: null },
      { name: 'lprint', consecutiveFailures: 0, nextActionAt: null },
      { name: 'advertise', consecutiveFailures: 0, nextActionAt: null },
    ],
    versions: { studio: '0.1.0', node: 'v24.8.0', lprint: '1.3.1' },
    certificate: { notAfter: store.certNotAfter, fingerprintSha256: store.certFingerprint },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function formatSyslogTimestamp(date: Date): string {
  const month = MONTHS[date.getMonth()] ?? 'Jan';
  const day = String(date.getDate()).padStart(2, '0');
  const time = date.toTimeString().slice(0, 8);
  return `${month} ${day} ${time}`;
}

const LOG_MESSAGE_POOLS: Record<LogUnit, readonly string[]> = {
  lprint: [
    'lprint[812]: Listening for IPP connections on port 8000.',
    'lprint[812]: [Job 88] Job completed.',
    'lprint[812]: [Job 89] Printing page 1, 1 copy.',
    'lprint[812]: Printer "Zebra_ZP_450" is idle.',
    'lprint[812]: mDNS advertisement refreshed.',
    'lprint[812]: Darkness set to 70.',
  ],
  'eco-studio': [
    'eco-studio[401]: GET /api/printer 200 4ms',
    'eco-studio[401]: POST /api/print 200 812ms',
    'eco-studio[401]: Serving static assets from /opt/eco-studio/dist',
    'eco-studio[401]: Settings updated by admin.',
    'eco-studio[401]: Admin session started.',
  ],
  'eco-printer-health': [
    'eco-printer-health[203]: GET /api/health -> 200 OK',
    'eco-printer-health[203]: printer state: idle',
    'eco-printer-health[203]: heartbeat ok',
    'eco-printer-health[203]: mDNS advertise ok',
  ],
};

function buildLogLines(unit: LogUnit, count: number, at: Date): string[] {
  const pool = LOG_MESSAGE_POOLS[unit];
  const lines: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const timestamp = new Date(at.getTime() - i * 45_000 - Math.floor(Math.random() * 15_000));
    lines.push(`${formatSyslogTimestamp(timestamp)} eco-printer ${pickRandom(pool)}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// ca.crt
// ---------------------------------------------------------------------------

function buildFakeCaCertPem(): string {
  const body = randomBytes(540).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function sendCaCert(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-x509-ca-cert');
  res.setHeader('content-disposition', 'attachment; filename="eco-label-studio-ca.crt"');
  res.end(buildFakeCaCertPem());
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function routeRequest(store: Store, req: Connect.IncomingMessage, res: ServerResponse): Promise<void> {
  await delay();

  const url = new URL(req.url ?? '/', 'http://mock.local');
  const { pathname } = url;
  const method = (req.method ?? 'GET').toUpperCase();
  const at = new Date();

  try {
    if (method === 'GET' && pathname === '/ca.crt') {
      sendCaCert(res);
      return;
    }

    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: '0.1.0-mock' });
      return;
    }

    // -- Designs -------------------------------------------------------
    if (method === 'GET' && pathname === '/api/designs') {
      sendJson(res, 200, listDesigns(store, url));
      return;
    }
    if (method === 'POST' && pathname === '/api/designs') {
      const input = validateDesignInput(await readJsonBody(req));
      sendJson(res, 201, createDesign(store, input, at));
      return;
    }
    const designDuplicateMatch = matchPath('/api/designs/:id/duplicate', pathname);
    if (method === 'POST' && designDuplicateMatch) {
      sendJson(res, 201, duplicateDesign(store, designDuplicateMatch.id ?? '', at));
      return;
    }
    const designRestoreMatch = matchPath('/api/designs/:id/restore', pathname);
    if (method === 'POST' && designRestoreMatch) {
      requireAdmin(store, req);
      sendJson(res, 200, restoreDesign(store, designRestoreMatch.id ?? ''));
      return;
    }
    const designIdMatch = matchPath('/api/designs/:id', pathname);
    if (method === 'GET' && designIdMatch) {
      sendJson(res, 200, getDesignOrThrow(store, designIdMatch.id ?? ''));
      return;
    }
    if (method === 'PUT' && designIdMatch) {
      const input = validateDesignInput(await readJsonBody(req));
      sendJson(res, 200, updateDesign(store, designIdMatch.id ?? '', input, at));
      return;
    }
    if (method === 'DELETE' && designIdMatch) {
      const purge = url.searchParams.get('purge') === '1';
      if (purge) requireAdmin(store, req);
      deleteDesign(store, designIdMatch.id ?? '', purge, at);
      sendNoContent(res, 204);
      return;
    }

    // -- Print / history -------------------------------------------------
    if (method === 'POST' && pathname === '/api/print') {
      const request = validatePrintRequest(await readJsonBody(req));
      sendJson(res, 200, createPrint(store, request, at));
      return;
    }
    if (method === 'GET' && pathname === '/api/history') {
      sendJson(res, 200, listHistory(store, url));
      return;
    }
    const historyReprintMatch = matchPath('/api/history/:id/reprint', pathname);
    if (method === 'POST' && historyReprintMatch) {
      const entry = store.history.get(historyReprintMatch.id ?? '');
      if (!entry) throw new HttpError(404, 'not_found', 'History entry not found.');
      sendJson(res, 200, reprintHistory(store, entry, at));
      return;
    }
    const historyImageMatch = pathname.match(/^\/api\/history\/([^/]+)\/images\/(\d+)\.png$/);
    if (method === 'GET' && historyImageMatch) {
      const id = historyImageMatch[1];
      const indexStr = historyImageMatch[2];
      if (id === undefined || indexStr === undefined) throw new HttpError(404, 'not_found', 'Image not found.');
      const entry = store.history.get(id);
      if (!entry) throw new HttpError(404, 'not_found', 'History entry not found.');
      const image = entry.images[Number(indexStr)];
      if (!image) throw new HttpError(404, 'not_found', 'Image not found.');
      res.statusCode = 200;
      res.setHeader('content-type', 'image/png');
      res.end(image);
      return;
    }

    // -- Printer -----------------------------------------------------------
    if (method === 'GET' && pathname === '/api/printer') {
      sendJson(res, 200, getPrinterStatus(store, at));
      return;
    }
    const cancelJobMatch = matchPath('/api/printer/jobs/:id', pathname);
    if (method === 'DELETE' && cancelJobMatch) {
      refreshQueue(store, at);
      const jobId = Number(cancelJobMatch.id ?? '');
      if (!store.jobs.has(jobId)) throw new HttpError(404, 'not_found', 'Print job not found.');
      store.jobs.delete(jobId);
      sendNoContent(res, 204);
      return;
    }
    if (method === 'POST' && pathname === '/api/printer/test') {
      requireAdmin(store, req);
      const image = buildTestLabelPng();
      const result = enqueuePrint(store, { name: 'Test label', designId: null, printedBy: null, copies: 1, images: [image] }, at);
      sendJson(res, 200, result);
      return;
    }

    // -- Mock-only control routes -------------------------------------------
    if (pathname === '/api/__mock/printer' && (method === 'POST' || method === 'GET')) {
      let input: MockPrinterOverrideInput;
      if (method === 'GET') {
        const stateParam = url.searchParams.get('state');
        const reasonParam = url.searchParams.get('reason');
        input = {
          state: parsePrinterStateParam(stateParam),
          reasons: reasonParam ? [reasonParam] : undefined,
        };
      } else {
        input = validateMockPrinterOverride(await readJsonBody(req));
      }
      applyPrinterOverride(store, input);
      sendJson(res, 200, getPrinterStatus(store, at));
      return;
    }
    if (method === 'POST' && pathname === '/api/__mock/reset') {
      resetStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }

    // -- Settings -----------------------------------------------------------
    if (method === 'GET' && pathname === '/api/settings') {
      sendJson(res, 200, store.settings);
      return;
    }
    if (method === 'PUT' && pathname === '/api/admin/settings') {
      requireAdmin(store, req);
      store.settings = validateStudioSettings(await readJsonBody(req));
      sendJson(res, 200, store.settings);
      return;
    }

    // -- Admin auth -----------------------------------------------------------
    if (method === 'GET' && pathname === '/api/admin/state') {
      sendJson(res, 200, { configured: store.adminConfigured, loggedIn: isLoggedIn(store, req) } satisfies AdminState);
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/setup') {
      if (store.adminConfigured) throw new HttpError(409, 'already_configured', 'Admin password is already set.');
      const password = extractPassword(await readJsonBody(req));
      if (password.length < 8) throw new HttpError(400, 'invalid_body', 'Password must be at least 8 characters.');
      store.adminConfigured = true;
      store.adminPassword = password;
      setSessionCookie(res, createSession(store));
      sendJson(res, 200, { configured: true, loggedIn: true } satisfies AdminState);
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/login') {
      const password = extractPassword(await readJsonBody(req));
      if (!store.adminConfigured || password !== store.adminPassword) {
        throw new HttpError(401, 'wrong_password', 'That password is not right.');
      }
      setSessionCookie(res, createSession(store));
      sendJson(res, 200, { configured: true, loggedIn: true } satisfies AdminState);
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/logout') {
      const token = getSessionToken(req);
      if (token) store.adminSessions.delete(token);
      clearSessionCookie(res);
      sendJson(res, 200, { configured: store.adminConfigured, loggedIn: false } satisfies AdminState);
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/password') {
      requireAdmin(store, req);
      const { current, next } = extractPasswordChange(await readJsonBody(req));
      if (current !== store.adminPassword) throw new HttpError(401, 'wrong_password', 'That password is not right.');
      if (next.length < 8) throw new HttpError(400, 'invalid_body', 'New password must be at least 8 characters.');
      store.adminPassword = next;
      sendNoContent(res, 204);
      return;
    }

    // -- Admin printer / system ------------------------------------------------
    if (method === 'PUT' && pathname === '/api/admin/printer') {
      requireAdmin(store, req);
      const input = validatePrinterSettingsInput(await readJsonBody(req));
      if (input.darkness !== undefined) store.printerSettings.darkness = input.darkness;
      if (input.speed !== undefined) store.printerSettings.speed = input.speed;
      sendJson(res, 200, getPrinterStatus(store, at));
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/system') {
      requireAdmin(store, req);
      sendJson(res, 200, buildSystemInfo(store, at));
      return;
    }
    const restartMatch = matchPath('/api/admin/services/:name/restart', pathname);
    if (method === 'POST' && restartMatch) {
      requireAdmin(store, req);
      const name = restartMatch.name ?? '';
      if (!isServiceName(name)) throw new HttpError(400, 'invalid_body', `Unknown service "${name}".`);
      store.serviceState[name] = { since: at.toISOString(), restarts: store.serviceState[name].restarts + 1 };
      sendNoContent(res, 202);
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/reboot') {
      requireAdmin(store, req);
      store.uptimeBaseSeconds = 0;
      store.uptimeAnchor = at;
      sendNoContent(res, 202);
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/logs') {
      requireAdmin(store, req);
      const unit = url.searchParams.get('unit');
      if (!isLogUnit(unit)) {
        throw new HttpError(400, 'invalid_body', 'unit must be one of lprint, eco-studio, eco-printer-health.');
      }
      const linesParam = url.searchParams.get('lines');
      const lines = clampInt(linesParam ? Number(linesParam) : 200, 1, 1000);
      sendJson(res, 200, { lines: buildLogLines(unit, lines, at) });
      return;
    }

    throw new HttpError(404, 'not_found', `No route for ${method} ${pathname}.`);
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

function parsePrinterStateParam(value: string | null): PrinterState | undefined {
  if (value === null) return undefined;
  if (!isPrinterState(value)) {
    throw new HttpError(400, 'invalid_body', 'state must be one of idle, processing, stopped, unreachable.');
  }
  return value;
}

/** Creates the connect middleware that answers every `/api/*` and `/ca.crt` request. */
export function createMockApiHandler(): Connect.NextHandleFunction {
  const store = createStore();
  return (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0] ?? '';
    if (pathname !== '/ca.crt' && !pathname.startsWith('/api/')) {
      next();
      return;
    }
    void routeRequest(store, req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', message: 'Unexpected mock server error.' } satisfies ApiError);
      }
      // eslint-disable-next-line no-console
      console.error('[eco-mock] unhandled error:', err);
    });
  };
}
