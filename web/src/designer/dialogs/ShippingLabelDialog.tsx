import { PrinterIcon, RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { useStudioSettings } from '@/lib/api/queries';
import { pluralize } from '@/lib/utils';
import { useDialogs } from '../dialogs';
import { getPrintedBy, setPrintedBy, usePrintJob } from '../printing';
import { FallbackNotice, LabelImage, PageStepper, ShippingDropZone, ShippingStatus, SourcePage, useFilePicker } from '../shipping/ShippingPreview';
import { useShippingFile } from '../shipping/useShippingFile';

/**
 * Print a carrier's shipping label from its PDF: the label is found on the
 * page, cropped to 4x6, and printed on its own.
 */
function ShippingLabelBody({ initialFile, onClose }: { initialFile: File | null; onClose: () => void }) {
  const settings = useStudioSettings();
  const [file, setFile] = useState<File | null>(initialFile);
  const state = useShippingFile(file);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [copies, setCopies] = useState(settings.defaultCopies);
  const [name, setName] = useState(getPrintedBy());
  const { printImages, busy } = usePrintJob();
  const picker = useFilePicker((next) => {
    setFile(next);
    setIndex(0);
    setFlipped(false);
  });

  const prepared = state.status === 'ready' ? state.prepared : null;
  const label = prepared?.labels[Math.min(index, prepared.labels.length - 1)];
  const count = prepared ? prepared.labels.length * copies : 0;

  const submit = async () => {
    if (!prepared) return;
    setPrintedBy(name);
    const ok = await printImages({ name: prepared.name, images: prepared.labels.map((l) => (flipped ? l.flipped : l.upright)), copies, source: 'import' });
    if (ok) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Print shipping label</DialogTitle>
        <DialogDescription>The 4 × 6 label is cropped out of the carrier's page and printed on its own.</DialogDescription>
      </DialogHeader>
      <DialogBody className="pb-4">
        {!file ? (
          <ShippingDropZone onFile={setFile} className="min-h-[360px]" />
        ) : (
          <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
            <div className="flex h-[min(58vh,480px)] items-center justify-center rounded-lg bg-desk p-4">
              {label ? (
                <LabelImage src={flipped ? label.flipped : label.upright} alt={`Label ${index + 1} as it will print`} className="h-full" />
              ) : (
                <ShippingStatus state={state} className="h-full" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="truncate text-sm font-medium text-ink" title={file.name}>
                  {file.name}
                </p>
                {label && <SourcePage label={label} className="w-full" />}
                {prepared && <PageStepper index={index} total={prepared.labels.length} onChange={setIndex} />}
                {label?.fallback && <FallbackNotice />}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setFlipped(!flipped)} disabled={!prepared} aria-pressed={flipped}>
                  <RotateCwIcon /> Rotate 180°
                </Button>
                <Button variant="ghost" size="sm" onClick={picker.open}>
                  Choose another file
                </Button>
                {picker.input}
              </div>
              <div className="mt-auto grid grid-cols-[1fr_72px] gap-3 border-t border-line pt-4">
                <Field label="Your name" htmlFor="shipping-printed-by" hint="Optional. Shown in print history.">
                  <Input id="shipping-printed-by" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoComplete="name" />
                </Field>
                <Field label="Copies" htmlFor="shipping-copies">
                  <Input id="shipping-copies" inputMode="numeric" value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))} />
                </Field>
              </div>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <span className="tabular mr-auto text-xs text-ink-3">{count > 0 && pluralize(count, 'label')}</span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy || !prepared} data-testid="shipping-print">
          {busy ? <Spinner className="size-4" /> : <PrinterIcon />}
          Print
        </Button>
      </DialogFooter>
    </>
  );
}

export function ShippingLabelDialog() {
  const state = useDialogs((s) => s.shippingLabel);
  const close = useDialogs((s) => s.close);
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && close('shippingLabel')}>
      <DialogContent className="max-w-[720px]">{state && <ShippingLabelBody initialFile={state.file} onClose={() => close('shippingLabel')} />}</DialogContent>
    </Dialog>
  );
}
