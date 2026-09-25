// Network listeners: HTTPS (app) + HTTP (redirect) in production, HTTP only in dev.

import { readFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import path from 'node:path';

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
}

/** Loads server.key and server.crt (leaf + chain), or null when either is missing. */
export function loadTls(tlsDir: string): TlsMaterial | null {
  try {
    return {
      key: readFileSync(path.join(tlsDir, 'server.key')),
      cert: readFileSync(path.join(tlsDir, 'server.crt')),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** Paths answered over plain HTTP so devices can fetch the CA before trusting it, and health checks work either way. */
export const PLAIN_HTTP_PATHS = new Set(['/ca.crt', '/api/health']);

const HOST_HEADER = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/;

/** Host name (without port) from the Host header, falling back to the mDNS name for anything malformed. */
export function redirectHostname(hostHeader: string | undefined, fallback = 'eco-printer.local'): string {
  const match = hostHeader ? HOST_HEADER.exec(hostHeader) : null;
  return match ? match[1]! : fallback;
}

/**
 * Handler for the plain-HTTP port: passes /ca.crt and /api/health to the app and redirects
 * everything else to the same host and path over HTTPS.
 */
export function createRedirectHandler(passthrough: RequestHandler, httpsPort: number): RequestHandler {
  return (req, res) => {
    const url = req.url && req.url.startsWith('/') ? req.url : '/';
    const pathname = url.split('?')[0]!;
    if (PLAIN_HTTP_PATHS.has(pathname)) {
      passthrough(req, res);
      return;
    }
    const port = httpsPort === 443 ? '' : `:${httpsPort}`;
    const location = `https://${redirectHostname(req.headers.host)}${port}${url}`;
    // 308 keeps the method and body for non-GET requests.
    const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
    res.writeHead(status, { location, 'cache-control': 'max-age=3600', 'content-length': '0' });
    res.end();
  };
}

/** Creates the main server for Fastify's serverFactory and remembers its request handler. */
export function mainServerFactory(tls: TlsMaterial | null) {
  let handler: RequestHandler | null = null;
  return {
    factory(h: RequestHandler): http.Server {
      handler = h;
      return tls ? https.createServer({ key: tls.key, cert: tls.cert }, h) : http.createServer(h);
    },
    handler(): RequestHandler {
      if (!handler) throw new Error('Server has not been created yet');
      return handler;
    },
  };
}

/** Swaps the certificate on a running HTTPS server (SIGHUP). Returns false if the files are missing. */
export function reloadTls(server: https.Server, tlsDir: string): boolean {
  const next = loadTls(tlsDir);
  if (!next) return false;
  server.setSecureContext({ key: next.key, cert: next.cert });
  return true;
}
