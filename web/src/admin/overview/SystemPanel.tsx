import type { SystemInfo } from '@eco/shared';
import { cn, formatBytes, formatDuration } from '@/lib/utils';
import { DefinitionList, DefinitionRow, GroupHeading, Panel, PanelHeader } from '../components/layout';
import { Meter, SignalBars } from '../components/Meter';
import { formatDate, formatRelative, temperatureTone, usageTone } from '../lib/format';

const toneText = { neutral: 'text-ink', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', cobalt: 'text-cobalt' } as const;

/** Value with a thin meter to its right; the meter shows the used fraction. */
function UsageValue({ used, total, text, label }: { used: number; total: number; text: string; label: string }) {
  const fraction = total > 0 ? used / total : 0;
  return (
    <span className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="tabular whitespace-nowrap">{text}</span>
      <Meter value={fraction} tone={usageTone(fraction)} label={label} className="w-24" />
    </span>
  );
}

function certificateText(notAfter: string | null): { text: string; tone: keyof typeof toneText } {
  if (!notAfter) return { text: 'Unknown', tone: 'neutral' };
  const daysLeft = (new Date(notAfter).getTime() - Date.now()) / 86_400_000;
  if (daysLeft < 0) return { text: `Expired ${formatDate(notAfter)}`, tone: 'bad' };
  return { text: `${formatDate(notAfter)} (${formatRelative(notAfter)})`, tone: daysLeft < 30 ? 'warn' : 'neutral' };
}

export function SystemPanel({ system }: { system: SystemInfo }) {
  const memoryUsed = system.memory.totalBytes - system.memory.availableBytes;
  const diskUsed = system.disk.totalBytes - system.disk.freeBytes;
  const [load1, load5, load15] = system.loadAverage;
  const certificate = certificateText(system.certificate.notAfter);

  return (
    <Panel aria-labelledby="system-heading">
      <PanelHeader id="system-heading" title="System" description={`Raspberry Pi “${system.hostname}”`} className="pb-0" />

      <GroupHeading>Hardware</GroupHeading>
      <DefinitionList>
        <DefinitionRow label="CPU temperature">
          {system.cpuTempC === null ? (
            <span className="text-ink-3">Not available</span>
          ) : (
            <span className={cn('tabular', toneText[temperatureTone(system.cpuTempC)])}>{system.cpuTempC.toFixed(0)} °C</span>
          )}
        </DefinitionRow>
        <DefinitionRow label="Memory">
          <UsageValue
            used={memoryUsed}
            total={system.memory.totalBytes}
            text={`${formatBytes(memoryUsed)} of ${formatBytes(system.memory.totalBytes)}`}
            label="Memory used"
          />
        </DefinitionRow>
        <DefinitionRow label="Disk">
          <UsageValue used={diskUsed} total={system.disk.totalBytes} text={`${formatBytes(system.disk.freeBytes)} free of ${formatBytes(system.disk.totalBytes)}`} label="Disk used" />
        </DefinitionRow>
        <DefinitionRow label="Load average">
          <span className="tabular" title="Average number of busy processes over the last 1, 5, and 15 minutes">
            {load1.toFixed(2)} <span className="text-ink-4">·</span> {load5.toFixed(2)} <span className="text-ink-4">·</span> {load15.toFixed(2)}
          </span>
        </DefinitionRow>
        <DefinitionRow label="Uptime">
          <span className="tabular">{formatDuration(system.uptimeSeconds)}</span>
        </DefinitionRow>
      </DefinitionList>

      <GroupHeading>Network</GroupHeading>
      <DefinitionList>
        <DefinitionRow label="Wi-Fi">
          {system.wifi?.ssid ? (
            <span className="flex items-center justify-between gap-3">
              <span className="truncate">{system.wifi.ssid}</span>
              {system.wifi.signalPercent !== null && (
                <span className="flex shrink-0 items-center gap-2 text-ink-2">
                  <span className="tabular">{system.wifi.signalPercent}%</span>
                  <SignalBars percent={system.wifi.signalPercent} />
                </span>
              )}
            </span>
          ) : (
            <span className="text-ink-3">Not connected</span>
          )}
        </DefinitionRow>
        <DefinitionRow label="Addresses">
          {system.addresses.length === 0 ? (
            <span className="text-ink-3">None</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {system.addresses.map((address) => (
                <li key={address} className="font-mono text-xs leading-[18px] break-all text-ink-2">
                  {address}
                </li>
              ))}
            </ul>
          )}
        </DefinitionRow>
      </DefinitionList>

      <GroupHeading>Software</GroupHeading>
      <DefinitionList className="rounded-b-lg">
        <DefinitionRow label="Label Studio">
          <span className="tabular">{system.versions.studio}</span>
        </DefinitionRow>
        <DefinitionRow label="Node.js">
          <span className="tabular">{system.versions.node}</span>
        </DefinitionRow>
        <DefinitionRow label="LPrint">
          <span className="tabular">{system.versions.lprint ?? <span className="text-ink-3">Unknown</span>}</span>
        </DefinitionRow>
        <DefinitionRow label="Certificate expires">
          <span className={toneText[certificate.tone]}>{certificate.text}</span>
        </DefinitionRow>
      </DefinitionList>
    </Panel>
  );
}
