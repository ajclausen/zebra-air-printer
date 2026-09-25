import { RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented, Spinner, Switch } from '@/components/ui/controls';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/menus';
import { errorMessage, LOG_UNITS, type LogUnit } from '@/lib/api/client';
import { pluralize } from '@/lib/utils';
import { Panel, SectionHeader } from '../components/layout';
import { ErrorState, Skeleton } from '../components/states';
import { LogViewer } from '../logs/LogViewer';
import { useLogs } from '../queries';

type LineCount = '100' | '200' | '500';
const LINE_COUNTS: LineCount[] = ['100', '200', '500'];

const UNIT_DESCRIPTIONS: Record<LogUnit, string> = {
  lprint: 'The printer server: jobs, printer state, and AirPrint.',
  'eco-studio': 'This website: requests, prints, and admin actions.',
  'eco-printer-health': 'The minute-by-minute health check and its repairs.',
};

const SKELETON_WIDTHS = ['w-[70%]', 'w-[55%]', 'w-[82%]', 'w-[64%]', 'w-[48%]', 'w-[76%]', 'w-[60%]'];

function LogSkeleton() {
  return (
    <div role="status" aria-label="Loading log" className="flex flex-col gap-2 bg-surface px-4 py-4">
      {SKELETON_WIDTHS.map((width, index) => (
        <Skeleton key={index} className={`h-3 ${width}`} />
      ))}
    </div>
  );
}

export function LogsSection() {
  const [unit, setUnit] = useState<LogUnit>('lprint');
  const [lineCount, setLineCount] = useState<LineCount>('200');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState('');
  const deferredFilter = useDeferredValue(filter.trim());
  const logs = useLogs(unit, Number(lineCount), autoRefresh);

  const lines = logs.data?.lines ?? [];
  const matchCount = deferredFilter ? lines.filter((line) => line.toLowerCase().includes(deferredFilter.toLowerCase())).length : null;

  async function refresh() {
    const result = await logs.refetch();
    if (result.isError) toast.error(`Could not refresh the ${unit} log`, { description: errorMessage(result.error) });
  }

  return (
    <>
      <SectionHeader title="Logs" description="Recent entries from the Pi’s system journal. Useful when something is not printing." />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-full overflow-x-auto">
          <Segmented aria-label="Log" value={unit} onValueChange={setUnit} options={LOG_UNITS.map((value) => ({ value, label: <span className="px-1 whitespace-nowrap">{value}</span> }))} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="log-lines" className="text-sm font-normal text-ink-2">
              Lines
            </Label>
            <Select id="log-lines" value={lineCount} onValueChange={setLineCount} options={LINE_COUNTS.map((value) => ({ value, label: value }))} className="w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="log-auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="log-auto-refresh" className="text-sm font-normal text-ink-2">
              Auto-refresh
            </Label>
          </div>
          <Button onClick={() => void refresh()} disabled={logs.isFetching}>
            {logs.isFetching ? <Spinner /> : <RefreshCwIcon />}
            Refresh
          </Button>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter lines" aria-label="Filter lines" className="border-transparent pl-8 shadow-none hover:border-line" />
          </div>
          <p className="shrink-0 text-xs text-ink-3" aria-live="polite">
            {matchCount !== null ? `${matchCount} of ${pluralize(lines.length, 'line')} match` : <span className="max-sm:hidden">{UNIT_DESCRIPTIONS[unit]}</span>}
          </p>
        </div>
        {logs.isPending ? (
          <LogSkeleton />
        ) : logs.isError ? (
          <ErrorState title={`Could not load the ${unit} log`} error={logs.error} onRetry={() => void logs.refetch()} />
        ) : (
          <LogViewer
            lines={lines}
            filter={deferredFilter}
            sourceKey={`${unit}:${lineCount}`}
            label={`${unit} log`}
            className="h-[max(20rem,calc(100dvh-19rem))]"
          />
        )}
      </Panel>
    </>
  );
}
