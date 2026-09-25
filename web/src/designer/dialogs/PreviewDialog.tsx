import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { defaultFieldValues, documentUsesCounter } from '@/doc/elements';
import type { LabelDocument, LabelInstance } from '@/doc/types';
import { errorMessage } from '@/lib/api/client';
import { pluralize } from '@/lib/utils';
import { bitmapToCanvas, renderPrintBitmap } from '@/render/print';
import { useDialogs } from '../dialogs';
import { useEditor } from '../store';

/** How many labels to render eagerly; the rest render as they scroll into view. */
const EAGER = 12;

function LabelPreview({ doc, instance, index, eager }: { doc: LabelDocument; instance: LabelInstance; index: number; eager: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(eager);
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (visible || !node) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '400px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, node]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    renderPrintBitmap(doc, instance)
      .then((bitmap) => alive && setSrc(bitmapToCanvas(bitmap).toDataURL('image/png')))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [doc, instance, visible]);

  return (
    <figure ref={setNode} className="flex shrink-0 flex-col items-center gap-2">
      <div className="relative flex h-[min(62vh,540px)] items-center justify-center">
        <div className="aspect-[812/1218] h-full overflow-hidden rounded-[10px] bg-paper shadow-label">
          {src ? (
            <img src={src} alt={`Label ${index + 1} as printed`} className="pixelated size-full" data-testid="preview-image" />
          ) : error ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-bad">
              <TriangleAlertIcon className="size-5" />
              {error}
            </div>
          ) : (
            <div className="flex size-full items-center justify-center text-ink-4">
              <Spinner />
            </div>
          )}
        </div>
      </div>
      <figcaption className="tabular text-xs text-ink-3">
        {index + 1}
        {documentUsesCounter(doc) ? ` · ${instance.counter}` : ''}
      </figcaption>
    </figure>
  );
}

/**
 * Shows the exact 812 x 1218 black-and-white bitmaps that will be sent to the
 * printer (landscape designs appear rotated, as the printer receives them).
 */
export function PreviewDialog({ doc, instances, copies = 1, onClose }: { doc: LabelDocument; instances: LabelInstance[]; copies?: number; onClose: () => void }) {
  const landscape = doc.orientation === 'landscape';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(1100px,calc(100vw-32px))] bg-surface">
        <DialogHeader>
          <DialogTitle>Print preview</DialogTitle>
          <DialogDescription>
            {instances.length > 1 ? `${pluralize(instances.length, 'label')}${copies > 1 ? `, ${copies} copies each` : ''}. ` : copies > 1 ? `${copies} copies. ` : ''}
            Exactly what the printer receives: every dot is black or white{landscape ? ', and landscape labels are turned to feed through the printer' : ''}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          <div className={instances.length > 1 ? 'flex gap-6 overflow-x-auto pb-3' : 'flex justify-center'} data-testid="preview-strip">
            {instances.map((instance, i) => (
              <LabelPreview key={i} doc={doc} instance={instance} index={i} eager={i < EAGER} />
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Preview from the top bar: one label with the default field values. */
export function QuickPreviewDialog() {
  const open = useDialogs((s) => s.preview);
  const close = useDialogs((s) => s.close);
  const doc = useEditor((s) => s.doc);
  if (!open) return null;
  return <PreviewDialog doc={doc} instances={[{ values: defaultFieldValues(doc), counter: '1' }]} onClose={() => close('preview')} />;
}
