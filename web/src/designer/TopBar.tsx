import {
  ChevronDownIcon,
  EyeIcon,
  FilePlus2Icon,
  HashIcon,
  KeyboardIcon,
  LayoutTemplateIcon,
  MinusIcon,
  PlusIcon,
  PackageIcon,
  PrinterIcon,
  Redo2Icon,
  RectangleHorizontalIcon,
  RectangleVerticalIcon,
  SaveIcon,
  SheetIcon,
  Undo2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Segmented, Separator } from '@/components/ui/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui/menus';
import { errorMessage } from '@/lib/api/client';
import { useStudioSettings } from '@/lib/api/queries';
import { cn, modKey } from '@/lib/utils';
import { newBlankLabel, saveWorkingDesign } from './actions';
import { useDialogs } from './dialogs';
import { PrinterStatusPill } from './PrinterStatus';
import { usePrintAction } from './printing';
import { selectIsDirty, UNTITLED, useEditor } from './store';
import { ZoomMenu } from './ZoomMenu';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect x="7" y="3" width="18" height="26" rx="3.5" fill="#fff" stroke="currentColor" strokeWidth="2" />
      <rect x="11" y="8" width="10" height="3" rx="1" fill="currentColor" />
      <rect x="11" y="14" width="10" height="1.6" fill="currentColor" />
      <rect x="11" y="17.5" width="7" height="1.6" fill="currentColor" />
      <rect x="11" y="22" width="10" height="3" rx="1" fill="var(--color-cobalt)" />
    </svg>
  );
}

function DesignName() {
  const { name, dirty, designId } = useEditor(useShallow((s) => ({ name: s.meta.name, dirty: selectIsDirty(s), designId: s.meta.designId })));
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(name);
  }, [name]);
  const commit = () => {
    const next = draft.trim() || UNTITLED;
    setDraft(next);
    if (next !== name) useEditor.getState().setMeta({ name: next });
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') inputRef.current?.blur();
          if (e.key === 'Escape') {
            setDraft(name);
            requestAnimationFrame(() => inputRef.current?.blur());
          }
        }}
        aria-label="Design name"
        size={Math.max(8, Math.min(32, draft.length + 1))}
        className="h-8 min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-ink outline-none hover:border-line focus:border-cobalt focus:bg-paper focus:ring-2 focus:ring-cobalt-ring"
      />
      <span className="hidden text-xs whitespace-nowrap text-ink-4 lg:inline" aria-live="polite">
        {dirty ? (designId ? 'Unsaved changes' : 'Not saved') : designId ? 'Saved' : ''}
      </span>
    </div>
  );
}

function CopiesStepper({ copies, setCopies }: { copies: number; setCopies: (n: number) => void }) {
  const clamp = (n: number) => Math.min(100, Math.max(1, Math.round(n) || 1));
  return (
    <div className="flex h-8 items-center rounded-md border border-line-strong bg-paper" role="group" aria-label="Copies">
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center rounded-l-md text-ink-3 hover:bg-surface hover:text-ink disabled:opacity-40"
        onClick={() => setCopies(clamp(copies - 1))}
        disabled={copies <= 1}
        aria-label="Fewer copies"
      >
        <MinusIcon className="size-3.5" />
      </button>
      <input
        value={copies}
        onChange={(e) => setCopies(clamp(Number(e.target.value)))}
        inputMode="numeric"
        aria-label="Number of copies"
        className="tabular h-full w-8 border-x border-line bg-transparent text-center text-sm font-medium outline-none focus:bg-cobalt-soft"
      />
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center rounded-r-md text-ink-3 hover:bg-surface hover:text-ink disabled:opacity-40"
        onClick={() => setCopies(clamp(copies + 1))}
        disabled={copies >= 100}
        aria-label="More copies"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** Copies chosen in the top bar; shared with the print dialog. */
export const useCopies = (() => {
  let value: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (fallback: number) => value ?? fallback,
    set: (n: number) => {
      value = n;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
})();

/** Stable getter for the current copies count (for callbacks). */
export function useCopiesGetter(): () => number {
  const settings = useStudioSettings();
  const fallback = settings.defaultCopies;
  return useCallback(() => useCopies.get(fallback), [fallback]);
}

export function useCopiesState(): [number, (n: number) => void] {
  const settings = useStudioSettings();
  const [, force] = useState(0);
  useEffect(() => useCopies.subscribe(() => force((n) => n + 1)), []);
  return [useCopies.get(settings.defaultCopies), useCopies.set];
}

export function TopBar() {
  const settings = useStudioSettings();
  const { canUndo, canRedo, orientation, meta, hasElements } = useEditor(
    useShallow((s) => ({
      canUndo: s.past.length > 0,
      canRedo: s.future.length > 0,
      orientation: s.doc.orientation,
      meta: s.meta,
      hasElements: s.doc.elements.length > 0,
    })),
  );
  const openDialog = useDialogs((s) => s.open);
  const [copies, setCopies] = useCopiesState();
  const { start: onPrint, busy } = usePrintAction(useCopiesGetter());
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    const { meta: current } = useEditor.getState();
    if (!current.designId) {
      openDialog('save', 'save');
      return;
    }
    setSaving(true);
    try {
      const design = await saveWorkingDesign({ mode: 'update' });
      toast.success(`Saved “${design.name}”`);
    } catch (error) {
      toast.error('Could not save', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
      <div className="flex shrink-0 items-center gap-2 pr-1 text-ink">
        <BrandMark />
        <span className="hidden text-sm font-semibold tracking-[-0.01em] xl:inline">{settings.studioName}</span>
      </div>
      <Separator vertical className="hidden md:block" />
      <DesignName />

      <div className="ml-1 flex items-center gap-0.5">
        <Tooltip content="Undo" shortcut={`${modKey}Z`}>
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
            <Undo2Icon />
          </Button>
        </Tooltip>
        <Tooltip content="Redo" shortcut={`${modKey}⇧Z`}>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
            <Redo2Icon />
          </Button>
        </Tooltip>
      </div>
      <Separator vertical className="hidden lg:block" />
      <Segmented
        aria-label="Orientation"
        className="hidden lg:inline-flex"
        value={orientation}
        onValueChange={(o) => useEditor.getState().setOrientation(o)}
        options={[
          { value: 'portrait', label: <RectangleVerticalIcon />, title: 'Portrait (4 × 6 in)' },
          { value: 'landscape', label: <RectangleHorizontalIcon />, title: 'Landscape (6 × 4 in)' },
        ]}
      />
      <ZoomMenu />

      <div className="ml-auto flex items-center gap-2">
        <PrinterStatusPill />
        <Tooltip content="Preview the exact print" shortcut={`${modKey}⇧P`}>
          <Button variant="ghost" onClick={() => openDialog('preview', true)} disabled={!hasElements} className="hidden sm:inline-flex">
            <EyeIcon />
            <span className="hidden lg:inline">Preview</span>
          </Button>
        </Tooltip>

        <div className="flex">
          <Button variant="secondary" className="rounded-r-none" onClick={onSave} disabled={saving || !hasElements}>
            <SaveIcon />
            <span className="hidden md:inline">{meta.designId ? 'Save' : 'Save'}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="-ml-px w-7 rounded-l-none" aria-label="More save options">
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onSave} disabled={!hasElements} shortcut={`${modKey}S`}>
                <SaveIcon /> Save
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog('save', 'save-as')} disabled={!hasElements}>
                <FilePlus2Icon /> Save as new design…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog('save', 'template')} disabled={!hasElements}>
                <LayoutTemplateIcon /> Save as template…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={newBlankLabel}>
                <PlusIcon /> New blank label
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog('shortcuts', true)}>
                <KeyboardIcon /> Keyboard shortcuts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CopiesStepper copies={copies} setCopies={setCopies} />
        <div className="flex">
          <Button variant="primary" className="rounded-r-none px-4" onClick={onPrint} disabled={busy} data-testid="print-button">
            <PrinterIcon />
            Print
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="primary" size="icon" className="w-7 rounded-l-none border-l border-white/25" aria-label="More print options">
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Print several labels</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => openDialog('print', { mode: 'sequence' })} disabled={!hasElements}>
                <HashIcon /> Numbered sequence…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog('print', { mode: 'csv' })} disabled={!hasElements}>
                <SheetIcon /> From a CSV file…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openDialog('print', { mode: 'single' })} disabled={!hasElements}>
                <PrinterIcon /> Print with options…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openDialog('shippingLabel', { file: null })}>
                <PackageIcon /> Print shipping label…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
