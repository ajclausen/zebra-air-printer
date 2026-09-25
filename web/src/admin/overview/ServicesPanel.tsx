import { useQueryClient } from '@tanstack/react-query';
import type { ServiceName, ServiceStatus } from '@eco/shared';
import { RotateCwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner, StatusDot } from '@/components/ui/controls';
import { errorMessage } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Panel, PanelHeader } from '../components/layout';
import { formatDateTime, serviceDescriptions, serviceStateLabel, serviceTone } from '../lib/format';
import { waitForServerRestart } from '../lib/serverWatch';
import { adminKeys, useRestartService } from '../queries';

/** eco-studio serves this page, so restarting it briefly disconnects the console. */
const SELF: ServiceName = 'eco-studio';

function ServiceRow({ service, pending, onRestart }: { service: ServiceStatus; pending: boolean; onRestart: () => void }) {
  const tone = serviceTone(service);
  const facts = [
    service.since ? `since ${formatRelativeTime(service.since)}` : null,
    service.restarts !== null ? (service.restarts === 1 ? '1 restart' : `${service.restarts} restarts`) : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <p className="font-mono text-[13px] text-ink">{service.name}</p>
        <p className="text-xs text-ink-3">{serviceDescriptions[service.name]}</p>
      </div>
      <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
        <p className="flex items-center gap-1.5 text-sm text-ink">
          <StatusDot tone={tone} />
          {serviceStateLabel(service)}
        </p>
        {facts.length > 0 && (
          <p className="truncate pl-3.5 text-xs text-ink-3" title={service.since ? formatDateTime(service.since) : undefined}>
            {facts.join(' · ')}
          </p>
        )}
      </div>
      <Button size="sm" onClick={onRestart} disabled={pending} aria-label={`Restart ${service.name}`}>
        {pending ? <Spinner /> : <RotateCwIcon />}
        Restart
      </Button>
    </li>
  );
}

export function ServicesPanel({ services }: { services: ServiceStatus[] }) {
  const client = useQueryClient();
  const restart = useRestartService();
  const [confirmSelf, setConfirmSelf] = useState(false);
  const [selfRestarting, setSelfRestarting] = useState(false);
  const watchRef = useRef<AbortController | null>(null);

  useEffect(() => () => watchRef.current?.abort(), []);

  function refreshSoon() {
    setTimeout(() => void client.invalidateQueries({ queryKey: adminKeys.system }), 1500);
  }

  function restartOther(name: ServiceName) {
    restart.mutate(name, {
      onSuccess: () => {
        toast.success(`Restarted ${name}`);
        refreshSoon();
      },
      onError: (error) => toast.error(`Could not restart ${name}`, { description: errorMessage(error) }),
    });
  }

  function restartSelf() {
    restart.mutate(SELF, {
      onSuccess: async () => {
        setConfirmSelf(false);
        setSelfRestarting(true);
        const toastId = toast.loading(`Restarting ${SELF}`, { description: 'The page will reconnect in a few seconds.' });
        const controller = new AbortController();
        watchRef.current = controller;
        try {
          await waitForServerRestart({ signal: controller.signal, startedAt: Date.now(), confirm: { kind: 'quiet-period', ms: 8_000 } });
          toast.success(`Restarted ${SELF}`, { id: toastId, description: 'Reconnected.' });
          void client.invalidateQueries();
        } catch {
          toast.dismiss(toastId);
        } finally {
          setSelfRestarting(false);
        }
      },
      onError: (error) => toast.error(`Could not restart ${SELF}`, { description: errorMessage(error) }),
    });
  }

  return (
    <Panel aria-labelledby="services-heading">
      <PanelHeader id="services-heading" title="Services" />
      <ul className="divide-y divide-line/70 border-t border-line/70">
        {services.map((service) => (
          <ServiceRow
            key={service.name}
            service={service}
            pending={(restart.isPending && restart.variables === service.name) || (service.name === SELF && selfRestarting)}
            onRestart={() => (service.name === SELF ? setConfirmSelf(true) : restartOther(service.name))}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={confirmSelf}
        onOpenChange={setConfirmSelf}
        title={`Restart ${SELF}?`}
        description="This restarts Label Studio itself. The page will reconnect in a few seconds, and anyone printing right now may need to try again."
        confirmLabel={`Restart ${SELF}`}
        pending={restart.isPending && restart.variables === SELF}
        onConfirm={restartSelf}
      />
    </Panel>
  );
}
