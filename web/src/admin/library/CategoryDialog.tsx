import type { DesignSummary } from '@eco/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

/** The server accepts categories up to 100 characters. */
const MAX_CATEGORY_LENGTH = 100;

/** Edits a design's category. Suggests existing categories; empty means no category. */
export function CategoryDialog({
  design,
  open,
  session,
  categories,
  pending,
  onOpenChange,
  onSave,
}: {
  design: DesignSummary | null;
  open: boolean;
  /** Changes each time the dialog opens so the form starts from the saved value. */
  session: number;
  categories: string[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (design: DesignSummary, category: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="max-w-sm">
        {design && <CategoryForm key={session} design={design} categories={categories} pending={pending} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  design,
  categories,
  pending,
  onSave,
}: {
  design: DesignSummary;
  categories: string[];
  pending: boolean;
  onSave: (design: DesignSummary, category: string | null) => void;
}) {
  const [value, setValue] = useState(design.category ?? '');
  const trimmed = value.trim();
  const unchanged = (trimmed || null) === design.category;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (unchanged) return;
    onSave(design, trimmed || null);
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Change category</DialogTitle>
        <DialogDescription>Pick or type a category for “{design.name}”. The designer groups templates by category.</DialogDescription>
      </DialogHeader>
      <DialogBody className="pb-5">
        <Field label="Category" htmlFor="design-category" hint="Leave empty for no category.">
          <Input
            id="design-category"
            list="design-category-options"
            value={value}
            maxLength={MAX_CATEGORY_LENGTH}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            autoComplete="off"
          />
          <datalist id="design-category-options">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={pending}>Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={pending || unchanged}>
          {pending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
