import type { HistoryEntry } from '@eco/shared';
import { RotateCcwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { ApiError, errorMessage } from '@/lib/api/client';
import { useHistory, useReprint } from '@/lib/api/queries';
import { formatRelativeTime, pluralize } from '@/lib/utils';
import { PanelHeader, PanelScroll } from './PanelShell';

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const reprint = useReprint();
  const total = entry.labelCount * entry.copies;
  return (
    <li className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-ink/[0.04]">
      <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-md bg-desk/70 p-1">
        <img src={entry.previewUrl} alt="" loading="lazy" className="max-h-full rounded-[2px] bg-paper shadow-[0_0_0_1px_rgb(24_26_31/0.08)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{entry.name}</div>
        <div className="truncate text-xs text-ink-3" title={new Date(entry.createdAt).toLocaleString()}>
          {pluralize(total, 'label')}
          {entry.printedBy ? ` · ${entry.printedBy}` : ''} · {formatRelativeTime(entry.createdAt)}
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={reprint.isPending}
        aria-label={`Reprint ${entry.name}`}
        onClick={() =>
          reprint.mutate(entry.id, {
            onSuccess: () => toast.success(`Reprinting “${entry.name}”`, { description: `${pluralize(total, 'label')} sent to the printer.` }),
            onError: (error) =>
              toast.error('Could not reprint', {
                description: error instanceof ApiError && error.code === 'images_missing' ? 'The stored images for this print were cleaned up. Open the design and print it again.' : errorMessage(error),
              }),
          })
        }
      >
        {reprint.isPending ? <Spinner className="size-3.5" /> : <RotateCcwIcon />}
        Reprint
      </Button>
    </li>
  );
}

export function HistoryPanel() {
  const history = useHistory(50);
  return (
    <>
      <PanelHeader title="Recent prints" />
      <PanelScroll>
        {history.isPending ? (
          <div className="flex justify-center py-10 text-ink-3">
            <Spinner />
          </div>
        ) : history.isError ? (
          <div className="px-2 py-8 text-center text-sm text-ink-3">
            <p>Could not load print history.</p>
            <p className="mt-1 text-xs">{errorMessage(history.error)}</p>
          </div>
        ) : history.data.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-sm font-medium text-ink-2">Nothing printed yet</p>
            <p className="mt-1 text-xs text-ink-3">Every print shows up here so you can send it again with one click.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Recent prints">
            {history.data.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </PanelScroll>
    </>
  );
}
