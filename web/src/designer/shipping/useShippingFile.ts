import { useEffect, useState } from 'react';
import { ImportError, prepareShippingFile, type PreparedFile } from '@/import/prepare';

export type ShippingFileState =
  | { status: 'empty' }
  | { status: 'loading'; done: number; total: number | null }
  | { status: 'error'; message: string }
  | { status: 'ready'; prepared: PreparedFile };

/** Prepare a carrier label file for printing, with progress for multi-page PDFs. */
export function useShippingFile(file: File | null): ShippingFileState {
  const [state, setState] = useState<ShippingFileState>({ status: 'empty' });
  useEffect(() => {
    if (!file) {
      setState({ status: 'empty' });
      return;
    }
    // Closing, going back, or picking another file cancels the work in progress.
    const controller = new AbortController();
    const { signal } = controller;
    setState({ status: 'loading', done: 0, total: null });
    prepareShippingFile(file, { signal, onProgress: (done, total) => !signal.aborted && setState({ status: 'loading', done, total }) })
      .then((prepared) => !signal.aborted && setState({ status: 'ready', prepared }))
      .catch((error: unknown) => {
        if (signal.aborted) return;
        const message = error instanceof ImportError ? error.message : `Couldn't read this file. ${error instanceof Error ? error.message : ''}`.trim();
        setState({ status: 'error', message });
      });
    return () => controller.abort();
  }, [file]);
  return state;
}
