import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** A yes/no confirmation. The dialog stays open while `pending` so the result is visible where the action started. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  tone = 'primary',
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children && <DialogBody className="pb-4">{children}</DialogBody>}
        <DialogFooter className={children ? undefined : 'mt-2'}>
          <DialogClose asChild>
            <Button disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button variant={tone} onClick={onConfirm} disabled={pending}>
            {pending && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
