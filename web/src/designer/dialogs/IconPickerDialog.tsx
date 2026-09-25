import type { IconNode } from 'lucide';
import { SearchIcon } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { iconNodeToSvg } from '@/templates/icons';
import { LABEL_SYMBOLS } from '@/templates/symbols';
import { insertIcon } from '../actions';
import { useDialogs } from '../dialogs';
import { selectSelectedElements, useEditor } from '../store';

interface IconEntry {
  name: string;
  /** Searchable text: name words plus tags. */
  haystack: string;
  svg: string;
}

let catalogPromise: Promise<IconEntry[]> | null = null;

function pascal(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** The full Lucide set is large, so it loads the first time the picker opens. */
function loadCatalog(): Promise<IconEntry[]> {
  // Import the icon map module directly (not the 'lucide' entry, which templates import
  // statically) so the full set lands in its own lazily loaded chunk.
  catalogPromise ??= Promise.all([import('lucide/dist/esm/iconsAndAliases.mjs'), import('@/features/icons/lucide-tags.json')]).then(([iconMap, tagsModule]) => {
    const nodes = iconMap as unknown as Record<string, IconNode | undefined>;
    const tags = tagsModule.default as Record<string, string>;
    const entries: IconEntry[] = [];
    for (const [name, tagList] of Object.entries(tags)) {
      const node = nodes[pascal(name)];
      if (!node) continue;
      entries.push({ name, haystack: `${name.replace(/-/g, ' ')} ${tagList.replace(/,/g, ' ')}`.toLowerCase(), svg: iconNodeToSvg(node) });
    }
    return entries;
  });
  return catalogPromise;
}

const RESULT_LIMIT = 240;

function IconTile({ name, svg, onPick }: { name: string; svg: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={name.replace(/-/g, ' ')}
      aria-label={name.replace(/-/g, ' ')}
      className="flex aspect-square items-center justify-center rounded-lg text-ink-2 transition-colors outline-none hover:bg-cobalt-soft hover:text-cobalt-strong focus-visible:ring-2 focus-visible:ring-cobalt"
      data-testid={`icon-${name}`}
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: svg.replace(/#000/g, 'currentColor') }} />
    </button>
  );
}

function Picker({ onDone }: { onDone: () => void }) {
  const [catalog, setCatalog] = useState<IconEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const replaceTarget = useEditor((s) => {
    const selected = selectSelectedElements(s);
    return selected.length === 1 && selected[0]!.type === 'icon' ? selected[0]!.id : null;
  });

  useEffect(() => {
    void loadCatalog().then(setCatalog);
  }, []);

  const pick = (name: string, svg: string) => {
    if (replaceTarget) useEditor.getState().update(replaceTarget, { icon: name, svg });
    else insertIcon(name, svg);
    onDone();
  };

  const symbols = useMemo(() => LABEL_SYMBOLS.filter((s) => !deferred || `${s.name} ${s.keywords}`.toLowerCase().includes(deferred)), [deferred]);
  const results = useMemo(() => {
    if (!catalog) return [];
    if (!deferred) return catalog.slice(0, RESULT_LIMIT);
    const words = deferred.split(/\s+/);
    const scored = catalog
      .filter((e) => words.every((w) => e.haystack.includes(w)))
      .map((e) => ({ e, score: e.name === deferred ? 0 : e.name.startsWith(deferred) ? 1 : e.name.includes(deferred) ? 2 : 3 }));
    scored.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name));
    return scored.slice(0, RESULT_LIMIT).map((s) => s.e);
  }, [catalog, deferred]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{replaceTarget ? 'Replace icon' : 'Add an icon'}</DialogTitle>
        <DialogDescription>Search by name or meaning, for example “box”, “warning”, or “recycle”.</DialogDescription>
        <div className="relative mt-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons" aria-label="Search icons" className="pl-8" data-testid="icon-search" />
        </div>
      </DialogHeader>
      <DialogBody className="h-[440px] pb-5">
        {symbols.length > 0 && (
          <section className="mb-4" aria-label="Label symbols">
            <h3 className="mb-1.5 text-xs font-semibold text-ink-2">Label symbols</h3>
            <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
              {symbols.map((s) => (
                <IconTile key={s.id} name={s.name} svg={s.svg} onPick={() => pick(s.id, s.svg)} />
              ))}
            </div>
          </section>
        )}
        <section aria-label="Icons">
          <h3 className="mb-1.5 text-xs font-semibold text-ink-2">{deferred ? `Icons matching “${deferred}”` : 'All icons'}</h3>
          {!catalog ? (
            <div className="flex justify-center py-10 text-ink-3">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-3">No icons match. Try a simpler word.</p>
          ) : (
            <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
              {results.map((e) => (
                <IconTile key={e.name} name={e.name} svg={e.svg} onPick={() => pick(e.name, e.svg)} />
              ))}
            </div>
          )}
          {results.length === RESULT_LIMIT && <p className="mt-3 text-center text-xs text-ink-3">Showing the first {RESULT_LIMIT}. Search to find more.</p>}
        </section>
      </DialogBody>
    </>
  );
}

export function IconPickerDialog() {
  const open = useDialogs((s) => s.iconPicker);
  const close = useDialogs((s) => s.close);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close('iconPicker')}>
      <DialogContent className="max-w-[560px]">{open && <Picker onDone={() => close('iconPicker')} />}</DialogContent>
    </Dialog>
  );
}
