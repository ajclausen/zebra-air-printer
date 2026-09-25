import type {
  AdminState,
  ApiError as ApiErrorBody,
  Design,
  DesignInput,
  DesignKind,
  DesignSummary,
  HistoryEntry,
  PrinterSettingsInput,
  PrinterStatus,
  PrintRequest,
  PrintResponse,
  ServiceName,
  StudioSettings,
  SystemInfo,
} from '@eco/shared';

/** Error thrown for any non-2xx API response. Carries the server's ApiError body when present. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).error === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}

async function request<T>(method: Method, path: string, options: { body?: unknown; query?: Query } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach Label Studio. Check that you are on the office network.');
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body (e.g. proxy error page); fall through to a generic message.
    }
    if (isApiErrorBody(body)) throw new ApiError(response.status, body.error, body.message);
    throw new ApiError(response.status, `http_${response.status}`, `Request failed (${response.status} ${response.statusText}).`);
  }

  if (response.status === 204 || response.status === 202) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface DesignListQuery {
  kind?: DesignKind;
  q?: string;
  category?: string;
  deleted?: boolean;
}

/** Typed client for every route in the @eco/shared contract. */
export const api = {
  designs: {
    list: (query: DesignListQuery = {}) => request<DesignSummary[]>('GET', '/api/designs', { query: { ...query } }),
    get: (id: string) => request<Design>('GET', `/api/designs/${encodeURIComponent(id)}`),
    create: (input: DesignInput) => request<Design>('POST', '/api/designs', { body: input }),
    update: (id: string, input: DesignInput) => request<Design>('PUT', `/api/designs/${encodeURIComponent(id)}`, { body: input }),
    duplicate: (id: string) => request<Design>('POST', `/api/designs/${encodeURIComponent(id)}/duplicate`),
    remove: (id: string) => request<void>('DELETE', `/api/designs/${encodeURIComponent(id)}`),
    restore: (id: string) => request<Design>('POST', `/api/designs/${encodeURIComponent(id)}/restore`),
    purge: (id: string) => request<void>('DELETE', `/api/designs/${encodeURIComponent(id)}`, { query: { purge: 1 } }),
  },

  print: (body: PrintRequest) => request<PrintResponse>('POST', '/api/print', { body }),

  history: {
    list: (query: { limit?: number; before?: string } = {}) => request<HistoryEntry[]>('GET', '/api/history', { query }),
    reprint: (id: string) => request<PrintResponse>('POST', `/api/history/${encodeURIComponent(id)}/reprint`),
    imageUrl: (id: string, index: number) => `/api/history/${encodeURIComponent(id)}/images/${index}.png`,
  },

  printer: {
    status: () => request<PrinterStatus>('GET', '/api/printer'),
    cancelJob: (jobId: number) => request<void>('DELETE', `/api/printer/jobs/${jobId}`),
    testPrint: () => request<PrintResponse>('POST', '/api/printer/test'),
  },

  settings: {
    get: () => request<StudioSettings>('GET', '/api/settings'),
    update: (settings: StudioSettings) => request<StudioSettings>('PUT', '/api/admin/settings', { body: settings }),
  },

  admin: {
    state: () => request<AdminState>('GET', '/api/admin/state'),
    setup: (password: string) => request<AdminState>('POST', '/api/admin/setup', { body: { password } }),
    login: (password: string) => request<AdminState>('POST', '/api/admin/login', { body: { password } }),
    logout: () => request<AdminState>('POST', '/api/admin/logout'),
    changePassword: (current: string, next: string) => request<void>('POST', '/api/admin/password', { body: { current, next } }),
    system: () => request<SystemInfo>('GET', '/api/admin/system'),
    restartService: (name: ServiceName) => request<void>('POST', `/api/admin/services/${name}/restart`),
    reboot: () => request<void>('POST', '/api/admin/reboot'),
    logs: (unit: LogUnit, lines = 200) => request<{ lines: string[] }>('GET', '/api/admin/logs', { query: { unit, lines } }),
    updatePrinter: (input: PrinterSettingsInput) => request<PrinterStatus>('PUT', '/api/admin/printer', { body: input }),
  },

  health: () => request<{ ok: true; version: string }>('GET', '/api/health'),
} as const;

export type LogUnit = 'lprint' | 'eco-studio' | 'eco-printer-health';
export const LOG_UNITS: readonly LogUnit[] = ['lprint', 'eco-studio', 'eco-printer-health'];

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
