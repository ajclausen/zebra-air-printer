import { PRINTER_DPI } from '@eco/shared';
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignVerticalJustifyCenterIcon,
  AlignVerticalJustifyEndIcon,
  AlignVerticalJustifyStartIcon,
  ImageUpIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented, Slider, SwitchRow } from '@/components/ui/controls';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/menus';
import { canItalic, FONT_IDS, LABEL_FONTS, nearestWeight, WEIGHT_NAMES } from '@/doc/fonts';
import type { BarcodeElement, IconElement, ImageElement, LabelElement, LineElement, ShapeElement, TextElement } from '@/doc/types';
import { prepareImageSource } from '@/render/assets';
import { isMatrix, SYMBOLOGIES, SYMBOLOGY_ORDER } from '@/render/barcode';
import { useContentErrors } from '../canvas/Workspace';
import { useDialogs } from '../dialogs';
import { useEditor } from '../store';
import { NumberField, Row, Section } from './fields';

const DOTS_PER_POINT = PRINTER_DPI / 72;

function useUpdate<T extends LabelElement>(el: T) {
  return (patch: Partial<T>, coalesce?: string) => useEditor.getState().update(el.id, patch as Partial<LabelElement>, coalesce);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function TextProps({ el }: { el: TextElement }) {
  const update = useUpdate(el);
  const font = LABEL_FONTS[el.font];
  const weight = nearestWeight(el.font, el.fontWeight);
  return (
    <>
      <Section title="Text">
        <Textarea
          value={el.text}
          onChange={(e) => update({ text: e.target.value }, `text:${el.id}`)}
          rows={Math.min(6, Math.max(2, el.text.split('\n').length))}
          aria-label="Text content"
          className="font-sans text-sm"
        />
        <p className="-mt-1 text-xs text-ink-3">
          Type <code className="rounded bg-surface px-1 text-ink-2">{'{{Name}}'}</code> for a field filled in when printing, or{' '}
          <code className="rounded bg-surface px-1 text-ink-2">{'{{date}}'}</code>.
        </p>
      </Section>
      <Section title="Type">
        <Select
          aria-label="Font"
          value={el.font}
          onValueChange={(id) => update({ font: id, fontWeight: nearestWeight(id, el.fontWeight) })}
          options={FONT_IDS.map((id) => ({
            value: id,
            label: (
              <span className="flex items-baseline gap-2">
                <span style={{ fontFamily: `"${LABEL_FONTS[id].family}"`, fontWeight: id === 'display' ? 400 : 600 }} className="text-[15px]">
                  {LABEL_FONTS[id].family}
                </span>
                <span className="text-xs text-ink-4">{LABEL_FONTS[id].role}</span>
              </span>
            ),
          }))}
        />
        <div className="grid grid-cols-[1fr_92px] gap-2">
          <Select
            aria-label="Weight"
            value={String(weight)}
            onValueChange={(w) => update({ fontWeight: Number(w) })}
            disabled={font.weights.length < 2}
            options={font.weights.map((w) => ({ value: String(w), label: WEIGHT_NAMES[w] ?? String(w) }))}
          />
          <NumberField
            aria-label="Font size in points"
            value={el.fontSize / DOTS_PER_POINT}
            precision={1}
            min={2}
            max={700}
            suffix="pt"
            disabled={el.autoFit}
            onCommit={(pt) => update({ fontSize: Math.max(4, Math.round(pt * DOTS_PER_POINT)) })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            aria-label="Horizontal alignment"
            value={el.align}
            onValueChange={(align) => update({ align })}
            options={[
              { value: 'left', label: <AlignLeftIcon />, title: 'Align left' },
              { value: 'center', label: <AlignCenterIcon />, title: 'Align center' },
              { value: 'right', label: <AlignRightIcon />, title: 'Align right' },
            ]}
            className="flex-1"
          />
          <Segmented
            aria-label="Vertical alignment"
            value={el.verticalAlign}
            onValueChange={(verticalAlign) => update({ verticalAlign })}
            options={[
              { value: 'top', label: <AlignVerticalJustifyStartIcon />, title: 'Top' },
              { value: 'middle', label: <AlignVerticalJustifyCenterIcon />, title: 'Middle' },
              { value: 'bottom', label: <AlignVerticalJustifyEndIcon />, title: 'Bottom' },
            ]}
            className="flex-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField aria-label="Line height" label="↕" value={el.lineHeight} precision={2} step={0.05} min={0.6} max={3} onCommit={(lineHeight) => update({ lineHeight })} />
          <NumberField aria-label="Letter spacing" label="↔" value={el.letterSpacing / 10} precision={1} step={1} min={-20} max={200} suffix="%" onCommit={(v) => update({ letterSpacing: Math.round(v * 10) })} />
        </div>
      </Section>
      <Section title="Style">
        <SwitchRow id="text-autofit" label="Fit text to box" hint="The size adjusts so the text fills the box." checked={el.autoFit} onCheckedChange={(autoFit) => update({ autoFit })} />
        <SwitchRow id="text-invert" label="White on black" checked={el.invert} onCheckedChange={(invert) => update({ invert })} />
        <SwitchRow id="text-upper" label="All capitals" checked={el.uppercase} onCheckedChange={(uppercase) => update({ uppercase })} />
        <SwitchRow id="text-italic" label="Italic" checked={el.italic && canItalic(el.font, weight)} disabled={!canItalic(el.font, weight)} onCheckedChange={(italic) => update({ italic })} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Barcode
// ---------------------------------------------------------------------------

export function BarcodeProps({ el }: { el: BarcodeElement }) {
  const update = useUpdate(el);
  const errors = useContentErrors();
  const error = errors[el.id];
  const info = SYMBOLOGIES[el.symbology];
  const matrix = isMatrix(el.symbology);
  return (
    <Section title={matrix ? '2D code' : 'Barcode'}>
      <Select
        aria-label="Barcode type"
        value={el.symbology}
        onValueChange={(symbology) => {
          const wasMatrix = isMatrix(el.symbology);
          const toMatrix = isMatrix(symbology);
          const moduleSize = wasMatrix === toMatrix ? el.moduleSize : toMatrix ? 8 : 3;
          const numeric = symbology === 'ean13' || symbology === 'upca';
          const data = numeric && !/^\d+$/.test(el.data) && !el.data.includes('{{') ? SYMBOLOGIES[symbology].sample : el.data;
          update({ symbology, moduleSize, data });
        }}
        options={SYMBOLOGY_ORDER.map((id) => ({ value: id, label: SYMBOLOGIES[id].name }))}
      />
      <div className="flex flex-col gap-1.5">
        <Textarea
          value={el.data}
          onChange={(e) => update({ data: e.target.value }, `data:${el.id}`)}
          rows={matrix ? 3 : 1}
          aria-label="Barcode data"
          aria-invalid={Boolean(error)}
          className="min-h-8 font-mono text-xs"
        />
        {error ? (
          <p className="flex items-start gap-1.5 text-xs text-bad" role="alert">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        ) : (
          <p className="text-xs text-ink-3">{info.hint} Fields like {'{{Asset}}'} work here too.</p>
        )}
      </div>
      {!matrix && <SwitchRow id="barcode-text" label="Show text under bars" checked={el.showText} onCheckedChange={(showText) => update({ showText })} />}
      <Row label="Bar width" htmlFor="barcode-module">
        <NumberField aria-label="Module size in dots" value={el.moduleSize} min={1} max={40} suffix="dots" onCommit={(moduleSize) => update({ moduleSize: Math.round(moduleSize) })} />
      </Row>
      {!matrix && (
        <Row label="Bar height">
          <NumberField aria-label="Bar height in dots" value={el.barHeight} min={10} max={1200} step={5} suffix="dots" onCommit={(barHeight) => update({ barHeight: Math.round(barHeight) })} />
        </Row>
      )}
      <Row label="Rotation">
        <Button variant="secondary" size="sm" onClick={() => update({ angle: ((el.angle + 90) % 360) as BarcodeElement['angle'] })}>
          <RotateCwIcon />
          Rotate 90° <span className="tabular text-ink-4">({el.angle}°)</span>
        </Button>
      </Row>
      <p className="text-xs text-ink-3">Bars are drawn on whole printer dots so they scan. Leave blank space on both sides of 1D barcodes.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export function ImageProps({ el }: { el: ImageElement }) {
  const update = useUpdate(el);
  const fileRef = useRef<HTMLInputElement>(null);
  const crop = el.crop;
  const setCrop = (edge: 'left' | 'top' | 'right' | 'bottom', percent: number) => {
    const v = percent / 100;
    const next = { ...crop };
    if (edge === 'left') {
      const right = crop.x + crop.width;
      next.x = Math.min(v, right - 0.05);
      next.width = right - next.x;
    } else if (edge === 'top') {
      const bottom = crop.y + crop.height;
      next.y = Math.min(v, bottom - 0.05);
      next.height = bottom - next.y;
    } else if (edge === 'right') next.width = Math.max(0.05, 1 - v - crop.x);
    else next.height = Math.max(0.05, 1 - v - crop.y);
    // Keep the element's scale: shrink the box with the crop.
    const sx = next.width / crop.width;
    const sy = next.height / crop.height;
    update({ crop: next, width: Math.max(8, Math.round(el.width * sx)), height: Math.max(8, Math.round(el.height * sy)) }, `crop:${el.id}`);
  };
  return (
    <Section title="Image">
      <Segmented
        aria-label="Conversion"
        value={el.mode}
        onValueChange={(mode) => update({ mode })}
        options={[
          { value: 'dither', label: 'Dither', title: 'Dither: dot patterns for photos and shading' },
          { value: 'threshold', label: 'Threshold', title: 'Threshold: solid black and white for logos and line art' },
        ]}
      />
      <Row label={el.mode === 'dither' ? 'Brightness' : 'Threshold'}>
        <div className="flex items-center gap-2">
          <Slider aria-label="Threshold level" min={20} max={235} step={1} value={[el.threshold]} onValueChange={([v]) => update({ threshold: v ?? 128 }, `threshold:${el.id}`)} />
          <span className="tabular w-8 text-right text-xs text-ink-3">{Math.round((el.threshold / 255) * 100)}%</span>
        </div>
      </Row>
      <SwitchRow id="image-invert" label="Invert" checked={el.invert} onCheckedChange={(invert) => update({ invert })} />
      <div className="flex flex-col gap-2">
        <span className="text-xs text-ink-3">Crop</span>
        <div className="grid grid-cols-2 gap-2">
          <NumberField aria-label="Crop left" label="L" suffix="%" value={crop.x * 100} min={0} max={95} onCommit={(v) => setCrop('left', v)} />
          <NumberField aria-label="Crop right" label="R" suffix="%" value={(1 - crop.x - crop.width) * 100} min={0} max={95} onCommit={(v) => setCrop('right', v)} />
          <NumberField aria-label="Crop top" label="T" suffix="%" value={crop.y * 100} min={0} max={95} onCommit={(v) => setCrop('top', v)} />
          <NumberField aria-label="Crop bottom" label="B" suffix="%" value={(1 - crop.y - crop.height) * 100} min={0} max={95} onCommit={(v) => setCrop('bottom', v)} />
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
        <ImageUpIcon /> Replace image
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const prepared = await prepareImageSource(file);
          const height = Math.round((el.width * prepared.height) / prepared.width);
          update({ src: prepared.src, crop: { x: 0, y: 0, width: 1, height: 1 }, height });
        }}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Icon, shape, line
// ---------------------------------------------------------------------------

export function IconProps({ el }: { el: IconElement }) {
  const update = useUpdate(el);
  const openDialog = useDialogs((s) => s.open);
  return (
    <Section title="Icon">
      <Row label="Line weight">
        <div className="flex items-center gap-2">
          <Slider aria-label="Line weight" min={0.5} max={4} step={0.25} value={[el.strokeWidth]} onValueChange={([v]) => update({ strokeWidth: v ?? 2 }, `stroke:${el.id}`)} />
          <span className="tabular w-8 text-right text-xs text-ink-3">{el.strokeWidth}</span>
        </div>
      </Row>
      <Button variant="secondary" size="sm" onClick={() => openDialog('iconPicker', true)}>
        Replace icon
      </Button>
    </Section>
  );
}

export function ShapeProps({ el }: { el: ShapeElement }) {
  const update = useUpdate(el);
  return (
    <Section title="Shape">
      <Row label="Fill">
        <Segmented
          aria-label="Fill"
          size="sm"
          value={el.fill}
          onValueChange={(fill) => update({ fill })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'black', label: 'Black' },
            { value: 'white', label: 'White' },
          ]}
          className="w-full"
        />
      </Row>
      <Row label="Outline">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <NumberField aria-label="Outline width in dots" value={el.strokeWidth} min={0} max={200} suffix="dots" onCommit={(strokeWidth) => update({ strokeWidth: Math.round(strokeWidth) })} />
          <Segmented
            aria-label="Outline color"
            size="sm"
            value={el.stroke}
            onValueChange={(stroke) => update({ stroke })}
            options={[
              { value: 'black', label: <span className="size-3 rounded-full bg-ink" />, title: 'Black outline' },
              { value: 'white', label: <span className="size-3 rounded-full border border-ink-3 bg-paper" />, title: 'White outline' },
            ]}
          />
        </div>
      </Row>
      {el.shape === 'rect' && (
        <Row label="Corners">
          <NumberField aria-label="Corner radius in dots" value={el.cornerRadius} min={0} max={600} suffix="dots" onCommit={(cornerRadius) => update({ cornerRadius: Math.round(cornerRadius) })} />
        </Row>
      )}
    </Section>
  );
}

export function LineProps({ el }: { el: LineElement }) {
  const update = useUpdate(el);
  return (
    <Section title="Line">
      <Row label="Thickness">
        <NumberField aria-label="Line thickness in dots" value={el.height} min={1} max={200} suffix="dots" onCommit={(height) => update({ height: Math.round(height) })} />
      </Row>
      <Row label="Color">
        <Segmented
          aria-label="Line color"
          size="sm"
          value={el.ink}
          onValueChange={(ink) => update({ ink })}
          options={[
            { value: 'black', label: 'Black' },
            { value: 'white', label: 'White' },
          ]}
          className="w-full"
        />
      </Row>
      <SwitchRow id="line-dashed" label="Dashed" checked={el.dashed} onCheckedChange={(dashed) => update({ dashed })} />
    </Section>
  );
}

