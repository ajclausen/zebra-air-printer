import { FolderOpenIcon, HistoryIcon, LayoutTemplateIcon, ShapesIcon } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';
import { ElementsPanel } from './ElementsPanel';
import { HistoryPanel } from './HistoryPanel';
import { LibraryPanel } from './LibraryPanel';
import { TemplatesPanel } from './TemplatesPanel';

export type PanelId = 'templates' | 'elements' | 'library' | 'history';

export const usePanel = create<{ panel: PanelId | null; setPanel: (p: PanelId | null) => void }>()((set) => ({
  panel: 'templates',
  setPanel: (panel) => set({ panel }),
}));

const TABS: Array<{ id: PanelId; label: string; icon: typeof ShapesIcon }> = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplateIcon },
  { id: 'elements', label: 'Elements', icon: ShapesIcon },
  { id: 'library', label: 'Library', icon: FolderOpenIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
];

/** Icon rail plus the active panel. Clicking the active tab collapses the panel. */
export function LeftPanel() {
  const { panel, setPanel } = usePanel();
  return (
    <div className="flex h-full shrink-0 border-r border-line bg-paper">
      <nav aria-label="Panels" className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line py-2">
        {TABS.map((tab) => {
          const active = panel === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              aria-controls="left-panel"
              onClick={() => setPanel(active ? null : tab.id)}
              className={cn(
                'flex w-[58px] flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-ink-3 transition-colors outline-none hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt',
                active && 'bg-cobalt-soft text-cobalt-strong hover:bg-cobalt-soft hover:text-cobalt-strong',
              )}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon className="size-5" strokeWidth={active ? 2.1 : 1.8} />
              {tab.label}
            </button>
          );
        })}
      </nav>
      {panel && (
        <div id="left-panel" className="flex w-[288px] flex-col">
          {panel === 'templates' && <TemplatesPanel />}
          {panel === 'elements' && <ElementsPanel />}
          {panel === 'library' && <LibraryPanel />}
          {panel === 'history' && <HistoryPanel />}
        </div>
      )}
    </div>
  );
}
