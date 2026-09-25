import type { HealthCheck, PrinterState, QueueJob, ServiceName, ServiceStatus } from '@eco/shared';
import { formatRelativeTime } from '@/lib/utils';

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'cobalt';

/** Full local date and time, used for hover titles next to relative times. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Relative time that also handles the future ("in 3 min"). */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (seconds <= 0) return formatRelativeTime(iso, now);
  if (seconds < 45) return 'in a few seconds';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** "media-empty-error" -> "Media empty". IPP severity suffixes are dropped; the badge tone carries severity. */
export function humanizeReason(reason: string): string {
  const base = reason.replace(/-(error|warning|report)$/, '').replace(/-/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function reasonTone(reason: string): Tone {
  if (reason.endsWith('-report')) return 'neutral';
  if (reason.endsWith('-warning')) return 'warn';
  return 'bad';
}

export const printerStateMeta: Record<PrinterState, { label: string; tone: Tone; fallback: string }> = {
  idle: { label: 'Ready', tone: 'ok', fallback: 'The printer is ready.' },
  processing: { label: 'Printing', tone: 'cobalt', fallback: 'The printer is working through the queue.' },
  stopped: { label: 'Needs attention', tone: 'bad', fallback: 'The printer has stopped.' },
  unreachable: { label: 'Not reachable', tone: 'bad', fallback: 'Label Studio cannot reach the printer server.' },
};

export const jobStateMeta: Record<QueueJob['state'], { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'neutral' },
  held: { label: 'Held', tone: 'warn' },
  processing: { label: 'Printing', tone: 'cobalt' },
  stopped: { label: 'Stopped', tone: 'bad' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  aborted: { label: 'Failed', tone: 'bad' },
  completed: { label: 'Done', tone: 'ok' },
};

export const serviceDescriptions: Record<ServiceName, string> = {
  lprint: 'Printer server for AirPrint and Label Studio',
  'avahi-daemon': 'Lets Macs, iPhones, and iPads find the printer',
  'eco-studio': 'This website',
};

export function serviceTone(service: ServiceStatus): Tone {
  if (service.active === 'active') return 'ok';
  if (service.active === 'failed') return 'bad';
  if (service.active === 'activating' || service.active === 'reloading' || service.active === 'deactivating') return 'warn';
  return 'neutral';
}

export function serviceStateLabel(service: ServiceStatus): string {
  const active = service.active.charAt(0).toUpperCase() + service.active.slice(1);
  return service.sub && service.sub !== service.active ? `${active}, ${service.sub}` : active;
}

export const healthCheckMeta: Record<HealthCheck['name'], { label: string; description: string }> = {
  network: { label: 'Network', description: 'Wi-Fi connection to the office network' },
  lprint: { label: 'Printer server', description: 'LPrint answers on port 8000' },
  advertise: { label: 'AirPrint discovery', description: 'The printer is advertised on the network' },
  studio: { label: 'Label Studio', description: 'This site answers its health check' },
};

/** Tone for a used-fraction meter: calm until it gets tight. */
export function usageTone(fraction: number): Tone {
  if (fraction >= 0.9) return 'bad';
  if (fraction >= 0.75) return 'warn';
  return 'neutral';
}

export function temperatureTone(celsius: number): Tone {
  if (celsius >= 80) return 'bad';
  if (celsius >= 70) return 'warn';
  return 'neutral';
}
