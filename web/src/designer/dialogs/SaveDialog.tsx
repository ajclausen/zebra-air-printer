import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/client';
import { useDesigns } from '@/lib/api/queries';
import { TEMPLATE_CATEGORIES } from '@/templates';
import { saveWorkingDesign } from '../actions';
import { useDialogs, type SaveMode } from '../dialogs';
import { UNTITLED, useEditor } from '../store';

const COPY: Record<SaveMode, { title: string; description: string; action: string }> = {
  save: { title: 'Save to the library', description: 'Everyone in the office can open saved labels.', action: 'Save' },
  'save-as': { title: 'Save as a new design', description: 'Keeps the original and saves a separate copy.', action: 'Save copy' },
  template: { title: 'Save as template', description: 'Templates appear under Templates for everyone. Opening one always starts a fresh copy.', action: 'Save template' },
};

function SaveForm({ mode, onDone }: { mode: SaveMode; onDone: () => void }) {
  const meta = useEditor((s) => s.meta);
  const templates = useDesigns({ kind: 'template' });
  const [name, setName] = useState(mode === 'save-as' ? `${meta.name} copy` : meta.name === UNTITLED ? '' : meta.name);
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const copy = COPY[mode];

  const categories = useMemo(() => {
    const set = new Set<string>(TEMPLATE_CATEGORIES);
    for (const t of templates.data ?? []) if (t.category) set.add(t.category);
    return [...set];
  }, [templates.data]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const design = await saveWorkingDesign({
        mode: 'new',
        name: trimmed,
        kind: mode === 'template' ? 'template' : 'design',
        category: mode === 'template' ? category.trim() || 'Office' : null,
      });
      toast.success(mode === 'template' ? `Saved template “${design.name}”` : `Saved “${design.name}”`);
      onDone();
    } catch (error) {
      toast.error('Could not save', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 pb-5">
        <Field label="Name" htmlFor="save-name">
          <Input id="save-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Supply room bins" maxLength={120} data-testid="save-name" />
        </Field>
        {mode === 'template' && (
          <Field label="Category" htmlFor="save-category" hint="Pick one or type a new category.">
            <Input id="save-category" list="template-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Office" maxLength={40} />
            <datalist id="template-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving || !name.trim()} data-testid="save-confirm">
          {saving && <Spinner className="size-4" />}
          {copy.action}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SaveDialog() {
  const mode = useDialogs((s) => s.save);
  const close = useDialogs((s) => s.close);
  const [lastMode, setLastMode] = useState<SaveMode>('save');
  useEffect(() => {
    if (mode) setLastMode(mode);
  }, [mode]);
  return (
    <Dialog open={Boolean(mode)} onOpenChange={(open) => !open && close('save')}>
      <DialogContent className="max-w-md">{mode && <SaveForm key={mode} mode={mode ?? lastMode} onDone={() => close('save')} />}</DialogContent>
    </Dialog>
  );
}
