import type { HealthCheck } from '@eco/shared';
import { StatusDot } from '@/components/ui/controls';
import { Panel, PanelHeader } from '../components/layout';
import { formatDateTime, formatRelative, healthCheckMeta } from '../lib/format';

function CheckRow({ check }: { check: HealthCheck }) {
  const meta = healthCheckMeta[check.name];
  const failing = check.consecutiveFailures > 0;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm text-ink">{meta.label}</p>
        <p className="text-xs text-ink-3">{meta.description}</p>
      </div>
      <div className="min-w-0 basis-36 text-right max-sm:text-left">
        <p className="flex items-center gap-1.5 text-sm text-ink sm:justify-end">
          <StatusDot tone={failing ? (check.consecutiveFailures >= 3 ? 'bad' : 'warn') : 'ok'} />
          {failing ? `${check.consecutiveFailures} failed in a row` : 'Passing'}
        </p>
        {failing && check.nextActionAt && (
          <p className="text-xs text-ink-3" title={formatDateTime(check.nextActionAt)}>
            Next repair {formatRelative(check.nextActionAt)}
          </p>
        )}
      </div>
    </li>
  );
}

/** Counters written by eco-printer-health, which checks and repairs the Pi every minute. */
export function HealthChecksPanel({ checks }: { checks: HealthCheck[] }) {
  return (
    <Panel aria-labelledby="health-heading">
      <PanelHeader id="health-heading" title="Health checks" description="Checked every minute. Failures are repaired automatically." />
      <ul className="divide-y divide-line/70 border-t border-line/70">
        {checks.map((check) => (
          <CheckRow key={check.name} check={check} />
        ))}
      </ul>
    </Panel>
  );
}
