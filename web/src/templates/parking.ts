import { shapeElement, textElement } from '@/doc/elements';
import type { LabelDocument, LabelElement } from '@/doc/types';
import {
  bigFigure,
  blackBox,
  body,
  checkBox,
  code128,
  eyebrow,
  field,
  hRule,
  makeDocument,
  MARGIN as M,
  PORTRAIT,
  PORTRAIT_INNER as INNER,
  RULE_HEAVY,
  RULE_LIGHT,
  signWord,
} from './layout';
import type { BuiltInTemplate } from './types';

const W = PORTRAIT.width;

function parkingPermit(): LabelDocument {
  const permit = '0427';
  const mark = 180;
  const headX = M + mark + 36;
  return makeDocument(
    'portrait',
    [
      blackBox(M, M, mark, mark, 28),
      signWord({ name: 'P', x: M + 20, y: M + 20, width: mark - 40, height: mark - 40, text: 'P', invert: true }),
      eyebrow({ x: headX, y: 86, width: W - M - headX, text: 'Parking permit' }),
      textElement({
        name: 'Lot',
        x: headX,
        y: 122,
        width: W - M - headX,
        height: 70,
        text: '{{Lot}}',
        fontSize: 56,
        fontWeight: 800,
        verticalAlign: 'middle',
        autoFit: true,
      }),
      hRule(M, 268, INNER, RULE_HEAVY),
      eyebrow({ x: M, y: 304, width: INNER, text: 'Permit no.', align: 'center' }),
      bigFigure({ name: 'Permit number', x: M, y: 340, width: INNER, height: 260, text: '{{Permit}}', letterSpacing: 20 }),
      eyebrow({ x: M, y: 636, text: 'Plate' }),
      shapeElement({ name: 'Plate outline', x: M, y: 674, width: INNER, height: 152, strokeWidth: 8, cornerRadius: 24 }),
      textElement({
        name: 'Plate',
        x: M + 40,
        y: 696,
        width: INNER - 80,
        height: 108,
        text: '{{Plate}}',
        font: 'mono',
        fontSize: 96,
        fontWeight: 700,
        letterSpacing: 120,
        align: 'center',
        verticalAlign: 'middle',
        uppercase: true,
        autoFit: true,
      }),
      eyebrow({ x: M, y: 862, text: 'Expires' }),
      textElement({ name: 'Expires', x: M, y: 898, width: INNER, height: 76, text: '{{Expires}}', fontSize: 64, fontWeight: 800, lineHeight: 1.05 }),
      // Left-aligned so longer permit numbers grow into the free width, not off the label.
      code128({ data: '{{Permit}}', sample: permit, moduleSize: 4, barHeight: 140, x: M, y: 1020 }),
    ],
    [
      field('Lot', 'Lot', 'Lot B · Staff'),
      field('Permit', 'Permit number', permit),
      field('Plate', 'License plate', '7ABC123'),
      field('Expires', 'Expires', 'Dec 31, 2026'),
    ],
  );
}

function vehicleNotice(): LabelDocument {
  const reasons = [
    'No valid permit displayed',
    'Parked in a reserved space',
    'Blocking a driveway or exit',
    'Taking up more than one space',
    'Fire lane or loading zone',
  ];
  const listTop = 344;
  const pitch = 76;
  const checklist: LabelElement[] = reasons.flatMap((reason, i) => [
    checkBox(M, listTop + i * pitch),
    body({ x: M + 76, y: listTop + i * pitch + 1, width: INNER - 76, height: 44, text: reason, fontSize: 36, lineHeight: 1.15 }),
  ]);
  const col = [M, M + 292, M + 556];
  return makeDocument(
    'portrait',
    [
      signWord({ name: 'Heading', x: M, y: M, width: INNER, height: 132, text: 'Parking notice', invert: true, letterSpacing: 40 }),
      body({ x: M, y: 220, width: INNER, height: 88, text: 'This vehicle is parked against the site parking rules:', fontSize: 36, fontWeight: 700 }),
      ...checklist,
      hRule(M, 750, INNER, RULE_LIGHT),
      eyebrow({ x: col[0], y: 784, text: 'Plate' }),
      hRule(col[0]!, 868, 244, RULE_LIGHT),
      eyebrow({ x: col[1], y: 784, text: 'Date' }),
      body({ x: col[1], y: 822, width: 230, height: 44, text: '{{date}}', fontSize: 34, fontWeight: 700 }),
      eyebrow({ x: col[2], y: 784, text: 'Time' }),
      body({ x: col[2], y: 822, width: W - M - col[2]!, height: 44, text: '{{time}}', fontSize: 34, fontWeight: 700 }),
      hRule(M, 924, INNER, RULE_HEAVY),
      body({
        x: M,
        y: 960,
        width: INNER,
        height: 88,
        text: 'Vehicles parked this way again may be towed at the owner’s expense.',
        fontSize: 32,
      }),
      eyebrow({ x: M, y: 1080, text: 'Questions' }),
      body({ x: M, y: 1116, width: INNER, height: 44, text: '{{Contact}}', fontSize: 34, fontWeight: 700 }),
    ],
    [field('Contact', 'Contact', 'Facilities, ext. 2100')],
  );
}

export const parkingTemplates: BuiltInTemplate[] = [
  {
    id: 'parking-permit',
    name: 'Parking permit',
    category: 'Parking',
    description: 'Hang-tag permit with a large permit number, license plate, expiry date, and barcode.',
    build: parkingPermit,
  },
  {
    id: 'parking-notice',
    name: 'Vehicle notice',
    category: 'Parking',
    description: 'Windshield notice with tick boxes for the reason, plus the date and time it was issued.',
    build: vehicleNotice,
  },
];
