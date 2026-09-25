import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, XIcon } from 'lucide-react';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/controls';
import { errorMessage } from '@/lib/api/client';
import { waitForServerRestart } from '../lib/serverWatch';
import { useReboot } from '../queries';

type RebootPhase = { kind: 'idle' } | { kind: 'rebooting'; startedAt: number } | { kind: 'back'; tookSeconds: number };

interface RebootContextValue {
  phase: RebootPhase;
  requestPending: boolean;
  /** Sends the reboot request. Resolves true when the server accepted it. */
  reboot: () => Promise<boolean>;
  /** Hides the "back online" notice. */
  dismiss: () => void;
}

const RebootContext = createContext<RebootContextValue | null>(null);

/** A reboot takes the site down for about a minute; past this, the banner suggests checking the Pi. */
const SLOW_REBOOT_SECONDS = 180;

export function RebootProvider({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const request = useReboot();
  const [phase, setPhase] = useState<RebootPhase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reboot = useCallback(async () => {
    try {
      await request.mutateAsync();
    } catch (error) {
      toast.error('Could not reboot the Pi', { description: errorMessage(error) });
      return false;
    }
    const startedAt = Date.now();
    setPhase({ kind: 'rebooting', startedAt });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Watch in the background so the caller can close its dialog as soon as the request is accepted.
    waitForServerRestart({ signal: controller.signal, startedAt, confirm: { kind: 'uptime' } }).then(
      () => {
        setPhase({ kind: 'back', tookSeconds: Math.round((Date.now() - startedAt) / 1000) });
        toast.success('The Pi is back online');
        void client.invalidateQueries();
      },
      () => undefined, // Aborted on unmount.
    );
    return true;
  }, [client, request]);

  const dismiss = useCallback(() => setPhase({ kind: 'idle' }), []);
  const value = useMemo(() => ({ phase, requestPending: request.isPending, reboot, dismiss }), [phase, request.isPending, reboot, dismiss]);
  return (
    <RebootContext value={value}>
      {children}
    </RebootContext>
  );
}

export function useRebootMonitor(): RebootContextValue {
  const value = use(RebootContext);
  if (!value) throw new Error('useRebootMonitor must be used inside RebootProvider');
  return value;
}

function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function RebootingBanner({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedSeconds(startedAt);
  const slow = elapsed >= SLOW_REBOOT_SECONDS;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-ink">
      <Spinner className="mt-0.5 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Rebooting…</p>
        <p className="text-ink-2">
          {slow
            ? 'This is taking longer than usual. Check that the Pi has power and is connected to Wi-Fi. This page keeps checking.'
            : 'The printer and this site will be back in about a minute. This page checks every few seconds.'}
        </p>
      </div>
      <span className="tabular shrink-0 text-xs text-ink-3">{elapsed} s</span>
    </div>
  );
}

/** Status banner shown at the top of every section while a reboot is in progress. */
export function RebootBanner() {
  const { phase, dismiss } = useRebootMonitor();

  let content: React.ReactNode = null;
  if (phase.kind === 'rebooting') {
    content = <RebootingBanner startedAt={phase.startedAt} />;
  } else if (phase.kind === 'back') {
    content = (
      <div className="flex items-center gap-3 rounded-lg border border-ok/25 bg-ok-soft px-4 py-3 text-sm text-ink">
        <CheckCircle2Icon className="size-4 shrink-0 text-ok" aria-hidden />
        <p className="flex-1">
          <span className="font-medium">The Pi is back online.</span> <span className="text-ink-2">It took {phase.tookSeconds} seconds.</span>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="inline-flex size-6 items-center justify-center rounded-md text-ink-3 outline-none hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className={content ? 'mb-6' : undefined}>
      {content}
    </div>
  );
}
