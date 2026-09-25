import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented, Slider, Spinner, SwitchRow } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ImageMode } from '@/doc/types';
import { prepareImageSource, renderImage, type PreparedImage } from '@/render/assets';
import { defaultImageSize, insertImage } from '../actions';
import { useDialogs } from '../dialogs';

/**
 * Insert an image with a live 1-bit preview at the exact size it will print,
 * so people choose threshold or dithering by seeing the result.
 */
function ImageForm({ file, at, onDone }: { file: File; at?: { x: number; y: number }; onDone: () => void }) {
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [mode, setMode] = useState<ImageMode>('dither');
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    prepareImageSource(file)
      .then((p) => {
        if (!alive) return;
        setPrepared(p);
        // Line art (few distinct grays) usually looks best thresholded.
        if (file.type === 'image/svg+xml' || file.type === 'image/gif') setMode('threshold');
      })
      .catch(() => {
        toast.error('That file is not an image this browser can read.');
        onDone();
      });
    return () => {
      alive = false;
    };
  }, [file, onDone]);

  const size = useMemo(() => (prepared ? defaultImageSize(prepared.width, prepared.height) : null), [prepared]);

  useEffect(() => {
    if (!prepared || !size) return;
    let alive = true;
    const timer = setTimeout(() => {
      renderImage({ src: prepared.src, mode, threshold, invert, crop: { x: 0, y: 0, width: 1, height: 1 } }, size.width, size.height).then((canvas) => {
        if (alive) setPreview(canvas.toDataURL('image/png'));
      });
    }, 60);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [prepared, size, mode, threshold, invert]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add image</DialogTitle>
        <DialogDescription>Thermal labels print only black dots. Choose how the image becomes black and white.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-5 pb-5 sm:grid-cols-[1fr_220px]">
        <div className="checkerboard flex h-[340px] items-center justify-center overflow-hidden rounded-lg border border-line p-3">
          {preview ? <img src={preview} alt="Black and white preview" className="pixelated max-h-full max-w-full bg-paper" /> : <Spinner className="text-ink-3" />}
        </div>
        <div className="flex flex-col gap-4">
          <Segmented
            aria-label="Conversion"
            value={mode}
            onValueChange={setMode}
            className="w-full"
            options={[
              { value: 'dither', label: 'Dither' },
              { value: 'threshold', label: 'Threshold' },
            ]}
          />
          <p className="-mt-2 text-xs text-ink-3">
            {mode === 'dither' ? 'Dot patterns keep shading. Best for photos.' : 'Solid black and white. Best for logos, text, and line art.'}
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink-2">{mode === 'dither' ? 'Brightness' : 'Threshold'}</span>
              <span className="tabular text-ink-3">{Math.round((threshold / 255) * 100)}%</span>
            </div>
            <Slider aria-label="Threshold level" min={20} max={235} value={[threshold]} onValueChange={([v]) => setThreshold(v ?? 128)} />
          </div>
          <SwitchRow id="insert-invert" label="Invert" checked={invert} onCheckedChange={setInvert} />
          {size && (
            <p className="tabular text-xs text-ink-4">
              {(size.width / 203).toFixed(2)} × {(size.height / 203).toFixed(2)} in on the label. Resize it after adding.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!prepared}
          onClick={() => {
            if (!prepared) return;
            insertImage({ src: prepared.src, naturalWidth: prepared.width, naturalHeight: prepared.height, mode, threshold, invert, at });
            onDone();
          }}
          data-testid="image-insert"
        >
          Add image
        </Button>
      </DialogFooter>
    </>
  );
}

export function ImageDialog() {
  const state = useDialogs((s) => s.image);
  const close = useDialogs((s) => s.close);
  const onDone = useMemo(() => () => close('image'), [close]);
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-w-[680px]">{state && <ImageForm key={state.file.name + state.file.size} file={state.file} at={state.at} onDone={onDone} />}</DialogContent>
    </Dialog>
  );
}
