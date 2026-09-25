import { AlertCircleIcon, type LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-ink/[0.06]', className)} />;
}

/** A few placeholder rows while a list loads. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('divide-y divide-line/70', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-ink/[0.05] text-ink-3">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-3">{children}</div>}
    </div>
  );
}

/** Inline error for a failed load, with a retry. */
export function ErrorState({ title, error, onRetry, className }: { title: string; error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-bad-soft text-bad">
        <AlertCircleIcon className="size-5" aria-hidden />
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
