import { create } from 'zustand';

export type BatchMode = 'single' | 'sequence' | 'csv';
export type SaveMode = 'save' | 'save-as' | 'template';

interface DialogState {
  print: { mode: BatchMode } | null;
  preview: boolean;
  save: SaveMode | null;
  iconPicker: boolean;
  image: { file: File; at?: { x: number; y: number } } | null;
  field: boolean;
  shortcuts: boolean;
  open: <K extends keyof Omit<DialogState, 'open' | 'close'>>(key: K, value: DialogState[K]) => void;
  close: (key: keyof Omit<DialogState, 'open' | 'close'>) => void;
}

export const useDialogs = create<DialogState>()((set) => ({
  print: null,
  preview: false,
  save: null,
  iconPicker: false,
  image: null,
  field: false,
  shortcuts: false,
  open: (key, value) => set({ [key]: value } as Partial<DialogState>),
  close: (key) => set({ [key]: key === 'preview' || key === 'iconPicker' || key === 'field' || key === 'shortcuts' ? false : null } as Partial<DialogState>),
}));
