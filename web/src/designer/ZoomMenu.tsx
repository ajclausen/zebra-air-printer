import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menus';
import { modKey } from '@/lib/utils';
import { ACTUAL_SIZE_ZOOM, useViewport, ZOOM_PRESETS, zoomPercent } from './viewport';

/** Last computed zoom, published by the workspace so the menu can show "Fit" as a percentage. */
export const lastZoom = { value: ACTUAL_SIZE_ZOOM };

export function ZoomMenu() {
  const zoom = useViewport((s) => s.zoom);
  const setZoom = useViewport((s) => s.setZoom);
  const label = zoom === null ? 'Fit' : `${zoomPercent(zoom)}%`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="tabular hidden w-[72px] justify-between md:inline-flex" aria-label={`Zoom: ${label}`}>
          {label}
          <ChevronDownIcon className="text-ink-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuItem onSelect={() => setZoom(null)} shortcut={`${modKey}0`}>
          Fit to screen
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setZoom(ACTUAL_SIZE_ZOOM)} shortcut={`${modKey}1`}>
          Actual size
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ZOOM_PRESETS.map((z) => (
          <DropdownMenuItem key={z} onSelect={() => setZoom(z)}>
            {zoomPercent(z)}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
