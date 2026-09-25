import type { Orientation } from '@eco/shared';
import { cn } from '@/lib/utils';

/**
 * A small label preview on a desk-coloured tile. Portrait and landscape
 * previews share the same tile height so grids stay even.
 */
export function LabelThumb({
  src,
  orientation,
  alt,
  className,
}: {
  src: string | null | undefined;
  orientation: Orientation;
  alt: string;
  className?: string;
}) {
  return (
    <div className={cn('flex aspect-[4/3.4] items-center justify-center rounded-md bg-desk/70 p-2.5', className)}>
      <div
        className={cn(
          'relative overflow-hidden rounded-[4px] bg-paper shadow-[0_0_0_1px_rgb(24_26_31/0.06),0_2px_6px_-2px_rgb(24_26_31/0.25)]',
          orientation === 'portrait' ? 'aspect-[2/3] h-full' : 'aspect-[3/2] w-full',
        )}
      >
        {src ? (
          <img src={src} alt={alt} className="size-full object-contain" draggable={false} />
        ) : src === undefined ? (
          <div className="size-full animate-pulse bg-surface" />
        ) : (
          <div className="flex size-full items-center justify-center text-2xs text-ink-4">No preview</div>
        )}
      </div>
    </div>
  );
}
