import {
  BarcodeIcon,
  BracesIcon,
  CalendarClockIcon,
  CircleIcon,
  HashIcon,
  HeadingIcon,
  ImageIcon,
  MinusIcon,
  QrCodeIcon,
  ShapesIcon,
  SquareIcon,
  SquareRoundCornerIcon,
  TypeIcon,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Kbd } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { cn, modKey } from '@/lib/utils';
import { insertBasic, insertField, insertText, pickImageFile, type BasicElementKind } from '../actions';
import { useDialogs } from '../dialogs';
import { PanelHeader, PanelScroll } from './PanelShell';

const tileClass =
  'group flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-paper text-xs font-medium text-ink-2 shadow-[0_1px_0_rgb(24_26_31/0.03)] outline-none transition-[border-color,background-color,color] hover:border-ink-4 hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt active:bg-surface data-[state=open]:border-cobalt data-[state=open]:text-ink [&_svg]:size-5 [&_svg]:text-ink-3 [&:hover_svg]:text-ink';

type Tile = { id: string; label: string; icon: ComponentType<{ className?: string }> };

const BASIC: Array<Tile & { kind: BasicElementKind }> = [
  { id: 'text', kind: 'text', label: 'Text', icon: TypeIcon },
  { id: 'heading', kind: 'heading', label: 'Heading', icon: HeadingIcon },
  { id: 'barcode', kind: 'barcode', label: 'Barcode', icon: BarcodeIcon },
  { id: 'qrcode', kind: 'qrcode', label: 'QR code', icon: QrCodeIcon },
];

const SHAPES: Array<Tile & { kind: BasicElementKind }> = [
  { id: 'rect', kind: 'rect', label: 'Rectangle', icon: SquareIcon },
  { id: 'rounded', kind: 'rounded', label: 'Rounded', icon: SquareRoundCornerIcon },
  { id: 'ellipse', kind: 'ellipse', label: 'Ellipse', icon: CircleIcon },
  { id: 'line', kind: 'line', label: 'Line', icon: MinusIcon },
];

const DATE_OPTIONS = [
  { label: 'Today’s date', text: '{{date}}', hint: 'Sep 25, 2026' },
  { label: 'Date and time', text: '{{date}} {{time}}', hint: 'Sep 25, 2026 3:05 PM' },
  { label: 'Numeric date', text: '{{date:YYYY-MM-DD}}', hint: '2026-09-25' },
  { label: 'Use by (in 3 days)', text: 'Use by {{date+3}}', hint: 'Use by Sep 28, 2026' },
  { label: 'Time', text: '{{time}}', hint: '3:05 PM' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5" aria-label={title}>
      <h3 className="mb-2 px-1 text-xs font-semibold text-ink-2">{title}</h3>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </section>
  );
}

function FieldTile() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    insertField(name);
    setName('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={tileClass} data-testid="element-field">
          <BracesIcon />
          Field
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-72">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <div>
            <label htmlFor="new-field-name" className="text-sm font-semibold text-ink">
              Add a fill-in field
            </label>
            <p className="mt-0.5 text-xs text-ink-3">You type its value each time you print. Use it in any text or barcode as {'{{Name}}'}.</p>
          </div>
          <Input id="new-field-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Recipient, Plate, Room" maxLength={40} />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Add field
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ElementsPanel() {
  const openDialog = useDialogs((s) => s.open);
  return (
    <>
      <PanelHeader title="Elements" />
      <PanelScroll className="px-4">
        <Section title="Text and codes">
          {BASIC.map((t) => (
            <button key={t.id} type="button" className={tileClass} onClick={() => insertBasic(t.kind)} data-testid={`element-${t.id}`}>
              <t.icon />
              {t.label}
            </button>
          ))}
          <button type="button" className={tileClass} onClick={() => openDialog('iconPicker', true)} data-testid="element-icon">
            <ShapesIcon />
            Icon
          </button>
          <button type="button" className={tileClass} onClick={pickImageFile} data-testid="element-image">
            <ImageIcon />
            Image
          </button>
        </Section>

        <Section title="Shapes">
          {SHAPES.map((t) => (
            <button key={t.id} type="button" className={tileClass} onClick={() => insertBasic(t.kind)} data-testid={`element-${t.id}`}>
              <t.icon />
              {t.label}
            </button>
          ))}
        </Section>

        <Section title="Filled in when printing">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={tileClass} data-testid="element-date">
                <CalendarClockIcon />
                Date/time
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-64">
              {DATE_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.label} onSelect={() => insertText(option.text)} className="h-auto flex-col items-start gap-0 py-1.5">
                  <span>{option.label}</span>
                  <span className="text-xs text-ink-3">{option.hint}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className={tileClass} onClick={() => insertText('No. {{counter}}', { fontSize: 64, fontWeight: 700 })} data-testid="element-counter">
            <HashIcon />
            Counter
          </button>
          <FieldTile />
        </Section>

        <div className={cn('mt-2 rounded-lg bg-surface p-3 text-xs leading-relaxed text-ink-3')}>
          Drop or paste an image anywhere on the label. Double-click text to edit it. Hold <Kbd>⇧</Kbd> while nudging with the arrow keys to move 10 dots.{' '}
          <button type="button" className="font-medium text-cobalt hover:underline" onClick={() => openDialog('shortcuts', true)}>
            All shortcuts
          </button>
          <span className="sr-only"> ({modKey})</span>
        </div>
      </PanelScroll>
    </>
  );
}
