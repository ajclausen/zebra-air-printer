import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Page title for a section, with an optional description and right-aligned actions. */
export function SectionHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A white surface that groups related content. */
export function Panel({ className, ...props }: React.ComponentProps<'section'>) {
  return <section className={cn('rounded-lg border border-line bg-paper', className)} {...props} />;
}

/** Heading row inside a Panel. */
export function PanelHeader({
  title,
  description,
  actions,
  id,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Quiet group heading used above definition lists. */
export function GroupHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="px-4 pt-4 pb-1.5 text-xs font-semibold text-ink-2">
      {children}
    </h3>
  );
}

/** Label/value rows. Labels sit in a fixed column so values align down the page. */
export function DefinitionList({ className, ...props }: React.ComponentProps<'dl'>) {
  return <dl className={cn('divide-y divide-line/70 border-t border-line/70', className)} {...props} />;
}

export function DefinitionRow({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-3 sm:gap-4 px-4 py-2.5 sm:grid-cols-[156px_minmax(0,1fr)]', className)}>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}
