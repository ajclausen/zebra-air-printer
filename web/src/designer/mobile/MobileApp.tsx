import type { DesignSummary } from '@eco/shared';
import { ChevronLeftIcon, MinusIcon, PlusIcon, PrinterIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/input';
import { defaultFieldValues, documentFields, documentUsesCounter } from '@/doc/elements';
import { migrateDocument } from '@/doc/migrate';
import type { LabelDocument } from '@/doc/types';
import { api, errorMessage } from '@/lib/api/client';
import { useDesigns, useStudioSettings } from '@/lib/api/queries';
import { bitmapToCanvas, renderPrintBitmap } from '@/render/print';
import { BUILT_IN_TEMPLATES, TEMPLATE_CATEGORIES } from '@/templates';
import { LabelThumb } from '../panels/LabelCard';
import { useTemplateThumbnail } from '../panels/thumbnails';
import { PrinterStatusPill } from '../PrinterStatus';
import { getPrintedBy, setPrintedBy, usePrintJob } from '../printing';
import { BrandMark } from '../TopBar';

interface Picked {
  name: string;
  doc: LabelDocument;
  designId: string | null;
}

function TemplateCard({ template, onPick }: { template: (typeof BUILT_IN_TEMPLATES)[number]; onPick: (p: Picked) => void }) {
  const thumb = useTemplateThumbnail(template);
  const orientation = useMemo(() => template.build().orientation, [template]);
  return (
    <button type="button" className="flex flex-col gap-1.5 text-left" onClick={() => onPick({ name: template.name, doc: template.build(), designId: null })}>
      <LabelThumb src={thumb} orientation={orientation} alt="" />
      <span className="truncate text-sm font-medium text-ink">{template.name}</span>
    </button>
  );
}

function SavedCard({ design, onPick }: { design: DesignSummary; onPick: (p: Picked) => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      className="flex flex-col gap-1.5 text-left disabled:opacity-60"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const full = await api.designs.get(design.id);
          onPick({ name: full.name, doc: migrateDocument(full.document), designId: full.kind === 'design' ? full.id : null });
        } catch (error) {
          toast.error(`Could not open “${design.name}”`, { description: errorMessage(error) });
        } finally {
          setLoading(false);
        }
      }}
    >
      <LabelThumb src={design.thumbnail} orientation={design.orientation} alt="" />
      <span className="truncate text-sm font-medium text-ink">{design.name}</span>
    </button>
  );
}

function Chooser({ onPick }: { onPick: (p: Picked) => void }) {
  const [query, setQuery] = useState('');
  const saved = useDesigns({});
  const q = query.trim().toLowerCase();
  const match = (...s: Array<string | null>) => !q || s.some((x) => x?.toLowerCase().includes(q));
  const savedItems = (saved.data ?? []).filter((d) => match(d.name, d.category));
  return (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Print a label</h1>
        <p className="mt-1 text-sm text-ink-3">Pick a label, fill in the details, and print. Use a computer or tablet to design new labels.</p>
      </div>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search labels" aria-label="Search labels" className="h-11 pl-9 text-base" />
      </div>
      {savedItems.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-2">Office library</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            {savedItems.map((d) => (
              <SavedCard key={d.id} design={d} onPick={onPick} />
            ))}
          </div>
        </section>
      )}
      {TEMPLATE_CATEGORIES.map((category) => {
        const items = BUILT_IN_TEMPLATES.filter((t) => t.category === category && match(t.name, t.category, t.description));
        if (!items.length) return null;
        return (
          <section key={category}>
            <h2 className="mb-2 text-sm font-semibold text-ink-2">{category}</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              {items.map((t) => (
                <TemplateCard key={t.id} template={t} onPick={onPick} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Filler({ picked, onBack }: { picked: Picked; onBack: () => void }) {
  const settings = useStudioSettings();
  const fields = useMemo(() => documentFields(picked.doc), [picked.doc]);
  const usesCounter = useMemo(() => documentUsesCounter(picked.doc), [picked.doc]);
  const [values, setValues] = useState(() => defaultFieldValues(picked.doc));
  const [counter, setCounter] = useState('1');
  const [copies, setCopies] = useState(settings.defaultCopies);
  const [name, setName] = useState(getPrintedBy());
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { print, busy } = usePrintJob();

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      renderPrintBitmap(picked.doc, { values, counter })
        .then((b) => {
          if (!alive) return;
          setPreview(bitmapToCanvas(b).toDataURL('image/png'));
          setPreviewError(null);
        })
        .catch((e) => alive && setPreviewError(errorMessage(e)));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [picked.doc, values, counter]);

  return (
    <div className="flex flex-col gap-5 px-4 pt-3 pb-28">
      <button type="button" onClick={onBack} className="-ml-1 flex items-center gap-1 self-start py-1 text-sm font-medium text-cobalt">
        <ChevronLeftIcon className="size-4" /> All labels
      </button>
      <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{picked.name}</h1>
      <div className="flex justify-center rounded-xl bg-desk p-5">
        <div className="aspect-[812/1218] w-[62%] overflow-hidden rounded-[8px] bg-paper shadow-label">
          {preview ? <img src={preview} alt="Label preview" className="size-full" /> : <div className="flex size-full items-center justify-center text-ink-4">{previewError ? <span className="p-3 text-center text-xs text-bad">{previewError}</span> : <Spinner />}</div>}
        </div>
      </div>
      {fields.map((field, i) => (
        <Field key={field.key} label={field.label || field.key} htmlFor={`m-field-${i}`}>
          <Input id={`m-field-${i}`} value={values[field.key] ?? ''} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} className="h-11 text-base" />
        </Field>
      ))}
      {usesCounter && (
        <Field label="Number" htmlFor="m-counter">
          <Input id="m-counter" value={counter} onChange={(e) => setCounter(e.target.value)} className="h-11 text-base" inputMode="numeric" />
        </Field>
      )}
      <Field label="Your name (optional)" htmlFor="m-name">
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11 text-base" autoComplete="name" />
      </Field>
      <div className="fixed inset-x-0 bottom-0 flex items-center gap-3 border-t border-line bg-paper/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="flex h-11 items-center rounded-lg border border-line-strong" role="group" aria-label="Copies">
          <button type="button" className="flex h-full w-10 items-center justify-center text-ink-2 disabled:opacity-40" onClick={() => setCopies(Math.max(1, copies - 1))} disabled={copies <= 1} aria-label="Fewer copies">
            <MinusIcon className="size-4" />
          </button>
          <span className="tabular w-8 text-center text-base font-medium" aria-live="polite">
            {copies}
          </span>
          <button type="button" className="flex h-full w-10 items-center justify-center text-ink-2 disabled:opacity-40" onClick={() => setCopies(Math.min(100, copies + 1))} disabled={copies >= 100} aria-label="More copies">
            <PlusIcon className="size-4" />
          </button>
        </div>
        <Button
          variant="primary"
          size="lg"
          className="h-11 flex-1 text-base"
          disabled={busy || Boolean(previewError)}
          onClick={() => {
            setPrintedBy(name);
            void print({ doc: picked.doc, instances: [{ values, counter }], copies, name: picked.name, designId: picked.designId });
          }}
        >
          {busy ? <Spinner /> : <PrinterIcon />}
          Print {copies > 1 ? `${copies} labels` : 'label'}
        </Button>
      </div>
    </div>
  );
}

/** Phone layout: pick a label, fill in its fields, print. No free-form editing. */
export function MobileApp() {
  const settings = useStudioSettings();
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => window.scrollTo(0, 0), [picked]);
  return (
    <div className="min-h-full bg-surface">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-paper/95 px-4 backdrop-blur">
        <BrandMark />
        <span className="truncate text-sm font-semibold">{settings.studioName}</span>
        <div className="ml-auto">
          <PrinterStatusPill />
        </div>
      </header>
      {picked ? <Filler picked={picked} onBack={() => setPicked(null)} /> : <Chooser onPick={setPicked} />}
    </div>
  );
}
