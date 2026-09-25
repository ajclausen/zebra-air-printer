import type { DesignSummary } from '@eco/shared';
import { LibraryIcon, SearchIcon, SearchXIcon } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Panel, SectionHeader } from '../components/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../components/states';
import { CategoryDialog } from '../library/CategoryDialog';
import { LibraryRow, type LibraryRowHandlers } from '../library/LibraryRow';
import { useLibraryActions } from '../library/useLibraryActions';
import { useDialogTarget } from '../lib/useDialogTarget';
import { useLibrary } from '../queries';

type Filter = 'all' | 'designs' | 'templates' | 'deleted';

const FILTERS: Record<Filter, { label: string; matches: (design: DesignSummary) => boolean; empty: string }> = {
  all: { label: 'All', matches: () => true, empty: 'The library is empty. Designs saved in the designer show up here.' },
  designs: { label: 'Designs', matches: (d) => d.kind === 'design' && d.deletedAt === null, empty: 'No saved designs. Use Save in the designer to add one.' },
  templates: {
    label: 'Templates',
    matches: (d) => d.kind === 'template' && d.deletedAt === null,
    empty: 'No library templates. Use Save as template in the designer, or mark a design as a template here.',
  },
  deleted: { label: 'Deleted', matches: (d) => d.deletedAt !== null, empty: 'Nothing has been deleted. Deleted designs stay here until you remove them permanently.' },
};

function matchesQuery(design: DesignSummary, query: string): boolean {
  if (!query) return true;
  const haystack = `${design.name} ${design.category ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

function LibraryTable({ designs, busyIds, handlers }: { designs: DesignSummary[]; busyIds: Set<string>; handlers: LibraryRowHandlers }) {
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-ink-3">
          <th scope="col" className="w-[68px] py-2 pr-3 pl-4 font-medium">
            <span className="sr-only">Preview</span>
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Name
          </th>
          <th scope="col" className="hidden w-28 px-3 py-2 font-medium md:table-cell">
            Kind
          </th>
          <th scope="col" className="hidden w-36 px-3 py-2 font-medium lg:table-cell">
            Category
          </th>
          <th scope="col" className="hidden w-32 px-3 py-2 font-medium md:table-cell">
            Updated
          </th>
          <th scope="col" className="hidden w-20 px-3 py-2 text-right font-medium lg:table-cell">
            Prints
          </th>
          <th scope="col" className="w-[76px] py-2 pr-3 pl-2 sm:w-[140px]">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/70 border-t border-line">
        {designs.map((design) => (
          <LibraryRow key={design.id} design={design} busy={busyIds.has(design.id)} handlers={handlers} />
        ))}
      </tbody>
    </table>
  );
}

export function LibrarySection() {
  const library = useLibrary();
  const actions = useLibraryActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const categoryDialog = useDialogTarget<DesignSummary>();
  const purgeDialog = useDialogTarget<DesignSummary>();

  const designs = useMemo(() => library.data ?? [], [library.data]);
  const counts = useMemo(
    () => Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((key) => [key, designs.filter(FILTERS[key].matches).length])) as Record<Filter, number>,
    [designs],
  );
  const categories = useMemo(() => [...new Set(designs.map((d) => d.category).filter((c): c is string => Boolean(c)))].sort(), [designs]);
  const visible = useMemo(() => designs.filter((d) => FILTERS[filter].matches(d) && matchesQuery(d, deferredQuery)), [designs, filter, deferredQuery]);

  const handlers: LibraryRowHandlers = {
    onRestore: actions.restore,
    onDelete: actions.softDelete,
    onPurge: purgeDialog.show,
    onChangeCategory: categoryDialog.show,
    onToggleKind: (design) => actions.setKind(design, design.kind === 'template' ? 'design' : 'template'),
  };

  function renderBody() {
    if (library.isPending) return <SkeletonRows rows={6} />;
    if (library.isError) return <ErrorState title="Could not load the library" error={library.error} onRetry={() => void library.refetch()} />;
    if (visible.length > 0) return <LibraryTable designs={visible} busyIds={actions.busyIds} handlers={handlers} />;
    if (deferredQuery) {
      return (
        <EmptyState icon={SearchXIcon} title={`Nothing matches “${deferredQuery}”`}>
          <p>Try a different name or category.</p>
          <Button size="sm" className="mt-3" onClick={() => setQuery('')}>
            Clear search
          </Button>
        </EmptyState>
      );
    }
    return <EmptyState icon={LibraryIcon} title={filter === 'deleted' ? 'No deleted designs' : 'Nothing here yet'}>{FILTERS[filter].empty}</EmptyState>;
  }

  return (
    <>
      <SectionHeader title="Library" description="Every saved design and template, including deleted ones. Restore, recategorize, or remove them for good." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or category" aria-label="Search the library" className="pl-8" />
        </div>
        <div className="overflow-x-auto">
          <Segmented
            aria-label="Show"
            value={filter}
            onValueChange={setFilter}
            options={(Object.keys(FILTERS) as Filter[]).map((key) => ({
              value: key,
              label: (
                <>
                  {FILTERS[key].label}
                  {library.data && <span className="tabular text-ink-4">{counts[key]}</span>}
                </>
              ),
            }))}
          />
        </div>
      </div>

      <Panel className="overflow-hidden" aria-label="Designs">
        {renderBody()}
      </Panel>

      <CategoryDialog
        design={categoryDialog.target}
        open={categoryDialog.open}
        session={categoryDialog.session}
        categories={categories}
        pending={actions.categoryPending}
        onOpenChange={(open) => !open && categoryDialog.close()}
        onSave={(design, category) => actions.setCategory(design, category, { onSuccess: categoryDialog.close })}
      />
      <ConfirmDialog
        open={purgeDialog.open}
        onOpenChange={(open) => !open && purgeDialog.close()}
        title="Delete permanently?"
        description={`“${purgeDialog.target?.name ?? ''}” will be removed from the library for good. This cannot be undone.`}
        confirmLabel="Delete permanently"
        tone="danger"
        pending={actions.purgePending}
        onConfirm={() => purgeDialog.target && actions.purge(purgeDialog.target, { onSuccess: purgeDialog.close })}
      />
    </>
  );
}
