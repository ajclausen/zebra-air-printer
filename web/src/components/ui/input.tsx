import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-line-strong bg-paper px-2.5 text-sm text-ink shadow-[inset_0_1px_1px_rgb(24_26_31/0.04)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-4 hover:border-ink-4 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-bad aria-invalid:ring-bad/20';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-16 py-1.5 leading-snug', className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-ink-2 select-none', className)} {...props} />;
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-paper px-1 font-sans text-[10.5px] font-medium text-ink-3 shadow-[0_1px_0_var(--color-line-strong)]',
        className,
      )}
      {...props}
    />
  );
}

/** A short field + label pair with an optional hint below. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
