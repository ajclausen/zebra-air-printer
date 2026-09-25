import type { HistoryEntry } from '@eco/shared';
import { HistoryIcon, MoreHorizontalIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menus';
import { errorMessage } from '@/lib/api/client';
import { useStudioSettings } from '@/lib/api/queries';
import { formatRelativeTime, pluralize } from '@/lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Panel, SectionHeader } from '../components/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../components/states';
import { Thumbnail } from '../components/Thumbnail';
import { ReprintDialog } from '../history/ReprintDialog';
import { formatDateTime } from '../lib/format';
import { useDialogTarget } from '../lib/useDialogTarget';
import { isImagesMissing, useDeleteHistoryEntry, useHistoryPages, useReprintEntry } from '../queries';

const IMAGES_MISSING_MESSAGE = 'Its label images were removed by the history retention setting, so it cannot be printed again. Open the design in the designer and print it from there.';

function quantityText(entry: HistoryEntry): string {
  return `${pluralize(entry.labelCount, 'label')} × ${pluralize(entry.copies, 'copy', 'copies')}`;
}

function HistoryRow({ entry, busy, onReprint, onDelete }: { entry: HistoryEntry; busy: boolean; onReprint: () => void; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4">
      <a
        href={entry.previewUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open the first label of ${entry.name}`}
        className="shrink-0 rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
      >
        <Thumbnail src={entry.previewUrl} className="h-[60px] w-10" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink" title={entry.name}>
          {entry.name}
        </p>
        <p className="truncate text-xs text-ink-3">
          {entry.printedBy ? `${entry.printedBy} · ` : ''}
          {quantityText(entry)}
        </p>
        <p className="truncate text-xs text-ink-3 sm:hidden" title={formatDateTime(entry.createdAt)}>
          {formatRelativeTime(entry.createdAt)}
        </p>
      </div>
      <div className="hidden w-40 shrink-0 text-right sm:block">
        <p className="text-sm text-ink-2">
          <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
            {formatRelativeTime(entry.createdAt)}
          </time>
        </p>
        {entry.jobIds.length > 0 && (
          <p className="tabular truncate text-xs text-ink-4" title={`Printer job ${entry.jobIds.join(', ')}`}>
            {entry.jobIds.length === 1 ? 'Job' : 'Jobs'} {entry.jobIds.join(', ')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onReprint} disabled={busy} aria-label={`Reprint ${entry.name}`}>
          <RotateCwIcon />
          Reprint
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`More actions for ${entry.name}`}>
              {busy ? <Spinner /> : <MoreHorizontalIcon />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2Icon />
              Delete from history…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function HistorySection() {
  const history = useHistoryPages();
  const reprint = useReprintEntry();
  const remove = useDeleteHistoryEntry();
  const reprintDialog = useDialogTarget<HistoryEntry>();
  const deleteDialog = useDialogTarget<HistoryEntry>();
  const { historyRetentionDays } = useStudioSettings();
  const entries = useMemo(() => history.data?.pages.flat() ?? [], [history.data]);
  const loadMoreError = history.isFetchNextPageError ? history.error : null;

  function reprintEntry(entry: HistoryEntry, copies: number) {
    reprint.mutate(
      { id: entry.id, body: { copies } },
      {
        onSuccess: (result) => {
          reprintDialog.close();
          toast.success(`Sent “${entry.name}” to the printer again`, {
            description: `${pluralize(entry.labelCount * copies, 'label')}${result.jobIds.length > 0 ? ` · ${result.jobIds.length === 1 ? 'Job' : 'Jobs'} ${result.jobIds.join(', ')}` : ''}`,
          });
        },
        onError: (error) => {
          if (isImagesMissing(error)) {
            reprintDialog.close();
            toast.error(`“${entry.name}” can no longer be reprinted`, { description: IMAGES_MISSING_MESSAGE, duration: 10_000 });
            return;
          }
          toast.error(`Could not reprint “${entry.name}”`, { description: errorMessage(error) });
        },
      },
    );
  }

  function deleteEntry(entry: HistoryEntry) {
    remove.mutate(entry.id, {
      onSuccess: () => {
        deleteDialog.close();
        toast.success(`Deleted “${entry.name}” from history`);
      },
      onError: (error) => toast.error(`Could not delete “${entry.name}” from history`, { description: errorMessage(error) }),
    });
  }

  function renderBody() {
    if (history.isPending) return <SkeletonRows rows={6} />;
    if (history.isError) return <ErrorState title="Could not load print history" error={history.error} onRetry={() => void history.refetch()} />;
    if (entries.length === 0) {
      return (
        <EmptyState icon={HistoryIcon} title="Nothing printed yet">
          Labels printed from the designer show up here, so you can print them again later.
        </EmptyState>
      );
    }
    return (
      <>
        <ul className="divide-y divide-line/70">
          {entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              busy={(reprint.isPending && reprint.variables.id === entry.id) || (remove.isPending && remove.variables === entry.id)}
              onReprint={() => reprintDialog.show(entry)}
              onDelete={() => deleteDialog.show(entry)}
            />
          ))}
        </ul>
        <div className="flex flex-col items-center justify-center gap-1 border-t border-line/70 px-4 py-3">
          {loadMoreError && (
            <p role="alert" className="text-xs text-bad">
              Could not load older prints. {errorMessage(loadMoreError)}
            </p>
          )}
          {history.hasNextPage ? (
            <Button variant="ghost" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
              {history.isFetchingNextPage && <Spinner />}
              Load older prints
            </Button>
          ) : (
            <p className="text-xs text-ink-3">
              {pluralize(entries.length, 'print')} in the last {pluralize(historyRetentionDays, 'day')}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <SectionHeader
        title="History"
        description={`Every label printed through Label Studio. Prints are kept for ${pluralize(historyRetentionDays, 'day')}, then removed with their images. Test labels are not recorded.`}
      />
      <Panel className="overflow-hidden" aria-label="Print history">
        {renderBody()}
      </Panel>

      <ReprintDialog
        entry={reprintDialog.target}
        open={reprintDialog.open}
        session={reprintDialog.session}
        pending={reprint.isPending}
        onOpenChange={(open) => !open && reprintDialog.close()}
        onReprint={reprintEntry}
      />
      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => !open && deleteDialog.close()}
        title="Delete from history?"
        description={`“${deleteDialog.target?.name ?? ''}” and its stored label images will be removed. The design in the library is not affected. This cannot be undone.`}
        confirmLabel="Delete from history"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => deleteDialog.target && deleteEntry(deleteDialog.target)}
      />
    </>
  );
}
