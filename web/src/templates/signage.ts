import { Hand, Wrench } from 'lucide';
import { iconElement, lineElement, shapeElement, textElement } from '@/doc/elements';
import type { LabelDocument } from '@/doc/types';
import { lucide } from './icons';
import {
  body,
  eyebrow,
  field,
  frame,
  FRAME_STROKE,
  hRule,
  LANDSCAPE,
  LANDSCAPE_INNER,
  makeDocument,
  MARGIN as M,
  PORTRAIT,
  PORTRAIT_INNER,
  RULE_LIGHT,
  signWord,
  symbol,
  vRule,
} from './layout';
import type { BuiltInTemplate } from './types';

/** Content inset inside a framed sign: the frame stroke plus breathing room. */
const FRAMED = M + FRAME_STROKE + 36;

function bigSign(): LabelDocument {
  const width = LANDSCAPE.width - 2 * FRAMED;
  return makeDocument(
    'landscape',
    [
      frame('landscape'),
      signWord({ name: 'Message', x: FRAMED, y: FRAMED, width, height: 500, text: '{{Message}}', lineHeight: 1.05 }),
      hRule(FRAMED, 632, width, RULE_LIGHT),
      body({ x: FRAMED, y: 662, width, height: 56, text: '{{Note}}', fontSize: 44, fontWeight: 600, align: 'center' }),
    ],
    [field('Message', 'Sign text', 'Meeting in progress'), field('Note', 'Small print', 'Please come back after 3 PM')],
  );
}

function doNotTouch(): LabelDocument {
  const W = PORTRAIT.width;
  const ring = 460;
  const ringStroke = 44;
  const cx = W / 2;
  const cy = 104 + ring / 2;
  const hand = 290;
  const slash = ring - ringStroke; // reaches into the ring on both ends
  const halo = ringStroke + 24; // white gap between the slash and the hand
  return makeDocument(
    'portrait',
    [
      // Lucide's hand leans right on its grid; nudge it so it reads centered in the ring.
      iconElement({ ...lucide('hand', Hand), x: cx - hand / 2 - 14, y: cy - hand / 2 + 6, width: hand, height: hand, strokeWidth: 2 }),
      lineElement({ name: 'Slash gap', x: cx - slash / 2, y: cy - halo / 2, width: slash, height: halo, angle: 45, ink: 'white' }),
      shapeElement({ name: 'Prohibition ring', shape: 'ellipse', x: cx - ring / 2, y: cy - ring / 2, width: ring, height: ring, strokeWidth: ringStroke }),
      lineElement({ name: 'Prohibition slash', x: cx - slash / 2, y: cy - ringStroke / 2, width: slash, height: ringStroke, angle: 45 }),
      signWord({ name: 'Heading', x: M, y: 616, width: PORTRAIT_INNER, height: 330, text: 'Do not\ntouch', lineHeight: 1 }),
      hRule(M, 990, PORTRAIT_INNER, RULE_LIGHT),
      body({ x: M, y: 1022, width: PORTRAIT_INNER, height: 100, text: '{{Note}}', fontSize: 38, fontWeight: 600, align: 'center' }),
    ],
    [field('Note', 'Reason', 'Calibration in progress')],
  );
}

function outOfOrder(): LabelDocument {
  const half = LANDSCAPE_INNER / 2;
  const icon = 150;
  return makeDocument(
    'landscape',
    [
      signWord({ name: 'Heading', x: M, y: M, width: LANDSCAPE_INNER, height: 250, text: 'Out of order', invert: true }),
      eyebrow({ x: M, y: 340, text: 'Problem' }),
      textElement({
        name: 'Problem',
        x: M,
        y: 378,
        width: LANDSCAPE_INNER - icon - 48,
        height: 140,
        text: '{{Problem}}',
        fontSize: 64,
        fontWeight: 800,
        lineHeight: 1.1,
        autoFit: true,
      }),
      iconElement({ ...lucide('wrench', Wrench), x: LANDSCAPE.width - M - icon, y: 360, width: icon, height: icon, strokeWidth: 1.75 }),
      hRule(M, 556, LANDSCAPE_INNER, RULE_LIGHT),
      eyebrow({ x: M, y: 592, text: 'Reported' }),
      body({ x: M, y: 630, width: half - 48, height: 50, text: '{{date}}', fontSize: 40, fontWeight: 600 }),
      vRule(M + half - 2, 592, 88, 4),
      eyebrow({ x: M + half + 40, y: 592, text: 'Contact' }),
      body({ x: M + half + 40, y: 630, width: half - 40, height: 50, text: '{{Contact}}', fontSize: 40, fontWeight: 600 }),
    ],
    [field('Problem', 'Problem', 'Paper jam in tray 2'), field('Contact', 'Contact', 'Facilities, ext. 2100')],
  );
}

function arrowSign(): LabelDocument {
  const arrow = 480;
  const textX = M + arrow + 40;
  const textW = LANDSCAPE.width - M - textX;
  return makeDocument(
    'landscape',
    [
      symbol('arrow', { x: M, y: (LANDSCAPE.height - arrow) / 2, width: arrow, height: arrow }),
      textElement({
        name: 'Destination',
        x: textX,
        y: 136,
        width: textW,
        height: 350,
        text: '{{Place}}',
        fontSize: 120,
        fontWeight: 800,
        lineHeight: 1.05,
        verticalAlign: 'bottom',
        autoFit: true,
      }),
      hRule(textX, 522, textW, RULE_LIGHT),
      body({ x: textX, y: 554, width: textW, height: 56, text: '{{Note}}', fontSize: 44, fontWeight: 500 }),
    ],
    [field('Place', 'Destination', 'Conference Room B'), field('Note', 'Directions', 'Second floor, east wing')],
  );
}

export const signageTemplates: BuiltInTemplate[] = [
  {
    id: 'signage-big-sign',
    name: 'Big sign',
    category: 'Signage',
    description: 'A short message that grows to fill the label, with a line of small print.',
    build: bigSign,
  },
  {
    id: 'signage-do-not-touch',
    name: 'Do not touch',
    category: 'Signage',
    description: 'Prohibition symbol, "Do not touch", and a reason.',
    build: doNotTouch,
  },
  {
    id: 'signage-out-of-order',
    name: 'Out of order',
    category: 'Signage',
    description: 'Out-of-order notice with the problem, the date reported, and who to contact.',
    build: outOfOrder,
  },
  {
    id: 'signage-arrow',
    name: 'Arrow sign',
    category: 'Signage',
    description: 'A destination with a large arrow; rotate the arrow to point the way.',
    build: arrowSign,
  },
];
