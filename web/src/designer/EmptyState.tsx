import { BarcodeIcon, FilePlusIcon, ImageIcon, LayoutTemplateIcon, QrCodeIcon, TypeIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { insertBasic, newBlankLabel, pickImageFile } from './actions';
import { usePanel } from './panels/LeftPanel';
import { useEditor } from './store';

/** First-visit choice: a template or a blank label. */
function Welcome() {
  const setPanel = usePanel((s) => s.setPanel);
  return (
    <div className="pointer-events-auto w-[340px] rounded-xl border border-line bg-paper/95 p-5 shadow-dialog backdrop-blur" data-testid="empty-state">
      <h2 className="text-xl font-semibold tracking-[-0.015em] text-ink">Make a label</h2>
      <p className="mt-1 text-sm text-ink-3">4 × 6 in thermal label. What you see here is exactly what prints.</p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setPanel('templates')}
          className="group flex items-center gap-3 rounded-lg border border-cobalt/30 bg-cobalt-soft/60 p-3 text-left outline-none hover:border-cobalt hover:bg-cobalt-soft focus-visible:ring-2 focus-visible:ring-cobalt"
          data-testid="start-template"
        >
          <span className="flex size-9 items-center justify-center rounded-md bg-cobalt text-white">
            <LayoutTemplateIcon className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink">Start from a template</span>
            <span className="block text-xs text-ink-3">Pick one on the left and fill in the blanks</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            newBlankLabel();
            setPanel('elements');
          }}
          className="group flex items-center gap-3 rounded-lg border border-line p-3 text-left outline-none hover:border-ink-4 hover:bg-surface focus-visible:ring-2 focus-visible:ring-cobalt"
          data-testid="start-blank"
        >
          <span className="flex size-9 items-center justify-center rounded-md bg-surface text-ink-2">
            <FilePlusIcon className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink">Blank label</span>
            <span className="block text-xs text-ink-3">Add text, barcodes, icons, and images yourself</span>
          </span>
        </button>
      </div>
    </div>
  );
}

/** Quiet prompt on an empty label with the most common first elements. */
function BlankHint() {
  const quick = [
    { label: 'Text', icon: TypeIcon, run: () => insertBasic('heading') },
    { label: 'Barcode', icon: BarcodeIcon, run: () => insertBasic('barcode') },
    { label: 'QR code', icon: QrCodeIcon, run: () => insertBasic('qrcode') },
    { label: 'Image', icon: ImageIcon, run: pickImageFile },
  ];
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-3 text-center" data-testid="blank-hint">
      <p className="text-sm text-ink-3">This label is empty. Add something, or drop an image here.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {quick.map((q) => (
          <Button key={q.label} variant="secondary" size="sm" onClick={q.run}>
            <q.icon /> {q.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function EmptyState() {
  const { started, empty } = useEditor(useShallow((s) => ({ started: s.started, empty: s.doc.elements.length === 0 })));
  if (!empty) return null;
  return <div className="flex h-full items-center justify-center p-6">{started ? <BlankHint /> : <Welcome />}</div>;
}
