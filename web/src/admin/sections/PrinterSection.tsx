import type { PrinterSettingsInput, PrinterStatus } from '@eco/shared';
import { CheckCircle2Icon } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented, Slider, Spinner } from '@/components/ui/controls';
import { Input, Label } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/client';
import { usePrinterStatus } from '@/lib/api/queries';
import { Panel, PanelHeader, SectionHeader } from '../components/layout';
import { ErrorState, Skeleton } from '../components/states';
import { printerStateMeta } from '../lib/format';
import { TestPrintButton } from '../overview/TestPrintButton';
import { useUpdatePrinter } from '../queries';

type SpeedOption = 'default' | '2' | '3' | '4' | '5' | '6';

const SPEED_OPTIONS: { value: SpeedOption; label: React.ReactNode; title: string }[] = [
  { value: 'default', label: <span className="px-1 whitespace-nowrap">Printer default</span>, title: 'Printer default' },
  ...(['2', '3', '4', '5', '6'] as const).map((value) => ({ value, label: value, title: `${value} inches per second` })),
];

/** Used when the printer does not report a darkness value. */
const FALLBACK_DARKNESS = 50;

interface Draft {
  darkness: number;
  speed: SpeedOption;
}

function toSpeedOption(speed: number | null): SpeedOption {
  if (speed === null) return 'default';
  const rounded = String(Math.round(speed));
  return SPEED_OPTIONS.some((option) => option.value === rounded) ? (rounded as SpeedOption) : 'default';
}

function draftFromStatus(status: PrinterStatus): Draft {
  return { darkness: status.darkness ?? FALLBACK_DARKNESS, speed: toSpeedOption(status.speed) };
}

/** Only send what changed, so an unreported darkness is never overwritten by the placeholder. */
function changes(saved: Draft, draft: Draft): PrinterSettingsInput {
  const input: PrinterSettingsInput = {};
  if (draft.darkness !== saved.darkness) input.darkness = draft.darkness;
  if (draft.speed !== saved.speed) input.speed = draft.speed === 'default' ? null : Number(draft.speed);
  return input;
}

function SettingRow({ label, htmlFor, description, children }: { label: string; htmlFor?: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-3 px-4 py-5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div>
        <Label htmlFor={htmlFor} className="text-sm text-ink">
          {label}
        </Label>
        <p className="mt-1 text-sm text-ink-3">{description}</p>
      </div>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function DarknessControl({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  return (
    <div className="flex w-full max-w-md items-center gap-4">
      <span className="text-xs text-ink-3" aria-hidden>
        Lighter
      </span>
      <Slider aria-label="Darkness" min={0} max={100} step={1} value={[value]} onValueChange={([next]) => next !== undefined && onChange(next)} disabled={disabled} className="flex-1" />
      <span className="text-xs text-ink-3" aria-hidden>
        Darker
      </span>
      <Input
        id="printer-darkness"
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(100, Math.max(0, Math.round(next))));
        }}
        className="tabular w-16 text-right"
      />
    </div>
  );
}

function PrinterForm({ status }: { status: PrinterStatus }) {
  const update = useUpdatePrinter();
  const saved = draftFromStatus(status);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const current = draft ?? saved;
  const input = changes(saved, current);
  const dirty = Object.keys(input).length > 0;
  const unreachable = status.state === 'unreachable';

  function edit(patch: Partial<Draft>) {
    setDraft({ ...current, ...patch });
    setJustSaved(false);
  }

  function save() {
    update.mutate(input, {
      onSuccess: () => {
        setDraft(null);
        setJustSaved(true);
        toast.success('Saved printer settings');
      },
      onError: (error) => toast.error('Could not save printer settings', { description: errorMessage(error) }),
    });
  }

  return (
    <Panel aria-labelledby="print-quality-heading">
      <PanelHeader
        id="print-quality-heading"
        title="Print quality"
        description={`${status.name} · ${printerStateMeta[status.state].label}`}
        className="border-b border-line/70"
      />
      {unreachable && (
        <p role="alert" className="mx-4 mt-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          The printer server is not reachable, so these settings cannot be changed right now.
        </p>
      )}
      <div className="divide-y divide-line/70">
        <SettingRow
          label="Darkness"
          htmlFor="printer-darkness"
          description={
            <>
              How much heat the print head uses. Higher is blacker, but too high can blur small text and barcodes.
              {status.darkness === null && ' The printer did not report its current value.'}
            </>
          }
        >
          <DarknessControl value={current.darkness} onChange={(darkness) => edit({ darkness })} disabled={unreachable} />
        </SettingRow>
        <SettingRow label="Speed" description="Inches per second. Slower speeds print sharper, darker labels.">
          <Segmented aria-label="Print speed" value={current.speed} onValueChange={(speed) => edit({ speed })} options={SPEED_OPTIONS} className="w-full max-w-md" />
        </SettingRow>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line/70 px-4 py-3">
        {justSaved && !dirty && (
          <p role="status" className="mr-auto flex items-center gap-1.5 text-sm text-ink-2">
            <CheckCircle2Icon className="size-4 text-ok" aria-hidden />
            Saved. Print a test label to check the result.
          </p>
        )}
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={update.isPending}>
            Discard changes
          </Button>
        )}
        {justSaved && !dirty ? (
          <TestPrintButton variant="primary" />
        ) : (
          <Button variant="primary" onClick={save} disabled={!dirty || unreachable || update.isPending}>
            {update.isPending && <Spinner />}
            Save
          </Button>
        )}
      </div>
    </Panel>
  );
}

export function PrinterSection() {
  const printer = usePrinterStatus();
  return (
    <>
      <SectionHeader title="Printer" description="Adjust how labels print on the Zebra ZP 450. Changes apply to Label Studio and AirPrint jobs." actions={<TestPrintButton />} />
      {printer.isPending ? (
        <Panel className="flex flex-col gap-4 p-5" role="status" aria-label="Loading printer settings">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Panel>
      ) : printer.isError ? (
        <Panel>
          <ErrorState title="Could not load printer settings" error={printer.error} onRetry={() => void printer.refetch()} />
        </Panel>
      ) : (
        <PrinterForm status={printer.data} />
      )}
    </>
  );
}
