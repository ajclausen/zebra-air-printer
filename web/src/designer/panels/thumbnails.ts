import { useEffect, useState } from 'react';
import { defaultFieldValues } from '@/doc/elements';
import { renderThumbnail } from '@/render/print';
import type { BuiltInTemplate } from '@/templates';

const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

/** Render template previews one at a time so opening the panel never blocks the page. */
function renderQueued(template: BuiltInTemplate): Promise<string | null> {
  let promise = cache.get(template.id);
  if (!promise) {
    promise = queue.then(async () => {
      const doc = template.build();
      try {
        return await renderThumbnail(doc, { values: defaultFieldValues(doc), counter: '1' }, 320);
      } catch (error) {
        console.warn(`Template preview failed for ${template.id}`, error);
        return null;
      }
    });
    queue = promise;
    cache.set(template.id, promise);
  }
  return promise;
}

export function useTemplateThumbnail(template: BuiltInTemplate): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void renderQueued(template).then((value) => alive && setSrc(value));
    return () => {
      alive = false;
    };
  }, [template]);
  return src;
}
