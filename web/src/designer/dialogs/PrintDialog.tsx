import { EyeIcon, FileUpIcon, HashIcon, PrinterIcon, SheetIcon, TagIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented, Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/menus';
import {
  autoMapColumns,
  BatchError,
  COUNTER_KEY,
  DEFAULT_SEQUENCE,
  expandCsv,
  expandSequenceInstances,
  MAX_LABELS_PER_JOB,
  parseCsv,
  sequenceLength,
  formatSequenceValue,
  type CsvTable,
  type SequenceOptions,
} from '@/doc/batch';
import { defaultFieldValues, documentFields, documentUsesCounter } from '@/doc/elements';
import type { LabelInstance } from '@/doc/types';
import { cn, pluralize } from '@/lib/utils';
import { useDialogs, type BatchMode } from '../dialogs';
import { getPrintedBy, setPrintedBy, usePrintJob } from '../printing';
import { useEditor } from '../store';
import { useCopiesState } from '../TopBar';
import { PreviewDialog } from './PreviewDialog';

function SequenceForm({ value, onChange }: { value: SequenceOptions; onChange: (v: SequenceOptions) => void }) {
  const num = (key: keyof SequenceOptions) => ({
    value: String(value[key]),
    inputMode: 'numeric' as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value === '' || e.target.value === '-' ? 0 : Math.trunc(Number(e.target.value)) || 0 }),
  });
  const count = sequenceLength(value);
  const sample = count > 0 ? [value.start, value.start + (value.end >= value.start ? 1 : -1) * value.step].slice(0, count).map((n) => formatSequenceValue(n, value)) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="From" htmlFor="seq-start">
          <Input id="seq-start" {...num('start')} />
        </Field>
        <Field label="To" htmlFor="seq-end">
          <Input id="seq-end" {...num('end')} />
        </Field>
        <Field label="Step" htmlFor="seq-step">
          <Input id="seq-step" {...num('step')} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Digits" htmlFor="seq-pad" hint="Pads with zeros">
          <Input id="seq-pad" {...num('pad')} />
        </Field>
        <Field label="Before" htmlFor="seq-prefix">
          <Input id="seq-prefix" value={value.prefix} onChange={(e) => onChange({ ...value, prefix: e.target.value })} placeholder="e.g. BIN-" />
        </Field>
        <Field label="After" htmlFor="seq-suffix">
          <Input id="seq-suffix" value={value.suffix} onChange={(e) => onChange({ ...value, suffix: e.target.value })} />
        </Field>
      </div>
      {count > 0 && (
        <p className="text-xs text-ink-3">
          {pluralize(count, 'label')}: <span className="font-medium text-ink-2">{sample.join(', ')}</span>
          {count > 2 && <span> … {formatSequenceValue(value.start + (value.end >= value.start ? 1 : -1) * value.step * (count - 1), value)}</span>}
        </p>
      )}
    </div>
  );
}

function CsvForm({
  table,
  setTable,
  mapping,
  setMapping,
  fieldKeys,
  usesCounter,
}: {
  table: CsvTable | null;
  setTable: (t: CsvTable | null) => void;
  mapping: Record<string, string | null>;
  setMapping: (m: Record<string, string | null>) => void;
  fieldKeys: string[];
  usesCounter: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const targets = [...fieldKeys, ...(usesCounter ? [COUNTER_KEY] : [])];

  const load = async (file: File) => {
    try {
      const parsed = parseCsv(await file.text());
      setTable(parsed);
      setFileName(file.name);
      setError(null);
      const auto = autoMapColumns(fieldKeys, parsed.headers);
      if (usesCounter) auto[COUNTER_KEY] = parsed.headers.find((h) => /^(counter|number|no\.?|#)$/i.test(h.trim())) ?? null;
      setMapping(auto);
    } catch (e) {
      setError(e instanceof BatchError ? e.message : 'That file could not be read as CSV.');
      setTable(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void load(file);
        }}
        className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-3 text-left transition-colors hover:border-cobalt hover:bg-cobalt-soft/40 focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:outline-none"
      >
        <FileUpIcon className="size-5 shrink-0 text-ink-3" />
        <span className="min-w-0 text-sm">
          <span className="block font-medium text-ink">{fileName ?? 'Choose a CSV file'}</span>
          <span className="block text-xs text-ink-3">{table ? `${pluralize(table.rows.length, 'row')} · ${table.headers.length} columns` : 'The first row must name the columns. Drop a file here or click.'}</span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(file);
        }}
      />
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-bad" role="alert">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" /> {error}
        </p>
      )}
      {table && (
        <>
          {targets.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-ink-2">Match fields to columns</span>
              {targets.map((key) => (
                <div key={key} className="grid grid-cols-[1fr_1fr] items-center gap-3">
                  <code className="truncate text-xs text-ink-2">{key === COUNTER_KEY ? '{{counter}}' : `{{${key}}}`}</code>
                  <Select
                    aria-label={`Column for ${key === COUNTER_KEY ? 'counter' : key}`}
                    value={mapping[key] ?? '__none__'}
                    onValueChange={(v) => setMapping({ ...mapping, [key]: v === '__none__' ? null : v })}
                    options={[
                      { value: '__none__', label: key === COUNTER_KEY ? <span className="text-ink-3">Row number</span> : <span className="text-ink-3">Use default value</span> },
                      ...table.headers.map((h) => ({ value: h, label: h })),
                    ]}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-3">This label has no fields, so every row prints the same label.</p>
          )}
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="max-h-40 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface text-ink-3">
                  <tr>
                    {table.headers.map((h) => (
                      <th key={h} className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-line">
                      {row.map((cell, j) => (
                        <td key={j} className="max-w-40 truncate px-2.5 py-1.5 text-ink-2">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table.rows.length > 5 && <div className="border-t border-line bg-surface px-2.5 py-1 text-2xs text-ink-3">and {table.rows.length - 5} more rows</div>}
          </div>
        </>
      )}
    </div>
  );
}

function PrintDialogBody({ initialMode, onClose }: { initialMode: BatchMode; onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const meta = useEditor((s) => s.meta);
  const fields = useMemo(() => documentFields(doc), [doc]);
  const usesCounter = useMemo(() => documentUsesCounter(doc), [doc]);
  const [values, setValues] = useState<Record<string, string>>(() => defaultFieldValues(doc));
  const [mode, setMode] = useState<BatchMode>(initialMode);
  const [sequence, setSequence] = useState<SequenceOptions>(DEFAULT_SEQUENCE);
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [copies, setCopies] = useCopiesState();
  const [name, setName] = useState(getPrintedBy());
  const [previewOpen, setPreviewOpen] = useState(false);
  const { print, phase, busy } = usePrintJob();

  const plan = useMemo((): { instances: LabelInstance[]; error: string | null } => {
    try {
      if (mode === 'sequence') return { instances: expandSequenceInstances(sequence, values), error: null };
      if (mode === 'csv') return table ? { instances: expandCsv(table, mapping, values), error: null } : { instances: [], error: 'Choose a CSV file.' };
      return { instances: [{ values, counter: usesCounter ? String(sequence.start) : '1' }], error: null };
    } catch (e) {
      return { instances: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, sequence, table, mapping, values, usesCounter]);

  const total = plan.instances.length * copies;
  const csvMapped = new Set(mode === 'csv' ? Object.entries(mapping).filter(([, v]) => v).map(([k]) => k) : []);
  const visibleFields = fields.filter((f) => !csvMapped.has(f.key));

  const submit = async () => {
    if (plan.error || !plan.instances.length) return;
    setPrintedBy(name);
    const ok = await print({ doc, instances: plan.instances, copies, name: meta.name, designId: meta.designId });
    if (ok) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Print “{meta.name}”</DialogTitle>
        <DialogDescription>Labels print on the Zebra at 4 × 6 inches, exactly as the preview shows.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-4">
        <Segmented
          aria-label="What to print"
          value={mode}
          onValueChange={setMode}
          className="w-full"
          options={[
            { value: 'single', label: <><TagIcon /> One label</> },
            { value: 'sequence', label: <><HashIcon /> Numbered</> },
            { value: 'csv', label: <><SheetIcon /> From CSV</> },
          ]}
        />
        {mode === 'sequence' && (
          <>
            {!usesCounter && <p className="-mt-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">This label has no {'{{counter}}'} yet, so every label would look the same. Add a Counter from Elements first.</p>}
            <SequenceForm value={sequence} onChange={setSequence} />
          </>
        )}
        {mode === 'csv' && <CsvForm table={table} setTable={setTable} mapping={mapping} setMapping={setMapping} fieldKeys={fields.map((f) => f.key)} usesCounter={usesCounter} />}

        {visibleFields.length > 0 && (
          <div className="flex flex-col gap-3">
            {mode !== 'single' && <span className="text-xs font-medium text-ink-2">Same on every label</span>}
            {visibleFields.map((field, i) => (
              <Field key={field.key} label={field.label || field.key} htmlFor={`field-${i}`}>
                <Input
                  id={`field-${i}`}
                  autoFocus={i === 0 && mode === 'single'}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) void submit();
                  }}
                  data-testid={`field-input-${field.key}`}
                />
              </Field>
            ))}
          </div>
        )}

        <div className="grid grid-cols-[1fr_120px] gap-3 border-t border-line pt-4">
          <Field label="Your name" htmlFor="printed-by" hint="Optional. Shown in print history; remembered on this device.">
            <Input id="printed-by" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoComplete="name" />
          </Field>
          <Field label={mode === 'single' ? 'Copies' : 'Copies of each'} htmlFor="print-copies">
            <Input id="print-copies" inputMode="numeric" value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))} />
          </Field>
        </div>
        {plan.error && mode !== 'csv' && (
          <p className="flex items-start gap-1.5 text-xs text-bad" role="alert">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" /> {plan.error}
          </p>
        )}
      </DialogBody>
      <DialogFooter className="justify-between">
        <Button variant="ghost" onClick={() => setPreviewOpen(true)} disabled={!plan.instances.length}>
          <EyeIcon /> Preview{plan.instances.length > 1 ? ` all ${plan.instances.length}` : ''}
        </Button>
        <div className="flex items-center gap-3">
          <span className={cn('tabular text-xs text-ink-3', total > MAX_LABELS_PER_JOB * 100 && 'text-bad')}>{total > 0 && pluralize(total, 'label')}</span>
          <Button variant="primary" onClick={submit} disabled={busy || !plan.instances.length || Boolean(plan.error)} data-testid="confirm-print">
            {busy ? <Spinner className="size-4" /> : <PrinterIcon />}
            {phase.kind === 'rendering' ? `Preparing ${phase.done}/${phase.total}` : phase.kind === 'sending' ? 'Sending…' : 'Print'}
          </Button>
        </div>
      </DialogFooter>
      {previewOpen && <PreviewDialog doc={doc} instances={plan.instances} copies={copies} onClose={() => setPreviewOpen(false)} />}
    </>
  );
}

export function PrintDialog() {
  const state = useDialogs((s) => s.print);
  const close = useDialogs((s) => s.close);
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && close('print')}>
      <DialogContent className="max-w-[520px]" aria-describedby={undefined}>
        {state && <PrintDialogBody initialMode={state.mode} onClose={() => close('print')} />}
      </DialogContent>
    </Dialog>
  );
}
