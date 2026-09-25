import type { DesignSummary } from '@eco/shared';
import { SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/client';
import { useDesigns } from '@/lib/api/queries';
import { BUILT_IN_TEMPLATES, TEMPLATE_CATEGORIES, type BuiltInTemplate } from '@/templates';
import { openBuiltInTemplate, openLibraryDesign } from '../actions';
import { confirmDiscard } from '../confirmDiscard';
import { LabelThumb } from './LabelCard';
import { PanelHeader, PanelScroll } from './PanelShell';
import { useTemplateThumbnail } from './thumbnails';

function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

function TemplateTile({ template }: { template: BuiltInTemplate }) {
  const thumb = useTemplateThumbnail(template);
  const orientation = useMemo(() => template.build().orientation, [template]);
  return (
    <button
      type="button"
      onClick={() => confirmDiscard() && openBuiltInTemplate(template)}
      className="group flex flex-col gap-1.5 rounded-lg p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
      title={template.description}
      data-testid={`template-${template.id}`}
    >
      <LabelThumb src={thumb} orientation={orientation} alt="" className="transition-colors group-hover:bg-desk" />
      <span className="truncate px-0.5 text-xs font-medium text-ink-2 group-hover:text-ink">{template.name}</span>
    </button>
  );
}

function LibraryTemplateTile({ design }: { design: DesignSummary }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirmDiscard()) return;
        openLibraryDesign(design.id).catch((error) => toast.error('Could not open the template', { description: errorMessage(error) }));
      }}
      className="group flex flex-col gap-1.5 rounded-lg p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
    >
      <LabelThumb src={design.thumbnail} orientation={design.orientation} alt="" className="transition-colors group-hover:bg-desk" />
      <span className="truncate px-0.5 text-xs font-medium text-ink-2 group-hover:text-ink">{design.name}</span>
    </button>
  );
}

export function TemplatesPanel() {
  const [query, setQuery] = useState('');
  const library = useDesigns({ kind: 'template' });

  const groups = useMemo(() => {
    const byCategory = new Map<string, { builtIn: BuiltInTemplate[]; library: DesignSummary[] }>();
    const bucket = (category: string) => {
      let entry = byCategory.get(category);
      if (!entry) byCategory.set(category, (entry = { builtIn: [], library: [] }));
      return entry;
    };
    for (const category of TEMPLATE_CATEGORIES) bucket(category);
    for (const t of BUILT_IN_TEMPLATES) if (matches(query, t.name, t.category, t.description)) bucket(t.category).builtIn.push(t);
    for (const d of library.data ?? []) if (matches(query, d.name, d.category)) bucket(d.category || 'Office library').library.push(d);
    return [...byCategory.entries()].filter(([, g]) => g.builtIn.length + g.library.length > 0);
  }, [query, library.data]);

  return (
    <>
      <PanelHeader title="Templates">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-4" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="pl-8" />
        </div>
      </PanelHeader>
      <PanelScroll>
        {groups.length === 0 && <p className="px-1 py-6 text-center text-sm text-ink-3">No templates match “{query}”.</p>}
        {groups.map(([category, group]) => (
          <section key={category} className="mb-5" aria-label={category}>
            <h3 className="mb-1 px-1 text-xs font-semibold text-ink-2">{category}</h3>
            <div className="grid grid-cols-2 gap-x-1.5 gap-y-1">
              {group.builtIn.map((t) => (
                <TemplateTile key={t.id} template={t} />
              ))}
              {group.library.map((d) => (
                <LibraryTemplateTile key={d.id} design={d} />
              ))}
            </div>
          </section>
        ))}
      </PanelScroll>
    </>
  );
}
