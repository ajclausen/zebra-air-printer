import { useSyncExternalStore } from 'react';
import { GaugeIcon, HistoryIcon, LibraryIcon, PrinterIcon, ScrollTextIcon, SettingsIcon, type LucideIcon } from 'lucide-react';

export type SectionId = 'overview' | 'printer' | 'library' | 'history' | 'logs' | 'settings';

export interface SectionMeta {
  id: SectionId;
  label: string;
  icon: LucideIcon;
}

export const SECTIONS: readonly SectionMeta[] = [
  { id: 'overview', label: 'Overview', icon: GaugeIcon },
  { id: 'printer', label: 'Printer', icon: PrinterIcon },
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'logs', label: 'Logs', icon: ScrollTextIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const DEFAULT_SECTION: SectionId = 'overview';

function isSectionId(value: string): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

function readSection(): SectionId {
  const hash = window.location.hash.replace(/^#/, '');
  return isSectionId(hash) ? hash : DEFAULT_SECTION;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** The active admin section, kept in the URL hash so a reload stays put. */
export function useActiveSection(): SectionId {
  return useSyncExternalStore(subscribe, readSection);
}

export function sectionMeta(id: SectionId): SectionMeta {
  return SECTIONS.find((section) => section.id === id) ?? (SECTIONS[0] as SectionMeta);
}
