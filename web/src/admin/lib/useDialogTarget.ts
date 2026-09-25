import { useCallback, useState } from 'react';

/**
 * Open/closed state for a dialog that acts on one item. The item is kept after
 * closing so the dialog's content does not blank out during its exit animation.
 */
export function useDialogTarget<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  /** Increments on every show, for keying form state that should start fresh each time. */
  const [session, setSession] = useState(0);
  const show = useCallback((item: T) => {
    setTarget(item);
    setOpen(true);
    setSession((count) => count + 1);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { target, open, session, show, close };
}
