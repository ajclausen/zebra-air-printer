import type { FormEvent } from 'react';
import type * as React from 'react';
import { Panel, PanelHeader } from '../components/layout';

/** A settings panel: heading, fields, and a footer with the submit action on the right. */
export function FormPanel({
  id,
  title,
  description,
  footer,
  onSubmit,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  footer: React.ReactNode;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Panel aria-labelledby={`${id}-heading`}>
      <form onSubmit={handleSubmit} noValidate>
        <PanelHeader id={`${id}-heading`} title={title} description={description} />
        <div className="flex flex-col gap-4 px-4 pt-1 pb-5">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line/70 px-4 py-3">{footer}</div>
      </form>
    </Panel>
  );
}
