import type { PrinterStatus } from '@eco/shared';
import { AlertTriangleIcon, CheckIcon, PrinterIcon, UnplugIcon } from 'lucide-react';
import { Badge } from '@/components/ui/controls';
import { usePrinterStatus } from '@/lib/api/queries';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Panel } from '../components/layout';
import { ErrorState, Skeleton } from '../components/states';
import { humanizeReason, printerStateMeta, reasonTone, type Tone } from '../lib/format';
import { QueueList } from './QueueList';
import { TestPrintButton } from './TestPrintButton';

const glyphClass: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-3',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-paper text-bad shadow-[0_0_0_1px_rgb(196_43_28/0.18)]',
  cobalt: 'bg-cobalt-soft text-cobalt',
};

function StateGlyph({ status }: { status: PrinterStatus }) {
  const { tone } = printerStateMeta[status.state];
  const Icon = { idle: CheckIcon, processing: PrinterIcon, stopped: AlertTriangleIcon, unreachable: UnplugIcon }[status.state];
  return (
    <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', glyphClass[tone])}>
      <Icon className={cn('size-5', status.state === 'processing' && 'animate-pulse-dot')} aria-hidden />
    </div>
  );
}

/** "na_index-4x6_4x6in" -> "4 × 6 in". Falls back to the raw media name. */
function formatMedia(media: string): string {
  return /4x6/.test(media) ? '4 × 6 in' : media;
}

function StatusSummary({ status }: { status: PrinterStatus }) {
  const meta = printerStateMeta[status.state];
  const details = [status.name, status.mediaReady ? `${formatMedia(status.mediaReady)} labels loaded` : null].filter(Boolean);
  return (
    <div className="min-w-0 flex-1">
      <div aria-live="polite" aria-atomic="true">
        <h2 className="text-xl font-semibold tracking-[-0.015em] text-ink">{meta.label}</h2>
        <p className="mt-0.5 text-sm text-ink-2">{status.message ?? meta.fallback}</p>
      </div>
      {status.reasons.length > 0 && (
        <ul aria-label="Printer reasons" className="mt-2.5 flex flex-wrap gap-1.5">
          {status.reasons.map((reason) => (
            <li key={reason}>
              <Badge tone={reasonTone(reason)} title={reason}>
                {humanizeReason(reason)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-3">
        {details.join(' · ')}
        {details.length > 0 && ' · '}
        <span title={new Date(status.checkedAt).toLocaleString()}>Checked {formatRelativeTime(status.checkedAt)}</span>
      </p>
    </div>
  );
}

function needsAttention(status: PrinterStatus): boolean {
  return status.state === 'stopped' || status.state === 'unreachable';
}

function PanelSkeleton() {
  return (
    <div role="status" aria-label="Loading printer status" className="flex gap-4 p-5">
      <Skeleton className="size-11 rounded-full" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
    </div>
  );
}

/** The prominent printer card at the top of the overview: state, message, reasons, and the queue. */
export function PrinterStatusPanel() {
  const printer = usePrinterStatus();

  return (
    <Panel aria-label="Printer" className={cn(printer.data && needsAttention(printer.data) && 'border-bad/30')}>
      {printer.isPending ? (
        <PanelSkeleton />
      ) : printer.isError ? (
        <ErrorState title="Could not check the printer" error={printer.error} onRetry={() => void printer.refetch()} />
      ) : (
        <>
          <div className={cn('flex flex-col gap-4 rounded-t-lg p-5 sm:flex-row sm:items-start', needsAttention(printer.data) && 'bg-bad-soft/45')}>
            <div className="flex min-w-0 flex-1 gap-4">
              <StateGlyph status={printer.data} />
              <StatusSummary status={printer.data} />
            </div>
            <TestPrintButton className="self-start" />
          </div>
          <QueueList jobs={printer.data.queue} />
        </>
      )}
    </Panel>
  );
}
