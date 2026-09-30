import { ChevronLeftIcon, ChevronRightIcon, FileUpIcon, TriangleAlertIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { IMPORT_ACCEPT, isImportable, type PreparedLabel } from '@/import/prepare';
import { cn } from '@/lib/utils';
import type { ShippingFileState } from './useShippingFile';

/** Hidden file input plus a function that opens it. */
export function useFilePicker(onFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={IMPORT_ACCEPT}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
      data-testid="shipping-file-input"
    />
  );
  return { input, open: () => inputRef.current?.click() };
}

/** Accept a file only if it's a type we can import; say so otherwise. */
export function acceptShippingFile(file: File, onFile: (file: File) => void): void {
  if (isImportable(file)) onFile(file);
  else toast.error('Choose a PDF, PNG, or JPEG.', { description: `“${file.name}” isn't a label file.` });
}

export function ShippingDropZone({ onFile, className }: { onFile: (file: File) => void; className?: string }) {
  const [over, setOver] = useState(false);
  const picker = useFilePicker(onFile);
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line-strong bg-surface px-6 py-12 text-center transition-colors',
        over && 'border-cobalt bg-cobalt-soft',
        className,
      )}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) acceptShippingFile(file, onFile);
      }}
    >
      <FileUpIcon className="size-7 text-ink-3" />
      <div>
        <p className="text-sm font-medium text-ink">Drop the label PDF here</p>
        <p className="mt-0.5 text-xs text-ink-3">The PDF from FedEx, UPS, USPS, or another carrier. PNG and JPEG work too.</p>
      </div>
      <Button variant="secondary" onClick={picker.open}>
        Choose file
      </Button>
      {picker.input}
    </div>
  );
}

/** The label exactly as it will print. */
export function LabelImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={cn('aspect-[812/1218] overflow-hidden rounded-[10px] bg-paper shadow-label', className)}>
      <img src={src} alt={alt} className="pixelated size-full" data-testid="shipping-label-preview" />
    </div>
  );
}

/** The source page with the part that prints outlined. */
export function SourcePage({ label, className }: { label: PreparedLabel; className?: string }) {
  const box = label.cropBox;
  return (
    <div className={cn('relative overflow-hidden rounded-md border border-line bg-paper', className)} style={{ aspectRatio: label.pageAspect }}>
      <img src={label.pageThumb} alt="The page from the file" className="size-full opacity-60" />
      <div
        aria-hidden
        className="absolute rounded-[2px] border-2 border-cobalt bg-cobalt/10"
        style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
      />
    </div>
  );
}

export function FallbackNotice({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-start gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn', className)} role="status">
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
      Couldn't find a 4 × 6 label on this page. Printing the whole page scaled to fit.
    </p>
  );
}

export function PageStepper({ index, total, onChange }: { index: number; total: number; onChange: (index: number) => void }) {
  if (total < 2) return null;
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Previous label" disabled={index === 0} onClick={() => onChange(index - 1)}>
        <ChevronLeftIcon />
      </Button>
      <span className="tabular min-w-[92px] text-center text-xs text-ink-2" aria-live="polite">
        Label {index + 1} of {total}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Next label" disabled={index === total - 1} onClick={() => onChange(index + 1)}>
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/** Loading and error states shared by the dialog and the phone screen. */
export function ShippingStatus({ state, className }: { state: ShippingFileState; className?: string }) {
  if (state.status === 'loading') {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 text-sm text-ink-3', className)}>
        <Spinner className="size-5" />
        {state.total && state.total > 1 ? `Reading page ${Math.min(state.done + 1, state.total)} of ${state.total}…` : 'Finding the label…'}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-bad', className)} role="alert">
        <TriangleAlertIcon className="size-5" />
        {state.message}
      </div>
    );
  }
  return null;
}
