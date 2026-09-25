// Entry point: node server/dist/main.js

import http from 'node:http';
import type https from 'node:https';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig, studioVersion } from './config.js';
import { openDatabase } from './db/database.js';
import { IppClient } from './ipp/client.js';
import { FakePrinter } from './printer/fake-printer.js';
import { IppPrinter } from './printer/ipp-printer.js';
import type { Printer } from './printer/printer.js';
import { createRedirectHandler, loadTls, mainServerFactory } from './server.js';
import { readText, runCommand } from './system/exec.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function listen(server: http.Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const version = studioVersion();
  const db = openDatabase(path.join(config.dataDir, 'studio.db'));
  const tls = loadTls(config.tlsDir);
  const servers = mainServerFactory(tls);

  let log: FastifyBaseLogger | undefined;
  const printer: Printer =
    config.printerUri === 'fake'
      ? new FakePrinter({
          outputDir: path.join(config.dataDir, 'fake-printer'),
          reasons: config.fakePrinterReasons,
          logger: { info: (obj, msg) => log?.info(obj, msg) },
        })
      : new IppPrinter(new IppClient(config.printerUri));

  const { app, ctx } = await buildApp({
    db,
    printer,
    dataDir: config.dataDir,
    tlsDir: config.tlsDir,
    healthDir: config.healthDir,
    staticDir: config.staticDir,
    allowedOrigins: config.allowedOrigins,
    version,
    run: runCommand,
    readText,
    fastify: {
      logger: { level: 'info' },
      serverFactory: servers.factory as never,
      // Keep-alive sockets would otherwise hold shutdown open.
      forceCloseConnections: true,
    },
  });
  log = app.log;

  const mainPort = tls ? config.httpsPort : config.httpPort;
  try {
    await app.listen({ port: mainPort, host: config.host });
  } catch (err) {
    // '::' fails on hosts with IPv6 disabled; fall back to IPv4 only.
    if ((err as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT' || config.host !== '::') throw err;
    config.host = '0.0.0.0';
    await app.listen({ port: mainPort, host: config.host });
  }

  let redirectServer: http.Server | null = null;
  if (tls) {
    redirectServer = http.createServer(createRedirectHandler(servers.handler(), config.httpsPort));
    await listen(redirectServer, config.httpPort, config.host);
    app.log.info({ httpPort: config.httpPort, httpsPort: config.httpsPort }, 'serving HTTPS with HTTP redirect');
  } else {
    app.log.warn({ tlsDir: config.tlsDir, httpPort: config.httpPort }, 'no TLS certificate found; serving HTTP only');
  }
  app.log.info(
    { version, printer: config.printerUri, dataDir: config.dataDir, staticDir: config.staticDir },
    'ECO Label Studio started',
  );

  const housekeeping = async () => {
    try {
      const pruned = await ctx.retention.prune();
      const sessions = ctx.auth.pruneExpiredSessions();
      app.log.info({ ...pruned, expiredSessions: sessions }, 'housekeeping done');
    } catch (err) {
      app.log.error({ err }, 'housekeeping failed');
    }
  };
  void housekeeping();
  const housekeepingTimer = setInterval(() => void housekeeping(), DAY_MS);
  housekeepingTimer.unref();

  process.on('SIGHUP', () => {
    if (!tls) return;
    const next = loadTls(config.tlsDir);
    if (!next) {
      app.log.error('SIGHUP: TLS files missing; keeping the current certificate');
      return;
    }
    (app.server as unknown as https.Server).setSecureContext({ key: next.key, cert: next.cert });
    app.log.info('SIGHUP: TLS certificate reloaded');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    clearInterval(housekeepingTimer);
    try {
      redirectServer?.closeAllConnections();
      await Promise.all([
        app.close(),
        new Promise<void>((resolve) => (redirectServer ? redirectServer.close(() => resolve()) : resolve())),
      ]);
      db.close();
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('ECO Label Studio failed to start:', err);
  process.exit(1);
});
