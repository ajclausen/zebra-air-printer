import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';
import { Input, Label } from '@/components/ui/input';

/** Labelled password input with a show/hide toggle and an inline error wired to aria-describedby. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  autoFocus,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className="h-9 pr-9"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 outline-none hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt"
        >
          {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
      {message && (
        <p id={messageId} className={error ? 'text-xs text-bad' : 'text-xs text-ink-3'}>
          {message}
        </p>
      )}
    </div>
  );
}
