// Service restarts, reboot, and journal access. These run as the unprivileged eco-studio
// user; systemctl asks polkit over D-Bus, and deploy/50-eco-studio.rules allows exactly
// these actions for that user.

import type { ServiceName } from '@eco/shared';
import type { CommandRunner } from './exec.js';

export const LOG_UNITS = ['lprint', 'eco-studio', 'eco-printer-health'] as const;
export type LogUnit = (typeof LOG_UNITS)[number];

export class SystemControl {
  constructor(private readonly run: CommandRunner) {}

  async restart(service: ServiceName): Promise<void> {
    await this.run('systemctl', ['restart', `${service}.service`], { timeoutMs: 60_000 });
  }

  async reboot(): Promise<void> {
    await this.run('systemctl', ['reboot'], { timeoutMs: 30_000 });
  }

  async logs(unit: LogUnit, lines: number): Promise<string[]> {
    const { stdout } = await this.run(
      'journalctl',
      ['-u', `${unit}.service`, '-n', String(lines), '--no-pager', '-o', 'short-iso'],
      { timeoutMs: 10_000 },
    );
    return stdout.split('\n').filter((line) => line !== '');
  }
}
