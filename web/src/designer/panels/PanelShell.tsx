import type * as React from 'react';
import { cn } from '@/lib/utils';

export function PanelHeader({ title, action, children }: { title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-3">
      <div className="flex h-6 items-center justify-between">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function PanelScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-3 pb-6', className)}>{children}</div>;
}
