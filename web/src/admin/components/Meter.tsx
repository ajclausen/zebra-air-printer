import { cn } from '@/lib/utils';
import type { Tone } from '../lib/format';

const fillClass: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  cobalt: 'bg-cobalt',
};

/** A thin inline usage bar. `value` is a 0-1 fraction. */
export function Meter({ value, tone = 'neutral', label, className }: { value: number; tone?: Tone; label: string; className?: string }) {
  const clamped = Math.min(1, Math.max(0, value));
  const percent = Math.round(clamped * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      className={cn('h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-ink/[0.08]', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', fillClass[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Four ascending bars for Wi-Fi signal strength. */
export function SignalBars({ percent, className }: { percent: number; className?: string }) {
  const filled = percent >= 75 ? 4 : percent >= 50 ? 3 : percent >= 25 ? 2 : percent > 0 ? 1 : 0;
  return (
    <span aria-hidden className={cn('inline-flex h-3 items-end gap-[2px]', className)}>
      {[1, 2, 3, 4].map((bar) => (
        <span key={bar} className={cn('w-[3px] rounded-[1px]', bar <= filled ? 'bg-ink-2' : 'bg-ink/[0.12]')} style={{ height: `${bar * 25}%` }} />
      ))}
    </span>
  );
}
