import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AdminState, Design, DesignInput, HistoryEntry, PrinterSettingsInput, ReprintRequest, ServiceName, StudioSettings } from '@eco/shared';
import { api, ApiError, type LogUnit } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queries';

/** Admin-only query keys. Everything admin lives under ['admin'] so logout can clear it in one call. */
export const adminKeys = {
  all: ['admin'] as const,
  state: queryKeys.adminState,
  system: queryKeys.system,
  logs: (unit: LogUnit, lines: number) => queryKeys.logs(unit, lines),
  library: ['designs', { deleted: true }] as const,
  history: [...queryKeys.history, 'admin'] as const,
};

export const SYSTEM_POLL_MS = 10_000;
export const HISTORY_PAGE_SIZE = 100;

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Wrong password on login (401) or on password change (403). */
export function isWrongPassword(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'invalid_password' || (error.status === 401 && error.code !== 'unauthorized'));
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

/** 410: the stored label images were pruned, so the entry can no longer be reprinted. */
export function isImagesMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'images_missing' || error.status === 410);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function useAdminState() {
  return useQuery({ queryKey: adminKeys.state, queryFn: api.admin.state, staleTime: 30_000 });
}

function setAdminState(client: QueryClient, state: AdminState) {
  client.setQueryData(adminKeys.state, state);
}

export function useSetupAdmin() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.admin.setup, onSuccess: (state) => setAdminState(client, state) });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.admin.login, onSuccess: (state) => setAdminState(client, state) });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.admin.logout,
    onSuccess: (state) => {
      client.removeQueries({ queryKey: adminKeys.system });
      client.removeQueries({ queryKey: ['admin', 'logs'] });
      setAdminState(client, state);
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: ({ current, next }: { current: string; next: string }) => api.admin.changePassword(current, next) });
}

// ---------------------------------------------------------------------------
// System and services
// ---------------------------------------------------------------------------

/** System info; polls every 10 s unless `poll` is false (e.g. on pages that only need the certificate). */
export function useSystemInfo({ poll = true }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: adminKeys.system,
    queryFn: api.admin.system,
    refetchInterval: poll ? SYSTEM_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useRestartService() {
  return useMutation({ mutationFn: (name: ServiceName) => api.admin.restartService(name) });
}

export function useReboot() {
  return useMutation({ mutationFn: api.admin.reboot });
}

export function useLogs(unit: LogUnit, lines: number, autoRefresh: boolean) {
  return useQuery({
    queryKey: adminKeys.logs(unit, lines),
    queryFn: () => api.admin.logs(unit, lines),
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Printer
// ---------------------------------------------------------------------------

/** Test prints go straight to the printer and are not recorded in history. */
export function useTestPrint() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.printer.testPrint,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.printer }),
  });
}

export function useUpdatePrinter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PrinterSettingsInput) => api.admin.updatePrinter(input),
    onSuccess: (status) => client.setQueryData(queryKeys.printer, status),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: StudioSettings) => api.settings.update(settings),
    onSuccess: (settings) => client.setQueryData(queryKeys.settings, settings),
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export function useLibrary() {
  return useQuery({ queryKey: adminKeys.library, queryFn: () => api.designs.list({ deleted: true }) });
}

function useLibraryMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.allDesigns }),
  });
}

export function useRestoreDesign() {
  return useLibraryMutation(api.designs.restore);
}

export function useSoftDeleteDesign() {
  return useLibraryMutation(api.designs.remove);
}

export function usePurgeDesign() {
  return useLibraryMutation(api.designs.purge);
}

/** Builds the full PUT body from a stored design. PUT replaces, so every field must be carried over. */
function toDesignInput(design: Design): DesignInput {
  return {
    name: design.name,
    kind: design.kind,
    category: design.category,
    orientation: design.orientation,
    thumbnail: design.thumbnail,
    variables: design.variables,
    document: design.document,
  };
}

export type DesignPatch = Partial<Pick<DesignInput, 'kind' | 'category'>>;

/** Changes kind or category by reading the full design first, then writing it back with the patch applied. */
export function useUpdateDesignMeta() {
  return useLibraryMutation(async ({ id, patch }: { id: string; patch: DesignPatch }) => {
    const design = await api.designs.get(id);
    return api.designs.update(id, { ...toDesignInput(design), ...patch });
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function useReprintEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReprintRequest }) => api.history.reprint(id, body),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.printer });
      void client.invalidateQueries({ queryKey: queryKeys.history });
    },
  });
}

export function useDeleteHistoryEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.history.remove,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.history }),
  });
}

export function useHistoryPages() {
  return useInfiniteQuery({
    queryKey: adminKeys.history,
    queryFn: ({ pageParam }) => api.history.list({ limit: HISTORY_PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: HistoryEntry[]) => (lastPage.length < HISTORY_PAGE_SIZE ? undefined : lastPage.at(-1)?.createdAt),
  });
}
