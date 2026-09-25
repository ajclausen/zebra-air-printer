import { useMemo } from 'react';
import {
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignEndHorizontalIcon,
  AlignEndVerticalIcon,
  AlignHorizontalDistributeCenterIcon,
  AlignStartHorizontalIcon,
  AlignStartVerticalIcon,
  AlignVerticalDistributeCenterIcon,
  ArrowDownToLineIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  CopyIcon,
  GroupIcon,
  LockIcon,
  LockOpenIcon,
  RectangleHorizontalIcon,
  RectangleVerticalIcon,
  Trash2Icon,
  UngroupIcon,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/menus';
import { describeElement, documentFields, documentUsesCounter, ELEMENT_TYPE_NAMES } from '@/doc/elements';
import { dotsToUnit, unitToDots, type Unit } from '@/doc/geometry';
import type { Alignment } from '@/doc/operations';
import type { LabelElement } from '@/doc/types';
import { cn, modKey } from '@/lib/utils';
import { useEditor } from '../store';
import { BarcodeProps, IconProps, ImageProps, LineProps, ShapeProps, TextProps } from './ElementProps';
import { IconButtonGroup, NumberField, Section } from './fields';

function ToolButton({ label, shortcut, onClick, disabled, children, active }: { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; active?: boolean }) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled} className={cn('w-full', active && 'bg-ink/[0.08]')}>
        {children}
      </Button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Position and size
// ---------------------------------------------------------------------------

function GeometrySection({ el, unit }: { el: LabelElement; unit: Unit }) {
  const update = (patch: Partial<LabelElement>) => useEditor.getState().update(el.id, patch);
  const precision = unit === 'in' ? 2 : 1;
  const step = unit === 'in' ? 0.05 : 1;
  const toUnit = (dots: number) => dotsToUnit(dots, unit);
  const derivedSize = el.type === 'barcode';
  const textAuto = el.type === 'text' && !el.autoFit;
  const fixedHeight = el.type === 'line';
  return (
    <Section
      title="Position and size"
      action={
        <Segmented
          aria-label="Units"
          size="sm"
          value={unit}
          onValueChange={(u) => useEditor.getState().setUnit(u)}
          options={[
            { value: 'in', label: 'in' },
            { value: 'mm', label: 'mm' },
          ]}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <NumberField aria-label={`X position in ${unit}`} label="X" value={toUnit(el.x)} precision={precision} step={step} onCommit={(v) => update({ x: unitToDots(v, unit) })} disabled={el.locked} />
        <NumberField aria-label={`Y position in ${unit}`} label="Y" value={toUnit(el.y)} precision={precision} step={step} onCommit={(v) => update({ y: unitToDots(v, unit) })} disabled={el.locked} />
        <NumberField
          aria-label={`Width in ${unit}`}
          label="W"
          value={toUnit(el.width)}
          precision={precision}
          step={step}
          min={0.01}
          disabled={derivedSize || el.locked}
          onCommit={(v) => update({ width: Math.max(1, unitToDots(v, unit)) })}
        />
        <NumberField
          aria-label={`Height in ${unit}`}
          label="H"
          value={toUnit(el.height)}
          precision={precision}
          step={step}
          min={0.01}
          disabled={derivedSize || fixedHeight || el.locked}
          onCommit={(v) => update({ height: Math.max(1, unitToDots(v, unit)) })}
        />
        {el.type !== 'barcode' && (
          <NumberField aria-label="Rotation in degrees" label="↻" value={el.angle} suffix="°" precision={1} min={-360} max={360} onCommit={(v) => update({ angle: ((v % 360) + 360) % 360 })} disabled={el.locked} />
        )}
      </div>
      {textAuto && <p className="text-xs text-ink-3">Height grows with the text. Turn on “Fit text to box” to size text to a fixed box.</p>}
      {derivedSize && <p className="text-xs text-ink-3">Size comes from the data and bar width.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Arrange
// ---------------------------------------------------------------------------

const ALIGN: Array<{ value: Alignment; label: string; single: string; icon: typeof AlignStartVerticalIcon }> = [
  { value: 'left', label: 'Align left edges', single: 'Move to left edge', icon: AlignStartVerticalIcon },
  { value: 'center', label: 'Align centers horizontally', single: 'Center horizontally on label', icon: AlignCenterVerticalIcon },
  { value: 'right', label: 'Align right edges', single: 'Move to right edge', icon: AlignEndVerticalIcon },
  { value: 'top', label: 'Align top edges', single: 'Move to top edge', icon: AlignStartHorizontalIcon },
  { value: 'middle', label: 'Align centers vertically', single: 'Center vertically on label', icon: AlignCenterHorizontalIcon },
  { value: 'bottom', label: 'Align bottom edges', single: 'Move to bottom edge', icon: AlignEndHorizontalIcon },
];

function ArrangeSection({ ids, elements }: { ids: string[]; elements: LabelElement[] }) {
  const s = useEditor.getState;
  const single = elements.length === 1 || new Set(elements.map((e) => e.groupId ?? e.id)).size === 1;
  const grouped = elements.some((e) => e.groupId);
  const allLocked = elements.every((e) => e.locked);
  return (
    <Section title={single ? 'Arrange on label' : 'Arrange'}>
      <IconButtonGroup>
        {ALIGN.map((a) => (
          <ToolButton key={a.value} label={single ? a.single : a.label} onClick={() => s().align(ids, a.value)}>
            <a.icon />
          </ToolButton>
        ))}
      </IconButtonGroup>
      {elements.length >= 3 && (
        <IconButtonGroup>
          <ToolButton label="Distribute horizontally" onClick={() => s().distribute(ids, 'horizontal')}>
            <AlignHorizontalDistributeCenterIcon />
          </ToolButton>
          <ToolButton label="Distribute vertically" onClick={() => s().distribute(ids, 'vertical')}>
            <AlignVerticalDistributeCenterIcon />
          </ToolButton>
        </IconButtonGroup>
      )}
      <IconButtonGroup>
        <ToolButton label="Bring to front" shortcut={`${modKey}⇧]`} onClick={() => s().reorder(ids, 'front')}>
          <ArrowUpToLineIcon />
        </ToolButton>
        <ToolButton label="Bring forward" shortcut={`${modKey}]`} onClick={() => s().reorder(ids, 'forward')}>
          <ArrowUpIcon />
        </ToolButton>
        <ToolButton label="Send backward" shortcut={`${modKey}[`} onClick={() => s().reorder(ids, 'backward')}>
          <ArrowDownIcon />
        </ToolButton>
        <ToolButton label="Send to back" shortcut={`${modKey}⇧[`} onClick={() => s().reorder(ids, 'back')}>
          <ArrowDownToLineIcon />
        </ToolButton>
      </IconButtonGroup>
      <IconButtonGroup>
        <ToolButton label="Duplicate" shortcut={`${modKey}D`} onClick={() => s().duplicate(ids)}>
          <CopyIcon />
        </ToolButton>
        {grouped ? (
          <ToolButton label="Ungroup" shortcut={`${modKey}⇧G`} onClick={() => s().ungroup(ids)}>
            <UngroupIcon />
          </ToolButton>
        ) : (
          <ToolButton label="Group" shortcut={`${modKey}G`} onClick={() => s().group(ids)} disabled={elements.length < 2}>
            <GroupIcon />
          </ToolButton>
        )}
        <ToolButton label={allLocked ? 'Unlock' : 'Lock'} shortcut={`${modKey}L`} active={allLocked} onClick={() => s().setLocked(ids, !allLocked)}>
          {allLocked ? <LockIcon /> : <LockOpenIcon />}
        </ToolButton>
        <ToolButton label="Delete" shortcut="⌫" onClick={() => s().remove(ids)} disabled={allLocked}>
          <Trash2Icon />
        </ToolButton>
      </IconButtonGroup>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Nothing selected: label settings and fields
// ---------------------------------------------------------------------------

function LabelSettings() {
  const { doc, unit } = useEditor(useShallow((st) => ({ doc: st.doc, unit: st.unit })));
  const fields = documentFields(doc);
  const counter = documentUsesCounter(doc);
  return (
    <>
      <Section title="Label">
        <Segmented
          aria-label="Orientation"
          value={doc.orientation}
          onValueChange={(o) => useEditor.getState().setOrientation(o)}
          options={[
            { value: 'portrait', label: <><RectangleVerticalIcon /> Portrait</> },
            { value: 'landscape', label: <><RectangleHorizontalIcon /> Landscape</> },
          ]}
        />
        <dl className="grid grid-cols-[76px_1fr] gap-y-1.5 text-xs">
          <dt className="text-ink-3">Size</dt>
          <dd className="tabular text-ink-2">{doc.orientation === 'portrait' ? (unit === 'in' ? '4 × 6 in' : '102 × 152 mm') : unit === 'in' ? '6 × 4 in' : '152 × 102 mm'}</dd>
          <dt className="text-ink-3">Printer</dt>
          <dd className="text-ink-2">Zebra ZP 450, 203 dpi, black only</dd>
          <dt className="text-ink-3">Elements</dt>
          <dd className="tabular text-ink-2">{doc.elements.length}</dd>
        </dl>
      </Section>
      <Section title="Fill-in fields">
        {fields.length === 0 && !counter ? (
          <p className="text-xs leading-relaxed text-ink-3">
            Type <code className="rounded bg-surface px-1 text-ink-2">{'{{Name}}'}</code> in any text or barcode to ask for a value each time you print. Built-ins: {'{{date}}'},{' '}
            {'{{time}}'}, {'{{counter}}'}.
          </p>
        ) : (
          <>
            {fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5 rounded-lg bg-surface p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-xs font-medium text-ink-2">{`{{${field.key}}}`}</code>
                </div>
                <Input
                  aria-label={`Label for ${field.key}`}
                  value={field.label}
                  placeholder="Question shown when printing"
                  onChange={(e) => useEditor.getState().setField({ ...field, label: e.target.value })}
                  className="h-7 text-xs"
                />
                <Input
                  aria-label={`Default value for ${field.key}`}
                  value={field.defaultValue ?? ''}
                  placeholder="Default value (optional)"
                  onChange={(e) => useEditor.getState().setField({ ...field, defaultValue: e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
            ))}
            {counter && <p className="text-xs text-ink-3">This label uses {'{{counter}}'}. Choose the numbers when you print.</p>}
          </>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function PropertiesPanel() {
  const { elements, selection, unit } = useEditor(useShallow((st) => ({ elements: st.doc.elements, selection: st.selection, unit: st.unit })));
  const selected = useMemo(() => elements.filter((e) => selection.includes(e.id)), [elements, selection]);
  const ids = selected.map((e) => e.id);
  const el = selected.length === 1 ? selected[0]! : null;

  return (
    <aside aria-label="Properties" className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-l border-line bg-paper" data-testid="properties-panel">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="truncate text-sm font-semibold text-ink">
          {selected.length === 0 ? 'Label settings' : el ? describeElement(el) : `${selected.length} elements`}
        </h2>
        {el && describeElement(el) !== ELEMENT_TYPE_NAMES[el.type] && <span className="ml-auto shrink-0 text-xs text-ink-4">{ELEMENT_TYPE_NAMES[el.type]}</span>}
      </div>
      {selected.length === 0 && <LabelSettings />}
      {el && (
        <>
          {el.type === 'text' && <TextProps el={el} />}
          {el.type === 'barcode' && <BarcodeProps el={el} />}
          {el.type === 'image' && <ImageProps el={el} />}
          {el.type === 'icon' && <IconProps el={el} />}
          {el.type === 'shape' && <ShapeProps el={el} />}
          {el.type === 'line' && <LineProps el={el} />}
          <GeometrySection el={el} unit={unit} />
        </>
      )}
      {selected.length > 0 && <ArrangeSection ids={ids} elements={selected} />}
    </aside>
  );
}
