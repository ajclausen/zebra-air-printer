import { Recycle, TriangleAlert } from 'lucide';
import { iconNodeToSvg } from './icons';

/**
 * Package-handling and safety symbols for the icon picker's "Label symbols"
 * section and for the built-in templates.
 *
 * Every symbol is inner SVG markup on Lucide's 24 x 24 grid. The renderer wraps
 * it in an <svg> with stroke="#000", the element's stroke width, round caps and
 * joins, and fill="none", so hand-drawn symbols follow Lucide's stroke style and
 * only set fill (or a white stroke) on the parts that must be solid.
 */
export interface LabelSymbol {
  /** Stable id stored in `IconElement.icon`. */
  id: string;
  name: string;
  /** Space-separated search terms for the picker. */
  keywords: string;
  svg: string;
}

/** Wine glass with a crack through the bowl (ISO 780 "Fragile"). */
const FRAGILE =
  '<path d="M8 22h8"/>' +
  '<path d="M12 15v7"/>' +
  '<path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>' +
  '<path d="m12.5 2-2 4 3 2.5-2 3.5"/>';

/** Two upward arrows over a base line (ISO 780 "This way up"). */
const THIS_SIDE_UP =
  '<path d="M3 21h18"/>' +
  '<path d="M7 17V9"/>' +
  '<path d="M17 17V9"/>' +
  '<path d="M7 3 4 9h6Z" fill="#000"/>' +
  '<path d="m17 3-3 6h6Z" fill="#000"/>';

/** Umbrella under falling rain (ISO 780 "Keep dry"). */
const KEEP_DRY =
  '<path d="M3 15a9 7 0 0 1 18 0Z"/>' +
  '<path d="M12 15v4.5a2 2 0 0 0 4 0"/>' +
  '<path d="M12 8V7"/>' +
  '<path d="M4 3.5v2"/>' +
  '<path d="M8.5 2v2"/>' +
  '<path d="M15.5 2v2"/>' +
  '<path d="M20 3.5v2"/>';

/** Solid disc with a white bar (road-sign "No entry"). */
const NO_ENTRY = '<circle cx="12" cy="12" r="10" fill="#000"/>' + '<path d="M6.5 12h11" stroke="#fff" stroke-width="3.5"/>';

/** Open hand carrying a parcel. */
const HANDLE_WITH_CARE =
  '<path d="M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/>' +
  '<path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-2.4 2.2"/>' +
  '<path d="m2 15 6 6"/>' +
  '<rect x="12" y="2" width="8" height="6.5" rx="1"/>' +
  '<path d="M16 2v2.5"/>';

/** Sun under a protective cover (ISO 780 "Keep away from heat"). */
const KEEP_AWAY_FROM_HEAT =
  '<path d="M2 10V3h20v7"/>' +
  '<circle cx="12" cy="15" r="3"/>' +
  '<path d="M12 20v2"/>' +
  '<path d="M5 15h2"/>' +
  '<path d="M17 15h2"/>' +
  '<path d="m7.05 19.95 1.4-1.4"/>' +
  '<path d="m15.55 18.55 1.4 1.4"/>' +
  '<path d="m7.05 10.05 1.4 1.4"/>' +
  '<path d="m15.55 11.45 1.4-1.4"/>' +
  '<path d="M12 8v2"/>';

/** Heavy solid arrow for wayfinding signs; rotate the element to change direction. */
const ARROW = '<path d="M2 9h10V4l10 8-10 8v-5H2Z" fill="#000"/>';

export const LABEL_SYMBOLS: LabelSymbol[] = [
  { id: 'fragile', name: 'Fragile', keywords: 'fragile glass broken breakable handle care iso 780', svg: FRAGILE },
  { id: 'this-side-up', name: 'This side up', keywords: 'this side way up arrows upright orientation iso 780', svg: THIS_SIDE_UP },
  { id: 'keep-dry', name: 'Keep dry', keywords: 'keep dry umbrella rain water moisture wet iso 780', svg: KEEP_DRY },
  { id: 'recycle', name: 'Recycle', keywords: 'recycle recycling recyclable environment reuse', svg: iconNodeToSvg(Recycle) },
  { id: 'warning', name: 'Warning', keywords: 'warning caution danger alert hazard triangle', svg: iconNodeToSvg(TriangleAlert) },
  { id: 'no-entry', name: 'No entry', keywords: 'no entry do not enter prohibited stop forbidden', svg: NO_ENTRY },
  { id: 'handle-with-care', name: 'Handle with care', keywords: 'handle with care hand carry gently parcel delicate', svg: HANDLE_WITH_CARE },
  { id: 'keep-away-from-heat', name: 'Keep away from heat', keywords: 'keep away heat sun hot temperature protect iso 780', svg: KEEP_AWAY_FROM_HEAT },
  { id: 'arrow', name: 'Arrow', keywords: 'arrow direction this way wayfinding pointer', svg: ARROW },
];

/** A symbol by id; throws for unknown ids so template typos fail loudly in development. */
export function labelSymbol(id: string): LabelSymbol {
  const symbol = LABEL_SYMBOLS.find((s) => s.id === id);
  if (!symbol) throw new Error(`Unknown label symbol "${id}".`);
  return symbol;
}
