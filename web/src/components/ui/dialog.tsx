import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  hideClose = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-paper shadow-dialog outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute top-3.5 right-3.5 inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:outline-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-5 pb-3 pr-12', className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-2', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-line px-5 py-3.5', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold tracking-[-0.01em] text-ink', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-ink-3', className)} {...props} />;
}
