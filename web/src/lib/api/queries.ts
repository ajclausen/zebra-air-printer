import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DesignInput, PrintRequest, StudioSettings } from '@eco/shared';
import { api, ApiError, type DesignListQuery } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const queryKeys = {
  designs: (query: DesignListQuery = {}) => ['designs', query] as const,
  allDesigns: ['designs'] as const,
  design: (id: string) => ['design', id] as const,
  history: ['history'] as const,
  printer: ['printer'] as const,
  settings: ['settings'] as const,
  adminState: ['admin', 'state'] as const,
  system: ['admin', 'system'] as const,
  logs: (unit: string, lines: number) => ['admin', 'logs', unit, lines] as const,
};

export const PRINTER_POLL_MS = 5_000;

export function usePrinterStatus() {
  return useQuery({
    queryKey: queryKeys.printer,
    queryFn: api.printer.status,
    refetchInterval: PRINTER_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings.get, staleTime: 60_000 });
}

/** Settings with safe fallbacks so the UI renders before the server answers. */
export function useStudioSettings(): StudioSettings {
  const { data } = useSettings();
  return data ?? { studioName: 'ECO Label Studio', historyRetentionDays: 90, defaultCopies: 1 };
}

export function useDesigns(query: DesignListQuery = {}) {
  return useQuery({ queryKey: queryKeys.designs(query), queryFn: () => api.designs.list(query) });
}

export function useHistory(limit = 50) {
  return useQuery({ queryKey: [...queryKeys.history, limit], queryFn: () => api.history.list({ limit }) });
}

export function useSaveDesign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: DesignInput }) => (id ? api.designs.update(id, input) : api.designs.create(input)),
    onSuccess: (design) => {
      client.setQueryData(queryKeys.design(design.id), design);
      void client.invalidateQueries({ queryKey: queryKeys.allDesigns });
    },
  });
}

export function useDeleteDesign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.designs.remove,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.allDesigns }),
  });
}

export function useDuplicateDesign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.designs.duplicate,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.allDesigns }),
  });
}

export function usePrint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: PrintRequest) => api.print(request),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.printer });
      void client.invalidateQueries({ queryKey: queryKeys.history });
      void client.invalidateQueries({ queryKey: queryKeys.allDesigns });
    },
  });
}

export function useReprint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.history.reprint(id),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.printer });
      void client.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.printer.cancelJob,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.printer }),
  });
}
