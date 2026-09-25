import { readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_PRINTER_URI = 'ipp://127.0.0.1:8000/ipp/print/Zebra_ZP_450';

export interface Config {
  production: boolean;
  dataDir: string;
  /** An ipp:// URI, or "fake" for the development printer. */
  printerUri: string;
  httpPort: number;
  httpsPort: number;
  tlsDir: string;
  /** Built web app, or null to serve the API only. */
  staticDir: string | null;
  healthDir: string;
  /** Extra origins allowed to make state-changing requests (e.g. a Vite dev server). */
  allowedOrigins: string[];
  /** Simulated printer-state-reasons for the fake printer (ECO_FAKE_PRINTER_REASONS, comma separated). */
  fakePrinterReasons: string[];
  host: string;
}

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${name} must be a port number, got "${value}"`);
  return n;
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Reads configuration from the environment. Production (NODE_ENV=production) defaults match
 * the systemd unit; development defaults run HTTP only on 5174 with the fake printer.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.ECO_DATA_DIR || (production ? '/var/lib/eco-studio' : './data'));
  const printerUri = env.ECO_PRINTER_URI || (production ? DEFAULT_PRINTER_URI : 'fake');
  if (printerUri !== 'fake' && !/^ipps?:\/\//.test(printerUri)) {
    throw new Error(`ECO_PRINTER_URI must be an ipp:// URI or "fake", got "${printerUri}"`);
  }
  return {
    production,
    dataDir,
    printerUri,
    httpPort: port(env.ECO_HTTP_PORT, production ? 80 : 5174, 'ECO_HTTP_PORT'),
    httpsPort: port(env.ECO_HTTPS_PORT, 443, 'ECO_HTTPS_PORT'),
    tlsDir: path.resolve(env.ECO_TLS_DIR || path.join(dataDir, 'tls')),
    staticDir: env.ECO_STATIC_DIR ? path.resolve(env.ECO_STATIC_DIR) : null,
    healthDir: env.ECO_HEALTH_DIR || '/run/eco-printer-health',
    allowedOrigins: list(env.ECO_ALLOWED_ORIGINS).concat(
      production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    ),
    fakePrinterReasons: list(env.ECO_FAKE_PRINTER_REASONS),
    host: env.ECO_HOST || '::',
  };
}

/** Version from server/package.json. */
export function studioVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
