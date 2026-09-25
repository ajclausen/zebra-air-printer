import { selectIsDirty, useEditor } from './store';

/**
 * Ask before replacing a working design that has unsaved changes. Uses the
 * native confirm so it works from any click handler without extra state.
 */
export function confirmDiscard(): boolean {
  const state = useEditor.getState();
  if (!selectIsDirty(state)) return true;
  const saved = Boolean(state.meta.designId);
  return window.confirm(
    saved
      ? `“${state.meta.name}” has unsaved changes. Open the new label anyway? Your changes will be lost.`
      : `“${state.meta.name}” is not saved in the library. Open the new label anyway? It will be replaced.`,
  );
}
