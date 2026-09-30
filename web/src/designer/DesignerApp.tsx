import { useCallback, useEffect } from 'react';
import { isPdf } from '@/import/prepare';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { Workspace } from './canvas/Workspace';
import { ImageDialog } from './dialogs/ImageDialog';
import { IconPickerDialog } from './dialogs/IconPickerDialog';
import { QuickPreviewDialog } from './dialogs/PreviewDialog';
import { PrintDialog } from './dialogs/PrintDialog';
import { SaveDialog } from './dialogs/SaveDialog';
import { ShippingLabelDialog } from './dialogs/ShippingLabelDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { useDialogs } from './dialogs';
import { EmptyState } from './EmptyState';
import { MobileApp } from './mobile/MobileApp';
import { LeftPanel, usePanel } from './panels/LeftPanel';
import { usePrintAction } from './printing';
import { PropertiesPanel } from './properties/PropertiesPanel';
import { restoreAutosave, startAutosave, useEditor } from './store';
import { TopBar, useCopiesGetter } from './TopBar';
import { useShortcuts } from './useShortcuts';

if (import.meta.env.DEV) void import('@/devtools');

// Restore the working document before the first render so the canvas starts with it.
const restored = restoreAutosave();

function Editor() {
  const { start } = usePrintAction(useCopiesGetter());
  useShortcuts(start);
  const narrow = useMediaQuery('(max-width: 1099px)');

  useEffect(() => {
    // On tablets, start with the canvas visible unless this is a first visit.
    if (narrow && useEditor.getState().started) usePanel.getState().setPanel(null);
  }, [narrow]);

  const onDropFiles = useCallback((files: File[], point: { x: number; y: number }) => {
    const pdf = files.find(isPdf);
    if (pdf) useDialogs.getState().open('shippingLabel', { file: pdf });
    else if (files[0]) useDialogs.getState().open('image', { file: files[0], at: point });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <Workspace onDropFiles={onDropFiles}>
          <EmptyState />
        </Workspace>
        <PropertiesPanel />
      </div>
      <PrintDialog />
      <QuickPreviewDialog />
      <SaveDialog />
      <IconPickerDialog />
      <ImageDialog />
      <ShortcutsDialog />
      <ShippingLabelDialog />
    </div>
  );
}

export default function DesignerApp() {
  const phone = useMediaQuery('(max-width: 639px)');
  useEffect(() => startAutosave(), []);
  useEffect(() => {
    if (restored && useEditor.getState().started && useEditor.getState().doc.elements.length > 0) usePanel.getState().setPanel('elements');
  }, []);
  return phone ? <MobileApp /> : <Editor />;
}
