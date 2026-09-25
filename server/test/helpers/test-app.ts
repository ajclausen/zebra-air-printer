import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { AppContext } from '../../src/context.js';
import { openDatabase } from '../../src/db/database.js';
import { FakePrinter } from '../../src/printer/fake-printer.js';
import type { Printer } from '../../src/printer/printer.js';
import type { CommandRunner, TextReader } from '../../src/system/exec.js';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  dataDir: string;
  clock: { now: Date; advance(ms: number): void };
  commands: Array<{ file: string; args: string[] }>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  printer?: Printer;
  run?: CommandRunner;
  readText?: TextReader;
  staticDir?: string | null;
  tlsDir?: string;
  allowedOrigins?: string[];
  /** Build the printer once the data dir exists (e.g. a FakePrinter writing captures there). */
  makePrinter?: (dataDir: string, clock: { now: Date }) => Printer;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'eco-studio-test-'));
  const db = openDatabase(path.join(dataDir, 'studio.db'));
  const clock = {
    now: new Date('2026-09-25T12:00:00.000Z'),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  const commands: Array<{ file: string; args: string[] }> = [];
  const defaultRun: CommandRunner = async (file, args) => {
    commands.push({ file, args });
    throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });
  };
  const printer =
    options.printer ??
    options.makePrinter?.(dataDir, clock) ??
    new FakePrinter({ outputDir: path.join(dataDir, 'fake-printer'), logger: { info() {} }, jobDurationMs: 10 });

  const { app, ctx } = await buildApp({
    db,
    printer,
    dataDir,
    tlsDir: options.tlsDir ?? path.join(dataDir, 'tls'),
    healthDir: path.join(dataDir, 'health'),
    captureDir: path.join(dataDir, 'captures'),
    staticDir: options.staticDir ?? null,
    allowedOrigins: options.allowedOrigins ?? [],
    version: '9.9.9-test',
    run: options.run
      ? async (file, args, opts) => {
          commands.push({ file, args });
          return options.run!(file, args, opts);
        }
      : defaultRun,
    readText: options.readText ?? (async () => null),
    now: () => clock.now,
    deferredCommandDelayMs: 0,
  });

  return {
    app,
    ctx,
    dataDir,
    clock,
    commands,
    async close() {
      await app.close();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Extracts `name=value` for a Set-Cookie header, suitable for a Cookie request header. */
export function cookieFrom(response: LightMyRequestResponse, name = 'eco_admin'): string | undefined {
  const cookie = response.cookies.find((c) => c.name === name);
  return cookie ? `${cookie.name}=${cookie.value}` : undefined;
}

/** Sets up the admin password and returns the session cookie. */
export async function loginAsAdmin(app: FastifyInstance, password = 'correct horse'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/setup', payload: { password } });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  return cookieFrom(res)!;
}
