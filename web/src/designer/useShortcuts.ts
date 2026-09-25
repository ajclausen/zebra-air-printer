import { useEffect } from 'react';
import { labelSize } from '@/doc/geometry';
import { isMac } from '@/lib/utils';
import { insertText, saveWorkingDesign } from './actions';
import { getCanvasController } from './canvas/Workspace';
import { useDialogs } from './dialogs';
import { useEditor } from './store';
import { ACTUAL_SIZE_ZOOM, computeViewport, useViewport } from './viewport';

/** True when typing into a form control (or Fabric's hidden textarea during text editing). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="dialog"],[role="menu"],[role="listbox"]') !== null;
}

function currentZoom(): number {
  const el = document.querySelector('[data-testid="workspace"]');
  const state = useViewport.getState();
  if (state.zoom !== null) return state.zoom;
  const container = { width: el?.clientWidth ?? 800, height: el?.clientHeight ?? 800 };
  return computeViewport(container, labelSize(useEditor.getState().doc.orientation), state).zoom;
}

/**
 * Editor keyboard shortcuts and clipboard. Ignored while typing in inputs,
 * dialogs, or while editing text on the canvas.
 */
export function useShortcuts(onPrint: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = isMac ? event.metaKey : event.ctrlKey;
      const editor = useEditor.getState();
      const ids = editor.selection;
      const key = event.key.toLowerCase();
      const handled = () => event.preventDefault();

      if (mod) {
        if (key === 'z') return handled(), event.shiftKey ? editor.redo() : editor.undo();
        if (key === 'y') return handled(), editor.redo();
        if (key === 'c' && ids.length) return handled(), editor.copy(ids);
        if (key === 'x' && ids.length) return handled(), editor.cut(ids);
        if (key === 'd' && ids.length) return handled(), editor.duplicate(ids);
        if (key === 'a') return handled(), editor.setSelection(editor.doc.elements.map((el) => el.id));
        if (key === 'g' && ids.length) return handled(), event.shiftKey ? editor.ungroup(ids) : editor.group(ids);
        if (key === 'l' && ids.length) {
          handled();
          const locked = editor.doc.elements.filter((el) => ids.includes(el.id)).every((el) => el.locked);
          return editor.setLocked(ids, !locked);
        }
        if (key === ']' && ids.length) return handled(), editor.reorder(ids, event.shiftKey ? 'front' : 'forward');
        if (key === '[' && ids.length) return handled(), editor.reorder(ids, event.shiftKey ? 'back' : 'backward');
        if (key === 's') {
          handled();
          if (!editor.doc.elements.length) return;
          if (editor.meta.designId) void saveWorkingDesign({ mode: 'update' }).catch(() => useDialogs.getState().open('save', 'save'));
          else useDialogs.getState().open('save', 'save');
          return;
        }
        if (key === 'p') return handled(), event.shiftKey ? useDialogs.getState().open('preview', true) : onPrint();
        if (key === '0') return handled(), useViewport.getState().setZoom(null);
        if (key === '1') return handled(), useViewport.getState().setZoom(ACTUAL_SIZE_ZOOM);
        if (key === '=' || key === '+') return handled(), useViewport.getState().setZoom(currentZoom() * 1.25);
        if (key === '-') return handled(), useViewport.getState().setZoom(currentZoom() / 1.25);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.length) return handled(), editor.remove(ids);
      if (event.key === 'Escape') return editor.setSelection([]);
      if (event.key === 'Enter' && ids.length === 1) {
        const el = editor.doc.elements.find((e) => e.id === ids[0]);
        if (el?.type === 'text' && !el.locked) return handled(), getCanvasController()?.requestEdit(el.id);
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const arrow = arrows[event.key];
      if (arrow && ids.length) {
        handled();
        const step = event.shiftKey ? 10 : 1;
        editor.nudge(ids, arrow[0] * step, arrow[1] * step);
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files[0]) {
        event.preventDefault();
        useDialogs.getState().open('image', { file: files[0] });
        return;
      }
      const editor = useEditor.getState();
      if (editor.clipboard.length) {
        event.preventDefault();
        editor.paste();
        return;
      }
      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (text) {
        event.preventDefault();
        insertText(text.slice(0, 2000));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [onPrint]);
}
