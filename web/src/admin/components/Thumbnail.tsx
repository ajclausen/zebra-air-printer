import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Small label preview on white stock. Falls back to a neutral placeholder when there is no image or it fails to load. */
export function Thumbnail({ src, className, dimmed = false }: { src: string | null; className?: string; dimmed?: boolean }) {
  const [failed, setFailed] = useState(false);
  const showImage = src !== null && !failed;
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-line',
        showImage ? 'bg-paper p-0.5' : 'bg-surface text-ink-4',
        dimmed && 'opacity-50',
        className,
      )}
    >
      {showImage ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
      ) : (
        <ImageIcon className="size-4" aria-hidden />
      )}
    </div>
  );
}
