import type { DesignKind, DesignSummary } from '@eco/shared';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api/client';
import { usePurgeDesign, useRestoreDesign, useSoftDeleteDesign, useUpdateDesignMeta } from '../queries';

const quoted = (design: DesignSummary) => `“${design.name}”`;
const kindNoun: Record<DesignKind, string> = { design: 'design', template: 'template' };

/** Library mutations with their success and failure toasts, plus which row is busy. */
export function useLibraryActions() {
  const restoreMutation = useRestoreDesign();
  const deleteMutation = useSoftDeleteDesign();
  const purgeMutation = usePurgeDesign();
  const metaMutation = useUpdateDesignMeta();

  const fail = (what: string) => (error: unknown) => toast.error(what, { description: errorMessage(error) });

  function restore(design: DesignSummary) {
    restoreMutation.mutate(design.id, {
      onSuccess: () => toast.success(`Restored ${quoted(design)}`),
      onError: fail(`Could not restore ${quoted(design)}`),
    });
  }

  function softDelete(design: DesignSummary) {
    deleteMutation.mutate(design.id, {
      onSuccess: () => toast.success(`Deleted ${quoted(design)}`, { action: { label: 'Undo', onClick: () => restore(design) } }),
      onError: fail(`Could not delete ${quoted(design)}`),
    });
  }

  function purge(design: DesignSummary, options: { onSuccess?: () => void } = {}) {
    purgeMutation.mutate(design.id, {
      onSuccess: () => {
        toast.success(`Permanently deleted ${quoted(design)}`);
        options.onSuccess?.();
      },
      onError: fail(`Could not delete ${quoted(design)}`),
    });
  }

  function setKind(design: DesignSummary, kind: DesignKind) {
    metaMutation.mutate(
      { id: design.id, patch: { kind } },
      {
        onSuccess: () => toast.success(`${quoted(design)} is now a ${kindNoun[kind]}`),
        onError: fail(`Could not change ${quoted(design)} to a ${kindNoun[kind]}`),
      },
    );
  }

  function setCategory(design: DesignSummary, category: string | null, options: { onSuccess?: () => void } = {}) {
    metaMutation.mutate(
      { id: design.id, patch: { category } },
      {
        onSuccess: () => {
          toast.success(category ? `Moved ${quoted(design)} to ${category}` : `Removed the category from ${quoted(design)}`);
          options.onSuccess?.();
        },
        onError: fail(`Could not change the category of ${quoted(design)}`),
      },
    );
  }

  const busyIds = new Set<string>();
  if (restoreMutation.isPending && restoreMutation.variables) busyIds.add(restoreMutation.variables);
  if (deleteMutation.isPending && deleteMutation.variables) busyIds.add(deleteMutation.variables);
  if (purgeMutation.isPending && purgeMutation.variables) busyIds.add(purgeMutation.variables);
  if (metaMutation.isPending && metaMutation.variables) busyIds.add(metaMutation.variables.id);

  return {
    restore,
    softDelete,
    purge,
    setKind,
    setCategory,
    busyIds,
    purgePending: purgeMutation.isPending,
    categoryPending: metaMutation.isPending,
  };
}

export type LibraryActions = ReturnType<typeof useLibraryActions>;
