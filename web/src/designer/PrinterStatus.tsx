import type { PrinterStatus as PrinterStatusData, QueueJob } from '@eco/shared';
import { PrinterIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner, StatusDot } from '@/components/ui/controls';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { errorMessage } from '@/lib/api/client';
import { useCancelJob, usePrinterStatus } from '@/lib/api/queries';
import { cn, formatRelativeTime } from '@/lib/utils';

type Tone = 'ok' | 'cobalt' | 'warn' | 'bad' | 'neutral';

interface Summary {
  tone: Tone;
  label: string;
  detail: string | null;
  pulse: boolean;
}

/** Plain-language names for common IPP printer-state-reasons. */
const REASONS: Record<string, string> = {
  'media-empty': 'Out of labels',
  'media-jam': 'Label jam',
  'media-needed': 'Load labels',
  'cover-open': 'Lid open',
  'door-open': 'Lid open',
  offline: 'Offline',
  paused: 'Paused',
  'marker-supply-empty': 'Out of supplies',
  'printer-not-responding': 'Not responding',
};

export function describeReason(reason: string): string {
  const base = reason.replace(/-(error|warning|report)$/, '');
  return REASONS[base] ?? base.replace(/-/g, ' ');
}

export function summarizePrinter(status: PrinterStatusData | undefined, error: unknown): Summary {
  if (error || !status) {
    return error
      ? { tone: 'bad', label: 'Server offline', detail: 'Label Studio is not responding. Check the Pi is on and connected.', pulse: false }
      : { tone: 'neutral', label: 'Checking printer', detail: null, pulse: true };
  }
  const active = status.queue.filter((j) => j.state === 'processing' || j.state === 'pending' || j.state === 'held').length;
  switch (status.state) {
    case 'unreachable':
      return { tone: 'bad', label: 'Printer unreachable', detail: status.message, pulse: false };
    case 'stopped':
      return {
        tone: 'warn',
        label: status.reasons.length ? describeReason(status.reasons[0]!) : 'Needs attention',
        detail: status.message ?? 'The printer has stopped.',
        pulse: false,
      };
    case 'processing':
      return { tone: 'cobalt', label: active > 1 ? `Printing · ${active} jobs` : 'Printing', detail: status.message, pulse: true };
    default:
      return status.reasons.length || status.message
        ? { tone: 'warn', label: status.reasons.length ? describeReason(status.reasons[0]!) : 'Ready', detail: status.message, pulse: false }
        : { tone: 'ok', label: 'Ready', detail: null, pulse: false };
  }
}

const toneRing: Record<Tone, string> = {
  ok: 'hover:bg-ink/[0.05]',
  cobalt: 'bg-cobalt-soft text-cobalt-strong hover:bg-cobalt-soft/80',
  warn: 'bg-warn-soft text-warn hover:bg-warn-soft/80',
  bad: 'bg-bad-soft text-bad hover:bg-bad-soft/80',
  neutral: 'hover:bg-ink/[0.05]',
};

const JOB_STATE: Record<QueueJob['state'], string> = {
  pending: 'Waiting',
  held: 'Held',
  processing: 'Printing',
  stopped: 'Stopped',
  canceled: 'Canceled',
  aborted: 'Failed',
  completed: 'Done',
};

function QueueRow({ job }: { job: QueueJob }) {
  const cancel = useCancelJob();
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{job.name || `Job ${job.id}`}</div>
        <div className="text-xs text-ink-3">
          {JOB_STATE[job.state]}
          {job.source === 'airprint' ? ' · AirPrint' : ''}
          {job.createdAt ? ` · ${formatRelativeTime(job.createdAt)}` : ''}
        </div>
      </div>
      {job.state === 'processing' && <Spinner className="size-3.5 text-cobalt" />}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Cancel ${job.name || `job ${job.id}`}`}
        disabled={cancel.isPending}
        onClick={() =>
          cancel.mutate(job.id, {
            onSuccess: () => toast.success(`Canceled “${job.name || `job ${job.id}`}”`),
            onError: (error) => toast.error('Could not cancel the job', { description: errorMessage(error) }),
          })
        }
      >
        <XIcon />
      </Button>
    </li>
  );
}

/** Top-bar pill showing printer state, with a popover for details and the queue. */
export function PrinterStatusPill({ compact = false }: { compact?: boolean }) {
  const { data, error } = usePrinterStatus();
  const summary = summarizePrinter(data, error);
  const queue = data?.queue ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
            toneRing[summary.tone],
          )}
          aria-label={`Printer: ${summary.label}. Show printer details`}
          data-testid="printer-status"
        >
          <StatusDot tone={summary.tone} pulse={summary.pulse} />
          {!compact && <span className="max-w-40 truncate">{summary.label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-start gap-3 border-b border-line p-4" aria-live="polite">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface">
            <PrinterIcon className="size-5 text-ink-2" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <StatusDot tone={summary.tone} pulse={summary.pulse} />
              {summary.label}
            </div>
            <p className="mt-0.5 text-xs text-ink-3">{summary.detail ?? `${data?.name.replace(/_/g, ' ') ?? 'Zebra ZP 450'} · 4 × 6 in labels`}</p>
          </div>
        </div>
        <div className="px-4 pt-3 pb-2">
          <div className="text-xs font-medium text-ink-3">Queue</div>
          {queue.length === 0 ? (
            <p className="py-3 text-sm text-ink-3">Nothing waiting to print.</p>
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((job) => (
                <QueueRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </div>
        {data?.checkedAt && <div className="border-t border-line px-4 py-2 text-2xs text-ink-4">Checked {formatRelativeTime(data.checkedAt)}</div>}
      </PopoverContent>
    </Popover>
  );
}
