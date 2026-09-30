import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { documentFields, documentUsesCounter } from '@/doc/elements';
import { toast } from 'sonner';
import { MAX_LABELS_PER_JOB } from '@/doc/batch';
import type { LabelDocument, LabelInstance } from '@/doc/types';
import { api, errorMessage } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queries';
import { pluralize } from '@/lib/utils';
import { renderPrintJob } from '@/render/print';
import { useDialogs } from './dialogs';
import { useEditor } from './store';

// ---------------------------------------------------------------------------
// "Printed by" name: optional, asked once, remembered in this browser.
// ---------------------------------------------------------------------------

const PRINTED_BY_KEY = 'eco.studio.printedBy';
const PRINTED_BY_ASKED_KEY = 'eco.studio.printedByAsked';

export function getPrintedBy(): string {
  return localStorage.getItem(PRINTED_BY_KEY) ?? '';
}

export function setPrintedBy(name: string): void {
  localStorage.setItem(PRINTED_BY_KEY, name.trim());
  localStorage.setItem(PRINTED_BY_ASKED_KEY, '1');
}

export function hasAskedPrintedBy(): boolean {
  return localStorage.getItem(PRINTED_BY_ASKED_KEY) === '1';
}

// ---------------------------------------------------------------------------
// Print job
// ---------------------------------------------------------------------------

export interface PrintJobRequest {
  doc: LabelDocument;
  instances: LabelInstance[];
  copies: number;
  name: string;
  designId: string | null;
}


export interface PrintImagesRequest {
  /** PNG data URLs, already 812 x 1218 pure black/white. */
  images: string[];
  copies: number;
  name: string;
  source: 'import';
}

export type PrintPhase = { kind: 'idle' } | { kind: 'rendering'; done: number; total: number } | { kind: 'sending'; total: number };

/**
 * Render every label in the browser, send the bitmaps to the server, and
 * report progress with a single toast that updates in place. `printImages`
 * sends labels that are already rendered (imported shipping labels).
 */
export function usePrintJob() {
  const client = useQueryClient();
  const [phase, setPhase] = useState<PrintPhase>({ kind: 'idle' });

  const run = useCallback(
    async (total: number, copies: number, work: (toastId: string | number) => Promise<void>): Promise<boolean> => {
      if (total === 0) return false;
      if (total > MAX_LABELS_PER_JOB) {
        toast.error(`One print job can hold up to ${MAX_LABELS_PER_JOB} labels.`, { description: `This job has ${total}. Split it into smaller runs.` });
        return false;
      }
      const toastId = toast.loading(total > 1 ? `Preparing ${total} labels…` : 'Preparing label…');
      try {
        await work(toastId);
        const count = total * copies;
        toast.success(`Sent ${pluralize(count, 'label')} to the printer`, {
          id: toastId,
          description: total > 1 && copies > 1 ? `${total} different labels, ${copies} copies each.` : undefined,
        });
        return true;
      } catch (error) {
        toast.error('Could not print', { id: toastId, description: errorMessage(error) });
        return false;
      } finally {
        setPhase({ kind: 'idle' });
        void client.invalidateQueries({ queryKey: queryKeys.printer });
        void client.invalidateQueries({ queryKey: queryKeys.history });
        void client.invalidateQueries({ queryKey: queryKeys.allDesigns });
      }
    },
    [client],
  );

  const print = useCallback(
    (request: PrintJobRequest): Promise<boolean> => {
      const total = request.instances.length;
      return run(total, request.copies, async (toastId) => {
        setPhase({ kind: 'rendering', done: 0, total });
        const labels = await renderPrintJob(request.doc, request.instances, (done) => {
          setPhase({ kind: 'rendering', done, total });
          if (total > 1) toast.loading(`Preparing labels… ${done} of ${total}`, { id: toastId });
        });
        setPhase({ kind: 'sending', total });
        toast.loading('Sending to the printer…', { id: toastId });
        await api.print({
          name: request.name,
          images: labels.map((l) => l.dataUrl),
          copies: request.copies,
          designId: request.designId,
          printedBy: getPrintedBy() || null,
        });
      });
    },
    [run],
  );

  const printImages = useCallback(
    (request: PrintImagesRequest): Promise<boolean> =>
      run(request.images.length, request.copies, async (toastId) => {
        setPhase({ kind: 'sending', total: request.images.length });
        toast.loading('Sending to the printer…', { id: toastId });
        await api.print({
          name: request.name,
          images: request.images,
          copies: request.copies,
          designId: null,
          printedBy: getPrintedBy() || null,
          source: request.source,
        });
      }),
    [run],
  );

  return { print, printImages, phase, busy: phase.kind !== 'idle' };
}

/**
 * What the Print button does: print right away when there is nothing to ask,
 * otherwise open the print dialog (fields, counter, or the one-time name prompt).
 */
export function usePrintAction(getCopies: () => number) {
  const job = usePrintJob();
  const { print } = job;
  const start = useCallback(async () => {
    const { doc, meta } = useEditor.getState();
    if (!doc.elements.length) {
      toast('The label is empty', { description: 'Add text, a barcode, or pick a template first.' });
      return;
    }
    const usesCounter = documentUsesCounter(doc);
    if (documentFields(doc).length > 0 || usesCounter || !hasAskedPrintedBy()) {
      useDialogs.getState().open('print', { mode: usesCounter ? 'sequence' : 'single' });
      return;
    }
    await print({ doc, instances: [{ values: {}, counter: '1' }], copies: getCopies(), name: meta.name, designId: meta.designId });
  }, [print, getCopies]);
  return { ...job, start };
}
