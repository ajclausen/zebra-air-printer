import { PowerIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/controls';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Panel } from '../components/layout';
import { useRebootMonitor } from '../reboot/RebootContext';

export function RebootPanel() {
  const { phase, requestPending, reboot } = useRebootMonitor();
  const [confirming, setConfirming] = useState(false);
  const rebooting = phase.kind === 'rebooting';

  async function confirm() {
    const accepted = await reboot();
    if (!accepted) return;
    setConfirming(false);
    // The progress banner sits at the top of the page.
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <Panel aria-labelledby="reboot-heading" className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 id="reboot-heading" className="text-base font-semibold tracking-[-0.01em] text-ink">
          Reboot the Pi
        </h2>
        <p className="mt-0.5 text-sm text-ink-3">Try this if restarting services on the Overview page has not helped. Takes about a minute.</p>
      </div>
      <Button onClick={() => setConfirming(true)} disabled={rebooting} className="self-start text-bad hover:text-bad sm:self-center">
        {rebooting ? <Spinner /> : <PowerIcon />}
        {rebooting ? 'Rebooting…' : 'Reboot the Pi'}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Reboot the Pi?"
        description="The printer and this site will be unavailable for about a minute. Anything printing right now may stop, and AirPrint will be offline until the Pi is back."
        confirmLabel="Reboot the Pi"
        tone="danger"
        pending={requestPending}
        onConfirm={() => void confirm()}
      />
    </Panel>
  );
}
