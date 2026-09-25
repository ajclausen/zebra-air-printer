import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { errorMessage } from '@/lib/api/client';
import { MIN_PASSWORD_LENGTH } from '../auth/password';
import { PasswordField } from '../components/PasswordField';
import { isRateLimited, isUnauthorized, isWrongPassword, useChangePassword } from '../queries';
import { FormPanel } from './FormPanel';

const EMPTY = { current: '', next: '', confirm: '' };

export function ChangePasswordForm() {
  const change = useChangePassword();
  const [fields, setFields] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);

  const errors = {
    current: fields.current ? null : 'Enter the current password.',
    next: fields.next.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null,
    confirm: fields.confirm !== fields.next ? 'The passwords do not match.' : null,
  };
  const wrongCurrent = change.isError && isWrongPassword(change.error);
  const serverError =
    change.isError && isRateLimited(change.error)
      ? 'Too many attempts. Try again in a minute.'
      : change.isError && !wrongCurrent && !isUnauthorized(change.error)
        ? errorMessage(change.error)
        : null;

  function set(field: keyof typeof EMPTY, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
    if (change.isError) change.reset();
  }

  function submit() {
    setSubmitted(true);
    if (errors.current || errors.next || errors.confirm) return;
    change.mutate(
      { current: fields.current, next: fields.next },
      {
        onSuccess: () => {
          toast.success('Changed the admin password');
          setFields(EMPTY);
          setSubmitted(false);
        },
        // Wrong-password and rate-limit errors show inline; an expired session returns to the login screen.
        onError: (error) => {
          if (!isWrongPassword(error) && !isRateLimited(error) && !isUnauthorized(error)) {
            toast.error('Could not change the password', { description: errorMessage(error) });
          }
        },
      },
    );
  }

  return (
    <FormPanel
      id="password"
      title="Admin password"
      description="Anyone with this password can change printer settings and the library."
      onSubmit={submit}
      footer={
        <>
          {serverError && (
            <p role="alert" className="mr-auto text-sm text-bad">
              {serverError}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={change.isPending}>
            {change.isPending && <Spinner />}
            Change password
          </Button>
        </>
      }
    >
      {/* Lets password managers associate the new password with the admin login. */}
      <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
      <div className="max-w-sm">
        <PasswordField
          id="password-current"
          label="Current password"
          value={fields.current}
          onChange={(value) => set('current', value)}
          autoComplete="current-password"
          error={wrongCurrent ? 'That password is not right.' : submitted ? errors.current : null}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PasswordField
          id="password-next"
          label="New password"
          value={fields.next}
          onChange={(value) => set('next', value)}
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={submitted ? errors.next : null}
        />
        <PasswordField
          id="password-confirm"
          label="Confirm new password"
          value={fields.confirm}
          onChange={(value) => set('confirm', value)}
          autoComplete="new-password"
          error={submitted && !errors.next ? errors.confirm : null}
        />
      </div>
    </FormPanel>
  );
}
