import { ArrowLeftIcon, LogOutIcon, MoreHorizontalIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus';
import { errorMessage } from '@/lib/api/client';
import { useStudioSettings } from '@/lib/api/queries';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useLogout } from '../queries';
import { RebootBanner } from '../reboot/RebootContext';
import { SECTIONS, sectionMeta, type SectionId } from '../sections';

function useLogoutAction() {
  const logout = useLogout();
  return {
    pending: logout.isPending,
    run: () => logout.mutate(undefined, { onError: (error) => toast.error('Could not log out', { description: errorMessage(error) }) }),
  };
}

function Brand({ studioName }: { studioName: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-ink">{studioName}</p>
      <p className="text-xs text-ink-3">Admin</p>
    </div>
  );
}

function Sidebar({ active, studioName }: { active: SectionId; studioName: string }) {
  const logout = useLogoutAction();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="px-5 pt-5 pb-4">
        <Brand studioName={studioName} />
      </div>
      <nav aria-label="Admin sections" className="flex-1 px-3">
        <ul className="flex flex-col gap-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const current = id === active;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-2 outline-none transition-colors hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-cobalt',
                    current && 'bg-paper font-medium text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(24_26_31/0.05)] hover:bg-paper',
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', current ? 'text-cobalt' : 'text-ink-3')} aria-hidden />
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-line px-3 py-3">
        <Button variant="ghost" className="justify-start gap-2.5 px-2.5" onClick={() => navigate('/')}>
          <ArrowLeftIcon className="text-ink-3" />
          Back to designer
        </Button>
        <Button variant="ghost" className="justify-start gap-2.5 px-2.5" onClick={logout.run} disabled={logout.pending}>
          <LogOutIcon className="text-ink-3" />
          Log out
        </Button>
      </div>
    </aside>
  );
}

function MobileBar({ active, studioName }: { active: SectionId; studioName: string }) {
  const logout = useLogoutAction();
  const navRef = useRef<HTMLElement>(null);

  // Keep the current section's pill visible in the horizontally scrolling nav,
  // including when the bar first becomes visible (e.g. the window narrows).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const reveal = () => {
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!link || nav.clientWidth === 0) return;
      const overflowRight = link.offsetLeft + link.offsetWidth - (nav.scrollLeft + nav.clientWidth);
      if (overflowRight > 0) nav.scrollLeft += overflowRight + 16;
      else if (link.offsetLeft < nav.scrollLeft) nav.scrollLeft = Math.max(0, link.offsetLeft - 16);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [active]);

  return (
    <header className="shrink-0 border-b border-line bg-surface md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <Brand studioName={studioName} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => navigate('/')}>
              <ArrowLeftIcon />
              Back to designer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout.run} disabled={logout.pending}>
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav ref={navRef} aria-label="Admin sections" className="relative overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
        <ul className="flex w-max gap-1 px-2">
          {SECTIONS.map(({ id, label }) => {
            const current = id === active;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full px-3 text-sm text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
                    current ? 'bg-ink font-medium text-white' : 'hover:bg-ink/[0.06]',
                  )}
                >
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

/** Admin console frame: navigation plus the active section. */
export function AdminShell({ active, children }: { active: SectionId; children: React.ReactNode }) {
  const { studioName } = useStudioSettings();
  const mainRef = useRef<HTMLElement>(null);
  const label = sectionMeta(active).label;

  useEffect(() => {
    document.title = `${label} · Admin · ${studioName}`;
  }, [label, studioName]);

  // New section: start at the top and move focus into the content for keyboard and screen reader users.
  const firstRender = useRef(true);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    main.focus({ preventScroll: true });
  }, [active]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <Sidebar active={active} studioName={studioName} />
      <MobileBar active={active} studioName={studioName} />
      <main ref={mainRef} tabIndex={-1} aria-label={label} className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none">
        <div className="mx-auto w-full max-w-[1080px] px-4 pt-6 pb-16 sm:px-6 md:px-10 md:pt-9">
          <RebootBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
