import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/input';
import { modKey } from '@/lib/utils';
import { useDialogs } from '../dialogs';

const GROUPS: Array<{ title: string; items: Array<[string, string[]]> }> = [
  {
    title: 'Edit',
    items: [
      ['Undo', [modKey, 'Z']],
      ['Redo', [modKey, '⇧', 'Z']],
      ['Copy / paste', [modKey, 'C / V']],
      ['Duplicate', [modKey, 'D']],
      ['Delete', ['⌫']],
      ['Select all', [modKey, 'A']],
      ['Deselect', ['Esc']],
    ],
  },
  {
    title: 'Arrange',
    items: [
      ['Nudge 1 dot', ['←↑→↓']],
      ['Nudge 10 dots', ['⇧', '←↑→↓']],
      ['Group / ungroup', [modKey, 'G / ⇧G']],
      ['Lock', [modKey, 'L']],
      ['Bring forward / back', [modKey, '] / [']],
    ],
  },
  {
    title: 'Label',
    items: [
      ['Edit text', ['Enter']],
      ['Save', [modKey, 'S']],
      ['Print', [modKey, 'P']],
      ['Preview', [modKey, '⇧', 'P']],
      ['Zoom to fit / actual size', [modKey, '0 / 1']],
      ['Zoom in / out', [modKey, '+ / −']],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useDialogs((s) => s.shortcuts);
  const close = useDialogs((s) => s.close);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close('shortcuts')}>
      <DialogContent className="max-w-[620px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-6 pb-6 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-xs font-semibold text-ink-2">{group.title}</h3>
              <dl className="flex flex-col gap-2">
                {group.items.map(([label, keys]) => (
                  <div key={label} className="flex flex-col gap-1">
                    <dt className="text-xs text-ink-3">{label}</dt>
                    <dd className="flex gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
