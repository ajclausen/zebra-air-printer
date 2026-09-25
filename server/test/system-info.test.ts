import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../src/system/exec.js';
import {
  listAddresses,
  parseHealthCounter,
  parseMeminfo,
  parseNmcliWifi,
  parseSystemctlShow,
  parseSystemdTimestamp,
  SystemInfoService,
} from '../src/system/system-info.js';

describe('system info parsers', () => {
  it('parses /proc/meminfo', () => {
    const text = 'MemTotal:        8245212 kB\nMemFree:         6000000 kB\nMemAvailable:    7123456 kB\n';
    expect(parseMeminfo(text)).toEqual({ totalBytes: 8245212 * 1024, availableBytes: 7123456 * 1024 });
    expect(parseMeminfo('nonsense')).toBeNull();
  });

  it('parses nmcli terse output, including escaped colons', () => {
    expect(parseNmcliWifi('no:Neighbor:40\nyes:ECO\\:Office:78\n')).toEqual({ ssid: 'ECO:Office', signalPercent: 78 });
    expect(parseNmcliWifi('no:Other:30\n')).toEqual({ ssid: null, signalPercent: null });
    expect(parseNmcliWifi('')).toEqual({ ssid: null, signalPercent: null });
  });

  it('parses systemctl show', () => {
    const out = 'ActiveState=active\nSubState=running\nActiveEnterTimestamp=@1790000000\nNRestarts=2\n';
    expect(parseSystemctlShow('lprint', out)).toEqual({
      name: 'lprint',
      active: 'active',
      sub: 'running',
      since: new Date(1_790_000_000_000).toISOString(),
      restarts: 2,
    });
    expect(parseSystemctlShow('eco-studio', 'ActiveState=failed\nSubState=failed\nActiveEnterTimestamp=\nNRestarts=')).toEqual({
      name: 'eco-studio',
      active: 'failed',
      sub: 'failed',
      since: null,
      restarts: null,
    });
  });

  it('parses systemd timestamps in both formats', () => {
    expect(parseSystemdTimestamp('Thu 2026-09-24 14:58:00 UTC')).toBe('2026-09-24T14:58:00.000Z');
    expect(parseSystemdTimestamp('Thu 2026-09-24 14:58:00 -0500')).toBe('2026-09-24T19:58:00.000Z');
    expect(parseSystemdTimestamp('n/a')).toBeNull();
    expect(parseSystemdTimestamp('@0')).toBeNull();
  });

  it('parses eco-printer-health counters; missing file means 0 failures', () => {
    expect(parseHealthCounter('lprint', '2 1790000060 120\n')).toEqual({
      name: 'lprint',
      consecutiveFailures: 2,
      nextActionAt: new Date(1_790_000_060_000).toISOString(),
    });
    expect(parseHealthCounter('studio', null)).toEqual({ name: 'studio', consecutiveFailures: 0, nextActionAt: null });
    expect(parseHealthCounter('network', '0 0 60')).toEqual({ name: 'network', consecutiveFailures: 0, nextActionAt: null });
  });

  it('lists non-loopback addresses, IPv4 first, without link-local IPv6', () => {
    const addresses = listAddresses({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
      wlan0: [
        { address: 'fe80::1', family: 'IPv6', internal: false } as never,
        { address: 'fd00::5', family: 'IPv6', internal: false } as never,
        { address: '192.168.51.242', family: 'IPv4', internal: false } as never,
      ],
    });
    expect(addresses).toEqual(['192.168.51.242', 'fd00::5']);
  });
});

describe('SystemInfoService', () => {
  it('collects from commands and files on a Pi-like system', async () => {
    const run: CommandRunner = async (file, args) => {
      if (file === 'systemctl') {
        return { stdout: `ActiveState=active\nSubState=running\nActiveEnterTimestamp=@1790000000\nNRestarts=${args[1] === 'lprint.service' ? 1 : 0}\n`, stderr: '' };
      }
      if (file === 'nmcli') return { stdout: 'yes:ECO:65\n', stderr: '' };
      if (file === 'dpkg-query') return { stdout: '1.3.1-1+eco1', stderr: '' };
      throw new Error('unexpected');
    };
    const files: Record<string, string> = {
      '/proc/meminfo': 'MemTotal: 8000000 kB\nMemAvailable: 4000000 kB\n',
      '/sys/class/thermal/thermal_zone0/temp': '48750\n',
      '/health/lprint': '3 1790000100 240',
    };
    const service = new SystemInfoService({
      run,
      readText: async (p) => files[p] ?? null,
      dataDir: '/data',
      tlsDir: '/tls',
      healthDir: '/health',
      studioVersion: '0.1.0',
      diskUsage: async () => ({ totalBytes: 100, freeBytes: 40 }),
      networkInterfaces: () => ({}),
    });
    const info = await service.collect();
    expect(info.cpuTempC).toBe(48.8);
    expect(info.memory).toEqual({ totalBytes: 8_192_000_000, availableBytes: 4_096_000_000 });
    expect(info.disk).toEqual({ totalBytes: 100, freeBytes: 40 });
    expect(info.wifi).toEqual({ ssid: 'ECO', signalPercent: 65 });
    expect(info.versions.lprint).toBe('1.3.1-1+eco1');
    expect(info.services.map((s) => [s.name, s.active, s.restarts])).toEqual([
      ['lprint', 'active', 1],
      ['avahi-daemon', 'active', 0],
      ['eco-studio', 'active', 0],
    ]);
    expect(info.health.find((h) => h.name === 'lprint')?.consecutiveFailures).toBe(3);
    expect(info.certificate).toEqual({ notAfter: null, fingerprintSha256: null });
  });
});
