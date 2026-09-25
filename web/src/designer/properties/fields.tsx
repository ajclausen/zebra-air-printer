import { useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0" aria-label={title}>
      <div className="mb-3 flex h-5 items-center justify-between">
        <h3 className="text-xs font-semibold text-ink-2">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2">
      <label htmlFor={htmlFor} className="text-xs text-ink-3">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface NumberFieldProps {
  value: number;
  onCommit: (value: number) => void;
  /** Short suffix or prefix shown inside the field, e.g. "X" or "pt". */
  label?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  disabled?: boolean;
  'aria-label': string;
  className?: string;
}

/**
 * Compact numeric input. Commits on Enter or blur; arrow keys step by `step`
 * (Shift for 10x). Keeps a local draft so typing is never interrupted.
 */
export function NumberField({ value, onCommit, label, suffix, step = 1, min = -Infinity, max = Infinity, precision = 0, disabled, className, ...rest }: NumberFieldProps) {
  const format = (n: number) => String(Number(n.toFixed(precision)));
  const [draft, setDraft] = useState(format(value));
  const focused = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!focused.current) setDraft(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, precision]);

  const commit = (text: string) => {
    const parsed = Number(text.replace(',', '.'));
    if (!Number.isFinite(parsed) || text.trim() === '') {
      setDraft(format(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(format(clamped));
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
  };

  return (
    <div
      className={cn(
        'flex h-8 min-w-0 items-center rounded-md border border-line-strong bg-paper text-sm focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt-ring hover:border-ink-4',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {label && (
        <label htmlFor={id} className="w-6 shrink-0 cursor-ew-resize pl-2 text-xs font-medium text-ink-4 select-none">
          {label}
        </label>
      )}
      <input
        id={id}
        value={draft}
        disabled={disabled}
        inputMode="decimal"
        aria-label={rest['aria-label']}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(format(value));
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
            const base = Number(draft);
            const next = Math.min(max, Math.max(min, (Number.isFinite(base) ? base : value) + delta));
            setDraft(format(next));
            onCommit(Number(next.toFixed(precision)));
          }
        }}
        className={cn('tabular h-full w-full min-w-0 bg-transparent px-2 outline-none', label && 'pl-1')}
      />
      {suffix && <span className="shrink-0 pr-2 text-xs text-ink-4 select-none">{suffix}</span>}
    </div>
  );
}

/** Icon button group used for alignment, layer order, and similar actions. */
export function IconButtonGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid auto-cols-fr grid-flow-col gap-1', className)}>{children}</div>;
}
