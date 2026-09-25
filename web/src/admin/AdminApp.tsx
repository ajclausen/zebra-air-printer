import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type * as React from 'react';
import { Spinner } from '@/components/ui/controls';
import { LoginScreen, SetupScreen } from './auth/AuthScreen';
import { ErrorState } from './components/states';
import { adminKeys, isUnauthorized, useAdminState } from './queries';
import { RebootProvider } from './reboot/RebootContext';
import { HistorySection } from './sections/HistorySection';
import { LibrarySection } from './sections/LibrarySection';
import { LogsSection } from './sections/LogsSection';
import { OverviewSection } from './sections/OverviewSection';
import { PrinterSection } from './sections/PrinterSection';
import { SettingsSection } from './sections/SettingsSection';
import { useActiveSection, type SectionId } from './sections';
import { AdminShell } from './shell/AdminShell';

const SECTION_COMPONENTS: Record<SectionId, () => React.ReactNode> = {
  overview: OverviewSection,
  printer: PrinterSection,
  library: LibrarySection,
  history: HistorySection,
  logs: LogsSection,
  settings: SettingsSection,
};

/**
 * When any admin call answers 401 the session has expired (or was revoked).
 * Re-checking the admin state drops the console back to the login screen; if
 * the session is in fact still valid (e.g. a wrong "current password"), the
 * re-check confirms that and nothing changes.
 */
function useSessionExpiryWatch() {
  const client = useQueryClient();
  useEffect(() => {
    const recheck = () => void client.invalidateQueries({ queryKey: adminKeys.state, exact: true });
    const unsubscribeQueries = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error' && isUnauthorized(event.action.error)) recheck();
    });
    const unsubscribeMutations = client.getMutationCache().subscribe((event) => {
      if (event?.type === 'updated' && event.action.type === 'error' && isUnauthorized(event.action.error)) recheck();
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [client]);
}

function Console() {
  const active = useActiveSection();
  const Section = SECTION_COMPONENTS[active];
  return (
    <RebootProvider>
      <AdminShell active={active}>
        <Section />
      </AdminShell>
    </RebootProvider>
  );
}

export default function AdminApp() {
  useSessionExpiryWatch();
  const state = useAdminState();

  if (state.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3" role="status" aria-label="Loading">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState title="Could not open the admin console" error={state.error} onRetry={() => void state.refetch()} />
      </div>
    );
  }
  if (!state.data.configured) return <SetupScreen />;
  if (!state.data.loggedIn) return <LoginScreen />;
  return <Console />;
}
