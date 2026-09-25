import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';
import { Spinner } from '@/components/ui/controls';
import { TooltipProvider } from '@/components/ui/menus';
import { queryClient } from '@/lib/api/queries';
import { currentPath, subscribeToPath } from '@/lib/router';

const Designer = lazy(() => import('@/designer/DesignerApp'));
const Admin = lazy(() => import('@/admin/AdminApp'));

function PageLoading() {
  return (
    <div className="flex h-full items-center justify-center text-ink-3">
      <Spinner className="size-5" />
    </div>
  );
}

export function App() {
  const path = useSyncExternalStore(subscribeToPath, currentPath);
  const isAdmin = path === '/admin' || path.startsWith('/admin/');
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400} skipDelayDuration={150}>
        <Suspense fallback={<PageLoading />}>{isAdmin ? <Admin /> : <Designer />}</Suspense>
        <Toaster
          position="bottom-center"
          offset={20}
          toastOptions={{
            classNames: {
              toast: '!rounded-lg !border-line !bg-paper !text-ink !shadow-pop !font-sans !text-sm !gap-2.5',
              description: '!text-ink-3',
              success: '[&_[data-icon]]:!text-ok',
              error: '[&_[data-icon]]:!text-bad',
              actionButton: '!bg-ink !text-white !rounded-md',
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
