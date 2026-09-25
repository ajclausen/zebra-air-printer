import { Slider as SliderPrimitive, Switch as SwitchPrimitive, Tabs as TabsPrimitive, ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent bg-line-strong transition-colors outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-1 disabled:opacity-50 data-[state=checked]:bg-cobalt',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform data-[state=checked]:translate-x-[15px]" />
    </SwitchPrimitive.Root>
  );
}

/** A labelled switch row, the standard boolean property control. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="flex flex-col gap-0.5 text-sm text-ink select-none">
        {label}
        {hint && <span className="text-xs text-ink-3">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn('relative flex h-5 w-full touch-none items-center select-none', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full bg-cobalt" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={props['aria-label']}
        className="block size-4 rounded-full border border-line-strong bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
      />
    </SliderPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (single-select toggle group)
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentOption<T>[];
  className?: string;
  size?: 'sm' | 'md';
  'aria-label': string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      aria-label={ariaLabel}
      onValueChange={(v) => v && onValueChange(v as T)}
      className={cn('inline-flex rounded-md bg-ink/[0.06] p-0.5', className)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          title={option.title}
          aria-label={option.title}
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-1 rounded-[5px] px-2 font-medium text-ink-3 transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt data-[state=on]:bg-paper data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgb(24_26_31/0.12)] [&_svg]:size-4',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
          )}
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex rounded-md bg-ink/[0.06] p-0.5', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-3 text-sm font-medium text-ink-3 transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgb(24_26_31/0.12)] [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} className={cn(vertical ? 'mx-1 h-5 w-px' : 'h-px w-full', 'shrink-0 bg-line', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'cobalt';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-2',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  cobalt: 'bg-cobalt-soft text-cobalt-strong',
};

export function Badge({ tone = 'neutral', className, ...props }: React.ComponentProps<'span'> & { tone?: Tone }) {
  return <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap', toneClass[tone], className)} {...props} />;
}

export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  const color = { neutral: 'bg-ink-4', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', cobalt: 'bg-cobalt' }[tone];
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', color, pulse && 'animate-pulse-dot', className)} />;
}
