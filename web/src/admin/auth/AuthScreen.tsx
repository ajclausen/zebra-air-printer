import { ArrowLeftIcon, LockKeyholeIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { errorMessage } from '@/lib/api/client';
import { useStudioSettings } from '@/lib/api/queries';
import { navigate } from '@/lib/router';
import { PasswordField } from '../components/PasswordField';
import { isRateLimited, isWrongPassword, useLogin, useSetupAdmin } from '../queries';
import { MIN_PASSWORD_LENGTH } from './password';

/** Centered card shared by the setup and login screens. */
function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const { studioName } = useStudioSettings();
  return (
    <main className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <p className="mb-5 text-center text-sm font-medium text-ink-3">{studioName}</p>
        <div className="rounded-xl border border-line bg-paper px-6 pt-6 pb-5 shadow-[0_1px_2px_rgb(24_26_31/0.04),0_12px_32px_-16px_rgb(24_26_31/0.18)]">
          <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-2">
            <LockKeyholeIcon className="size-[18px]" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{title}</h1>
          <p className="mt-1 mb-5 text-sm text-ink-3">{description}</p>
          {children}
        </div>
        <div className="mt-5 text-center">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeftIcon />
            Back to designer
          </Button>
        </div>
      </div>
    </main>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
      {message}
    </p>
  );
}

export function SetupScreen() {
  const setup = useSetupAdmin();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const passwordError = password.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null;
  const confirmError = confirm !== password ? 'The passwords do not match.' : null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (passwordError || confirmError) return;
    setup.mutate(password);
  }

  return (
    <AuthCard
      title="Set an admin password"
      description="This password protects the printer controls, the shared library, and system settings. Share it only with people who manage the printer."
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <PasswordField
          id="setup-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={submitted ? passwordError : null}
        />
        <PasswordField
          id="setup-confirm"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={submitted && !passwordError ? confirmError : null}
        />
        <FormError message={setup.isError ? errorMessage(setup.error) : null} />
        <Button type="submit" variant="primary" size="lg" disabled={setup.isPending} className="mt-1 w-full">
          {setup.isPending && <Spinner />}
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}

export function LoginScreen() {
  const login = useLogin();
  const [password, setPassword] = useState('');
  const [emptyError, setEmptyError] = useState(false);

  const wrongPassword = login.isError && isWrongPassword(login.error);
  const rateLimited = login.isError && isRateLimited(login.error);
  const otherError = rateLimited ? 'Too many attempts. Try again in a minute.' : login.isError && !wrongPassword ? errorMessage(login.error) : null;
  const fieldError = emptyError ? 'Enter the admin password.' : wrongPassword ? 'That password is not right.' : null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setEmptyError(true);
      return;
    }
    login.mutate(password);
  }

  return (
    <AuthCard title="Admin login" description="Enter the admin password to manage the printer, library, and system settings.">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <PasswordField
          id="login-password"
          label="Password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setEmptyError(false);
            if (login.isError) login.reset();
          }}
          autoComplete="current-password"
          autoFocus
          error={fieldError}
        />
        <FormError message={otherError} />
        <Button type="submit" variant="primary" size="lg" disabled={login.isPending} className="mt-1 w-full">
          {login.isPending && <Spinner />}
          Log in
        </Button>
      </form>
    </AuthCard>
  );
}
