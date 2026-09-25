import type { DesignSummary } from '@eco/shared';
import { CopyIcon, FolderOpenIcon, MoreHorizontalIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus';
import { errorMessage } from '@/lib/api/client';
import { useDeleteDesign, useDesigns, useDuplicateDesign } from '@/lib/api/queries';
import { cn, formatRelativeTime, pluralize } from '@/lib/utils';
import { openLibraryDesign } from '../actions';
import { confirmDiscard } from '../confirmDiscard';
import { useEditor } from '../store';
import { PanelHeader, PanelScroll } from './PanelShell';

function openDesign(design: DesignSummary) {
  if (useEditor.getState().meta.designId !== design.id && !confirmDiscard()) return;
  openLibraryDesign(design.id).catch((error) => toast.error(`Could not open “${design.name}”`, { description: errorMessage(error) }));
}

function DesignRow({ design, active }: { design: DesignSummary; active: boolean }) {
  const duplicate = useDuplicateDesign();
  const remove = useDeleteDesign();
  return (
    <li
      className={cn(
        'group relative flex items-center gap-3 rounded-lg p-1.5 pr-1 transition-colors hover:bg-ink/[0.04]',
        active && 'bg-cobalt-soft/70 hover:bg-cobalt-soft',
      )}
    >
      <button type="button" onClick={() => openDesign(design)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-cobalt">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-desk/70">
          {design.thumbnail ? (
            <img
              src={design.thumbnail}
              alt=""
              className={cn('rounded-[2px] bg-paper shadow-[0_0_0_1px_rgb(24_26_31/0.08)]', design.orientation === 'portrait' ? 'h-12' : 'w-12')}
            />
          ) : (
            <div className={cn('rounded-[2px] bg-paper', design.orientation === 'portrait' ? 'h-12 w-8' : 'h-8 w-12')} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{design.name}</div>
          <div className="truncate text-xs text-ink-3">
            {formatRelativeTime(design.updatedAt)}
            {design.printCount > 0 && ` · printed ${pluralize(design.printCount, 'time')}`}
          </div>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${design.name}`} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => openDesign(design)}>
            <FolderOpenIcon /> Open
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              duplicate.mutate(design.id, {
                onSuccess: (copy) => toast.success(`Duplicated as “${copy.name}”`),
                onError: (error) => toast.error('Could not duplicate', { description: errorMessage(error) }),
              })
            }
          >
            <CopyIcon /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={() => {
              if (!window.confirm(`Delete “${design.name}” from the library? An admin can restore it later.`)) return;
              remove.mutate(design.id, {
                onSuccess: () => {
                  toast.success(`Deleted “${design.name}”`);
                  if (useEditor.getState().meta.designId === design.id) useEditor.getState().setMeta({ designId: null });
                },
                onError: (error) => toast.error('Could not delete', { description: errorMessage(error) }),
              });
            }}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function LibraryPanel() {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const designs = useDesigns({ kind: 'design', q: deferred || undefined });
  const activeId = useEditor((s) => s.meta.designId);

  return (
    <>
      <PanelHeader title="Library">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved labels" aria-label="Search saved labels" className="pl-8" />
        </div>
      </PanelHeader>
      <PanelScroll>
        {designs.isPending ? (
          <div className="flex justify-center py-10 text-ink-3">
            <Spinner />
          </div>
        ) : designs.isError ? (
          <div className="px-2 py-8 text-center text-sm text-ink-3">
            <p>Could not load the library.</p>
            <p className="mt-1 text-xs">{errorMessage(designs.error)}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void designs.refetch()}>
              Try again
            </Button>
          </div>
        ) : designs.data.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-sm font-medium text-ink-2">{deferred ? `Nothing matches “${deferred}”` : 'No saved labels yet'}</p>
            {!deferred && <p className="mt-1 text-xs text-ink-3">Save a label and it appears here for everyone in the office.</p>}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Saved labels">
            {designs.data.map((d) => (
              <DesignRow key={d.id} design={d} active={d.id === activeId} />
            ))}
          </ul>
        )}
      </PanelScroll>
    </>
  );
}
