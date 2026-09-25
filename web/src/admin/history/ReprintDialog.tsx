import type { HistoryEntry } from '@eco/shared';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { pluralize } from '@/lib/utils';
import { Thumbnail } from '../components/Thumbnail';
import { formatDateTime } from '../lib/format';

/** Same limits the server enforces on ReprintRequest.copies. */
const MIN_COPIES = 1;
const MAX_COPIES = 100;

function parseCopies(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const value = Number(text);
  return value >= MIN_COPIES && value <= MAX_COPIES ? value : null;
}

/** Confirms a reprint and lets the admin change the number of copies (defaults to the original). */
export function ReprintDialog({
  entry,
  open,
  session,
  pending,
  onOpenChange,
  onReprint,
}: {
  entry: HistoryEntry | null;
  open: boolean;
  /** Changes each time the dialog opens so the form starts from the original copies. */
  session: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onReprint: (entry: HistoryEntry, copies: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-sm">{entry && <ReprintForm key={session} entry={entry} pending={pending} onReprint={onReprint} />}</DialogContent>
    </Dialog>
  );
}

function ReprintForm({ entry, pending, onReprint }: { entry: HistoryEntry; pending: boolean; onReprint: (entry: HistoryEntry, copies: number) => void }) {
  const [text, setText] = useState(String(entry.copies));
  const copies = parseCopies(text);
  const error = copies === null ? `Enter a whole number from ${MIN_COPIES} to ${MAX_COPIES}.` : null;

  function step(delta: number) {
    const base = copies ?? entry.copies;
    setText(String(Math.min(MAX_COPIES, Math.max(MIN_COPIES, base + delta))));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (copies !== null) onReprint(entry, copies);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>Reprint</DialogTitle>
        <DialogDescription>Sends the stored labels to the printer again.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-5">
        <div className="flex items-center gap-3 rounded-lg bg-surface p-3">
          <Thumbnail src={entry.previewUrl} className="h-[60px] w-10" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink" title={entry.name}>
              {entry.name}
            </p>
            <p className="text-xs text-ink-3">
              {pluralize(entry.labelCount, 'label')} · printed {formatDateTime(entry.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reprint-copies">Copies of each label</Label>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="icon" onClick={() => step(-1)} disabled={pending || (copies ?? 0) <= MIN_COPIES} aria-label="One fewer copy">
              <MinusIcon />
            </Button>
            <Input
              id="reprint-copies"
              value={text}
              onChange={(event) => setText(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby="reprint-copies-message"
              className="tabular w-16 text-center"
            />
            <Button variant="secondary" size="icon" onClick={() => step(1)} disabled={pending || (copies ?? MAX_COPIES) >= MAX_COPIES} aria-label="One more copy">
              <PlusIcon />
            </Button>
          </div>
          <p id="reprint-copies-message" className={error ? 'text-xs text-bad' : 'text-xs text-ink-3'}>
            {error ?? `${pluralize(entry.labelCount * (copies ?? 0), 'label')} in total.`}
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={pending}>Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={pending || copies === null}>
          {pending && <Spinner />}
          Reprint
        </Button>
      </DialogFooter>
    </form>
  );
}
