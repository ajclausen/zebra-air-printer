import type { IconNode } from 'lucide';
import type { IconElement } from '@/doc/types';

/** Turn a Lucide icon node list into inner SVG markup on its 24 x 24 grid. */
export function iconNodeToSvg(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([key, value]) => value !== undefined && key !== 'key')
        .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
        .join(' ');
      return `<${tag} ${attributes}/>`;
    })
    .join('');
}

/**
 * Icon fields for an element from a named Lucide import, e.g.
 * `iconElement({ ...lucide('package', Package), x, y, width, height })`.
 * Import icons by name so only the ones used are bundled.
 */
export function lucide(name: string, node: IconNode): Pick<IconElement, 'icon' | 'svg'> {
  return { icon: name, svg: iconNodeToSvg(node) };
}
