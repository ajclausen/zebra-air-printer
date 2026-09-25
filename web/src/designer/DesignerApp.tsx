import { useEffect } from 'react';
import { Workspace } from './canvas/Workspace';
import { restoreAutosave, startAutosave, useEditor } from './store';
import { BUILT_IN_TEMPLATES } from '@/templates';

if (import.meta.env.DEV) void import('@/devtools');

export default function DesignerApp() {
  useEffect(() => {
    if (!restoreAutosave()) {
      const t = BUILT_IN_TEMPLATES[0]!;
      useEditor.getState().load(t.build(), { designId: null, name: t.name, kind: 'design', category: null });
    }
    return startAutosave();
  }, []);
  return (
    <div className="flex h-full flex-col">
      <Workspace />
    </div>
  );
}
