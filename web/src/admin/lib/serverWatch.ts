import { api } from '@/lib/api/client';

export const HEALTH_POLL_MS = 3_000;

export interface WaitForServerOptions {
  signal: AbortSignal;
  /** When the restart was requested (ms since epoch). */
  startedAt: number;
  /**
   * How to decide the server is back when we never saw it go down (a fast
   * restart can fall between two polls):
   * - 'quiet-period': it answered continuously for this long after the request.
   * - 'uptime': the Pi's uptime is shorter than the time since the request.
   */
  confirm: { kind: 'quiet-period'; ms: number } | { kind: 'uptime' };
  onPoll?: (ok: boolean) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function healthOk(): Promise<boolean> {
  try {
    await api.health();
    return true;
  } catch {
    return false;
  }
}

async function uptimeShowsRestart(startedAt: number): Promise<boolean> {
  try {
    const system = await api.admin.system();
    return system.uptimeSeconds <= (Date.now() - startedAt) / 1000 + 5;
  } catch {
    return false;
  }
}

/**
 * Polls GET /api/health until the server has restarted and answers again.
 * Resolves when it is back; rejects only when the signal aborts.
 */
export async function waitForServerRestart({ signal, startedAt, confirm, onPoll }: WaitForServerOptions): Promise<void> {
  let sawDown = false;
  for (;;) {
    await sleep(HEALTH_POLL_MS, signal);
    const ok = await healthOk();
    onPoll?.(ok);
    if (!ok) {
      sawDown = true;
      continue;
    }
    if (sawDown) return;
    if (confirm.kind === 'quiet-period' && Date.now() - startedAt >= confirm.ms) return;
    if (confirm.kind === 'uptime' && (await uptimeShowsRestart(startedAt))) return;
  }
}
