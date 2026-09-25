// Gathers SystemInfo for the admin overview. Every probe degrades to null/defaults on
// failure (missing binaries on macOS dev machines, timeouts, parse errors).

import { X509Certificate } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HealthCheck, ServiceName, ServiceStatus, SystemInfo } from '@eco/shared';
import type { CommandRunner, TextReader } from './exec.js';

export const SERVICE_NAMES: readonly ServiceName[] = ['lprint', 'avahi-daemon', 'eco-studio'];
export const HEALTH_CHECK_NAMES: ReadonlyArray<HealthCheck['name']> = ['network', 'lprint', 'advertise', 'studio'];

export interface SystemInfoDeps {
  run: CommandRunner;
  readText: TextReader;
  dataDir: string;
  tlsDir: string;
  healthDir: string;
  studioVersion: string;
  /** Overridable for tests. */
  networkInterfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  diskUsage?: (dir: string) => Promise<{ totalBytes: number; freeBytes: number }>;
}

export function parseMeminfo(text: string): { totalBytes: number; availableBytes: number } | null {
  const kb = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return match ? Number(match[1]) * 1024 : null;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  return total !== null && available !== null ? { totalBytes: total, availableBytes: available } : null;
}

/** Splits an nmcli terse line on unescaped colons (nmcli escapes ':' and '\' in values). */
export function splitNmcliLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) {
      current += line[++i];
    } else if (c === ':') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

export function parseNmcliWifi(stdout: string): { ssid: string | null; signalPercent: number | null } {
  for (const line of stdout.split('\n')) {
    const [active, ssid, signal] = splitNmcliLine(line.trim());
    if (active === 'yes') {
      const n = Number(signal);
      return { ssid: ssid || null, signalPercent: signal !== undefined && signal !== '' && Number.isFinite(n) ? n : null };
    }
  }
  return { ssid: null, signalPercent: null };
}

export function parseSystemctlShow(name: ServiceName, stdout: string): ServiceStatus {
  const props = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) props.set(line.slice(0, eq), line.slice(eq + 1).trim());
  }
  const restarts = props.get('NRestarts');
  return {
    name,
    active: props.get('ActiveState') || 'unknown',
    sub: props.get('SubState') || 'unknown',
    since: parseSystemdTimestamp(props.get('ActiveEnterTimestamp')),
    restarts: restarts !== undefined && restarts !== '' && Number.isFinite(Number(restarts)) ? Number(restarts) : null,
  };
}

/** Accepts `@<unix seconds>` (--timestamp=unix) or systemd's default "Thu 2026-09-25 14:58:00 UTC". */
export function parseSystemdTimestamp(value: string | undefined): string | null {
  if (!value || value === 'n/a' || value === '0') return null;
  if (value.startsWith('@')) {
    const seconds = Number(value.slice(1));
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
  }
  const match = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (UTC|[+-]\d{2}:?\d{2}))?/.exec(value);
  if (!match) return null;
  const zone = !match[3] || match[3] === 'UTC' ? 'Z' : match[3];
  const date = new Date(`${match[1]}T${match[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseHealthCounter(name: HealthCheck['name'], text: string | null): HealthCheck {
  const [fails, next] = (text ?? '').trim().split(/\s+/);
  const failures = Number(fails);
  const nextEpoch = Number(next);
  return {
    name,
    consecutiveFailures: Number.isInteger(failures) && failures > 0 ? failures : 0,
    nextActionAt: Number.isFinite(nextEpoch) && nextEpoch > 0 ? new Date(nextEpoch * 1000).toISOString() : null,
  };
}

export function listAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const out: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.internal) continue;
      // Link-local IPv6 addresses are noise for someone trying to reach the Pi.
      if (info.family === 'IPv6' && info.address.toLowerCase().startsWith('fe80:')) continue;
      out.push(info.address);
    }
  }
  // IPv4 first, then IPv6.
  return out.sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')));
}

async function statfsUsage(dir: string): Promise<{ totalBytes: number; freeBytes: number }> {
  const s = await statfs(dir);
  return { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) };
}

export class SystemInfoService {
  constructor(private readonly deps: SystemInfoDeps) {}

  async collect(): Promise<SystemInfo> {
    const [memory, disk, cpuTempC, wifi, services, health, lprint, certificate] = await Promise.all([
      this.memory(),
      this.disk(),
      this.cpuTemp(),
      this.wifi(),
      Promise.all(SERVICE_NAMES.map((name) => this.service(name))),
      Promise.all(HEALTH_CHECK_NAMES.map((name) => this.healthCheck(name))),
      this.lprintVersion(),
      this.certificate(),
    ]);
    const load = os.loadavg();
    return {
      hostname: os.hostname(),
      addresses: listAddresses((this.deps.networkInterfaces ?? os.networkInterfaces)()),
      uptimeSeconds: Math.round(os.uptime()),
      loadAverage: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
      memory,
      disk,
      cpuTempC,
      wifi,
      services,
      health,
      versions: { studio: this.deps.studioVersion, node: process.versions.node, lprint },
      certificate,
    };
  }

  async service(name: ServiceName): Promise<ServiceStatus> {
    try {
      const { stdout } = await this.deps.run('systemctl', [
        'show',
        `${name}.service`,
        '--timestamp=unix',
        '-p',
        'ActiveState,SubState,ActiveEnterTimestamp,NRestarts',
      ]);
      return parseSystemctlShow(name, stdout);
    } catch {
      return { name, active: 'unknown', sub: 'unknown', since: null, restarts: null };
    }
  }

  private async memory(): Promise<SystemInfo['memory']> {
    const text = await this.deps.readText('/proc/meminfo');
    return (text && parseMeminfo(text)) || { totalBytes: os.totalmem(), availableBytes: os.freemem() };
  }

  private async disk(): Promise<SystemInfo['disk']> {
    try {
      return await (this.deps.diskUsage ?? statfsUsage)(this.deps.dataDir);
    } catch {
      return { totalBytes: 0, freeBytes: 0 };
    }
  }

  private async cpuTemp(): Promise<number | null> {
    const text = await this.deps.readText('/sys/class/thermal/thermal_zone0/temp');
    const milli = Number(text?.trim());
    return text && Number.isFinite(milli) ? Math.round(milli / 100) / 10 : null;
  }

  private async wifi(): Promise<SystemInfo['wifi']> {
    try {
      const { stdout } = await this.deps.run('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi']);
      return parseNmcliWifi(stdout);
    } catch {
      return null;
    }
  }

  private async healthCheck(name: HealthCheck['name']): Promise<HealthCheck> {
    return parseHealthCounter(name, await this.deps.readText(path.join(this.deps.healthDir, name)));
  }

  private async lprintVersion(): Promise<string | null> {
    try {
      const { stdout } = await this.deps.run('dpkg-query', ['-W', '-f=${Version}', 'lprint']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async certificate(): Promise<SystemInfo['certificate']> {
    const pem = await this.deps.readText(path.join(this.deps.tlsDir, 'server.crt'));
    if (!pem) return { notAfter: null, fingerprintSha256: null };
    try {
      // server.crt is leaf + CA chain; X509Certificate parses the first (leaf) certificate.
      const cert = new X509Certificate(pem);
      return { notAfter: new Date(cert.validTo).toISOString(), fingerprintSha256: cert.fingerprint256 };
    } catch {
      return { notAfter: null, fingerprintSha256: null };
    }
  }
}
