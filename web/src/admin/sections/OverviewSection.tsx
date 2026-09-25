import { Panel } from '../components/layout';
import { ErrorState, SkeletonRows } from '../components/states';
import { HealthChecksPanel } from '../overview/HealthChecksPanel';
import { PrinterStatusPanel } from '../overview/PrinterStatusPanel';
import { ServicesPanel } from '../overview/ServicesPanel';
import { SystemPanel } from '../overview/SystemPanel';
import { SectionHeader } from '../components/layout';
import { useSystemInfo } from '../queries';

function SystemDetails() {
  const system = useSystemInfo();

  if (system.isPending) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <SkeletonRows rows={6} />
        </Panel>
        <Panel>
          <SkeletonRows rows={8} />
        </Panel>
      </div>
    );
  }
  if (system.isError) {
    return (
      <Panel>
        <ErrorState title="Could not load system details" error={system.error} onRetry={() => void system.refetch()} />
      </Panel>
    );
  }
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <ServicesPanel services={system.data.services} />
        <HealthChecksPanel checks={system.data.health} />
      </div>
      <SystemPanel system={system.data} />
    </div>
  );
}

export function OverviewSection() {
  return (
    <>
      <SectionHeader title="Overview" description="Printer, services, and system health. This page updates every few seconds." />
      <div className="flex flex-col gap-6">
        <PrinterStatusPanel />
        <SystemDetails />
      </div>
    </>
  );
}
