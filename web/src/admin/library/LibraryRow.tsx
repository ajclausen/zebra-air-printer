import type { DesignSummary } from '@eco/shared';
import { FileIcon, FolderIcon, LayoutTemplateIcon, MoreHorizontalIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Spinner } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Thumbnail } from '../components/Thumbnail';
import { formatDateTime } from '../lib/format';

export interface LibraryRowHandlers {
  onRestore: (design: DesignSummary) => void;
  onDelete: (design: DesignSummary) => void;
  onPurge: (design: DesignSummary) => void;
  onChangeCategory: (design: DesignSummary) => void;
  onToggleKind: (design: DesignSummary) => void;
}

function KindBadge({ design }: { design: DesignSummary }) {
  return design.kind === 'template' ? <Badge tone="cobalt">Template</Badge> : <Badge>Design</Badge>;
}

function RowMenu({ design, busy, handlers }: { design: DesignSummary; busy: boolean; handlers: LibraryRowHandlers }) {
  const deleted = design.deletedAt !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`More actions for ${design.name}`}>
          {busy ? <Spinner /> : <MoreHorizontalIcon />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-52">
        {deleted ? (
          <>
            <DropdownMenuItem onSelect={() => handlers.onRestore(design)}>
              <RotateCcwIcon />
              Restore
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => handlers.onPurge(design)}>
              <Trash2Icon />
              Delete permanently…
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => handlers.onChangeCategory(design)}>
              <FolderIcon />
              Change category…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handlers.onToggleKind(design)}>
              {design.kind === 'template' ? <FileIcon /> : <LayoutTemplateIcon />}
              {design.kind === 'template' ? 'Mark as design' : 'Mark as template'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => handlers.onDelete(design)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => handlers.onPurge(design)}>
              <Trash2Icon />
              Delete permanently…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LibraryRow({ design, busy, handlers }: { design: DesignSummary; busy: boolean; handlers: LibraryRowHandlers }) {
  const deleted = design.deletedAt !== null;
  const mobileMeta = [design.kind === 'template' ? 'Template' : 'Design', design.category, formatRelativeTime(design.updatedAt)].filter(Boolean).join(' · ');
  return (
    <tr className={cn('group', deleted && 'bg-surface/60')}>
      <td className="py-2.5 pr-3 pl-4">
        <Thumbnail src={design.thumbnail} dimmed={deleted} className={design.orientation === 'landscape' ? 'h-9 w-12' : 'h-12 w-9'} />
      </td>
      <td className="max-w-0 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-medium', deleted ? 'text-ink-3' : 'text-ink')} title={design.name}>
            {design.name}
          </span>
          {deleted && (
            <Badge tone="bad" title={design.deletedAt ? `Deleted ${formatDateTime(design.deletedAt)}` : undefined}>
              Deleted
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-ink-3 md:hidden">{mobileMeta}</p>
      </td>
      <td className="hidden px-3 py-2.5 md:table-cell">
        <KindBadge design={design} />
      </td>
      <td className="hidden max-w-[10rem] truncate px-3 py-2.5 text-ink-2 lg:table-cell">{design.category ?? <span className="text-ink-4">—</span>}</td>
      <td className="hidden px-3 py-2.5 whitespace-nowrap text-ink-3 md:table-cell" title={formatDateTime(design.updatedAt)}>
        {formatRelativeTime(design.updatedAt)}
      </td>
      <td className="tabular hidden px-3 py-2.5 text-right text-ink-2 lg:table-cell">{design.printCount}</td>
      <td className="py-2.5 pr-3 pl-2">
        <div className="flex items-center justify-end gap-1">
          {deleted && (
            <Button size="sm" onClick={() => handlers.onRestore(design)} disabled={busy} className="max-sm:hidden">
              Restore
            </Button>
          )}
          <RowMenu design={design} busy={busy} handlers={handlers} />
        </div>
      </td>
    </tr>
  );
}
