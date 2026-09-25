/**
 * Minimal client-side routing: the app has two top-level pages (designer at
 * "/", admin at "/admin"). The server serves index.html for every non-/api path.
 */

const listeners = new Set<() => void>();

export function currentPath(): string {
  return window.location.pathname;
}

export function subscribeToPath(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}
