import type { StudioSettings } from '@eco/shared';
import { useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { Input, Label } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/client';
import { useSettings } from '@/lib/api/queries';
import { Panel } from '../components/layout';
import { ErrorState, SkeletonRows } from '../components/states';
import { useUpdateSettings } from '../queries';
import { FormPanel } from './FormPanel';

/** Same limits the server enforces. */
const LIMITS = {
  name: { max: 80 },
  retention: { min: 1, max: 3650 },
  copies: { min: 1, max: 100 },
} as const;

interface Draft {
  studioName: string;
  historyRetentionDays: string;
  defaultCopies: string;
}

type Errors = Partial<Record<keyof Draft, string>>;

function parseWholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function validate(draft: Draft): { errors: Errors; value: StudioSettings | null } {
  const errors: Errors = {};
  const studioName = draft.studioName.trim();
  if (studioName.length === 0) errors.studioName = 'Enter a name.';
  else if (studioName.length > LIMITS.name.max) errors.studioName = `Use ${LIMITS.name.max} characters or fewer.`;

  const historyRetentionDays = parseWholeNumber(draft.historyRetentionDays, LIMITS.retention.min, LIMITS.retention.max);
  if (historyRetentionDays === null) errors.historyRetentionDays = `Enter a whole number from ${LIMITS.retention.min} to ${LIMITS.retention.max}.`;

  const defaultCopies = parseWholeNumber(draft.defaultCopies, LIMITS.copies.min, LIMITS.copies.max);
  if (defaultCopies === null) errors.defaultCopies = `Enter a whole number from ${LIMITS.copies.min} to ${LIMITS.copies.max}.`;

  const value = historyRetentionDays !== null && defaultCopies !== null && Object.keys(errors).length === 0 ? { studioName, historyRetentionDays, defaultCopies } : null;
  return { errors, value };
}

function toDraft(settings: StudioSettings): Draft {
  return {
    studioName: settings.studioName,
    historyRetentionDays: String(settings.historyRetentionDays),
    defaultCopies: String(settings.defaultCopies),
  };
}

function SettingField({
  id,
  label,
  hint,
  error,
  suffix,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string;
  suffix?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby': string }) => React.ReactNode;
}) {
  const messageId = `${id}-message`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': messageId })}
        {suffix && <span className="text-sm text-ink-3">{suffix}</span>}
      </div>
      <p id={messageId} className={error ? 'text-xs text-bad' : 'text-xs text-ink-3'}>
        {error ?? hint}
      </p>
    </div>
  );
}

function SettingsForm({ saved }: { saved: StudioSettings }) {
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const { errors, value } = validate(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));

  const visibleError = (field: keyof Draft) => (submitted || touched[field] ? errors[field] : undefined);
  const bind = (field: keyof Draft) => ({
    value: draft[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft((current) => ({ ...current, [field]: event.target.value })),
    onBlur: () => setTouched((current) => ({ ...current, [field]: true })),
  });

  function save() {
    setSubmitted(true);
    if (!value) return;
    update.mutate(value, {
      onSuccess: () => toast.success('Saved studio settings'),
      onError: (error) => toast.error('Could not save studio settings', { description: errorMessage(error) }),
    });
  }

  return (
    <FormPanel
      id="studio"
      title="Studio"
      description="Shown to everyone who uses the designer."
      onSubmit={save}
      footer={
        <>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(toDraft(saved))} disabled={update.isPending}>
              Discard changes
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
            {update.isPending && <Spinner />}
            Save
          </Button>
        </>
      }
    >
      <SettingField id="studio-name" label="Studio name" hint="Appears in the designer’s top bar." error={visibleError('studioName')}>
        {(props) => <Input {...props} {...bind('studioName')} maxLength={LIMITS.name.max + 10} className="max-w-sm" autoComplete="off" />}
      </SettingField>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingField
          id="history-retention"
          label="Keep print history for"
          suffix="days"
          hint="Older prints and their images are removed."
          error={visibleError('historyRetentionDays')}
        >
          {(props) => <Input {...props} {...bind('historyRetentionDays')} inputMode="numeric" className="tabular w-24" />}
        </SettingField>
        <SettingField id="default-copies" label="Default copies" hint="Starting value in the Print dialog." error={visibleError('defaultCopies')}>
          {(props) => <Input {...props} {...bind('defaultCopies')} inputMode="numeric" className="tabular w-24" />}
        </SettingField>
      </div>
    </FormPanel>
  );
}

export function StudioSettingsForm() {
  const settings = useSettings();
  if (settings.isPending) {
    return (
      <Panel>
        <SkeletonRows rows={3} />
      </Panel>
    );
  }
  if (settings.isError) {
    return (
      <Panel>
        <ErrorState title="Could not load studio settings" error={settings.error} onRetry={() => void settings.refetch()} />
      </Panel>
    );
  }
  // Re-key on the saved values so the form resets to what the server stored after each save.
  return <SettingsForm key={JSON.stringify(settings.data)} saved={settings.data} />;
}
