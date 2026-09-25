import { textElement } from '@/doc/elements';
import type { LabelDocument } from '@/doc/types';
import {
  bigFigure,
  blackBox,
  body,
  eyebrow,
  field,
  hRule,
  makeDocument,
  MARGIN as M,
  PORTRAIT_INNER as INNER,
  RULE_HEAVY,
  RULE_LIGHT,
} from './layout';
import type { BuiltInTemplate } from './types';

function openedOn(): LabelDocument {
  const useBy = { y: 592, height: 360 };
  const half = INNER / 2;
  // White-on-black figures get a side inset of about 30 dots; start the box
  // that much further left so the date lines up with its eyebrow.
  const figureInset = 30;
  return makeDocument(
    'portrait',
    [
      eyebrow({ x: M, y: M, text: 'Item' }),
      textElement({
        name: 'Item',
        x: M,
        y: 86,
        width: INNER,
        height: 170,
        text: '{{Item}}',
        fontSize: 120,
        fontWeight: 800,
        lineHeight: 1.05,
        verticalAlign: 'middle',
        autoFit: true,
      }),
      hRule(M, 292, INNER, RULE_HEAVY),
      eyebrow({ x: M, y: 328, text: 'Opened' }),
      bigFigure({ name: 'Opened date', x: M, y: 364, width: INNER, height: 180, text: '{{date}}', align: 'left' }),
      blackBox(M, useBy.y, INNER, useBy.height, 16),
      eyebrow({ x: M + 32, y: useBy.y + 40, text: 'Use by', invert: true }),
      bigFigure({
        name: 'Use-by date',
        x: M + 40 - figureInset,
        y: useBy.y + 88,
        width: INNER - 80 + 2 * figureInset,
        height: 230,
        text: '{{date+7}}',
        align: 'left',
        invert: true,
      }),
      eyebrow({ x: M, y: 1000, text: 'Opened by' }),
      hRule(M, 1090, half - 48, RULE_LIGHT),
      eyebrow({ x: M + half, y: 1000, text: 'Storage' }),
      body({ x: M + half, y: 1038, width: half, height: 90, text: '{{Storage}}', fontSize: 36, fontWeight: 700 }),
    ],
    [field('Item', 'Item', 'Oat milk'), field('Storage', 'Storage', 'Keep refrigerated')],
  );
}

export const foodTemplates: BuiltInTemplate[] = [
  {
    id: 'food-opened',
    name: 'Opened on date',
    category: 'Food',
    description: 'Item name, today’s date as the opened date, and a use-by date seven days later.',
    build: openedOn,
  },
];
