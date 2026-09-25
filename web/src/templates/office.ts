import { textElement } from '@/doc/elements';
import type { LabelDocument } from '@/doc/types';
import {
  bigFigure,
  blackBox,
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
  RULE_HEAVY,
  RULE_LIGHT,
  signWord,
  vRule,
} from './layout';
import type { BuiltInTemplate } from './types';

function nameBadge(): LabelDocument {
  const half = LANDSCAPE_INNER / 2;
  return makeDocument(
    'landscape',
    [
      signWord({ name: 'Role', x: M, y: M, width: LANDSCAPE_INNER, height: 120, text: '{{Role}}', invert: true, letterSpacing: 300 }),
      textElement({
        name: 'Name',
        x: M,
        y: 216,
        width: LANDSCAPE_INNER,
        height: 236,
        text: '{{Name}}',
        fontSize: 160,
        fontWeight: 800,
        lineHeight: 1.05,
        verticalAlign: 'middle',
        autoFit: true,
      }),
      body({ x: M, y: 470, width: LANDSCAPE_INNER, height: 64, text: '{{Company}}', fontSize: 52, fontWeight: 500 }),
      hRule(M, 584, LANDSCAPE_INNER, RULE_LIGHT),
      eyebrow({ x: M, y: 620, text: 'Host' }),
      body({ x: M, y: 658, width: half - 48, height: 56, text: '{{Host}}', fontSize: 44, fontWeight: 700 }),
      vRule(M + half - 2, 620, 96, 4),
      eyebrow({ x: M + half + 40, y: 620, text: 'Date' }),
      body({ x: M + half + 40, y: 658, width: half - 40, height: 56, text: '{{date}}', fontSize: 44, fontWeight: 700 }),
    ],
    [
      field('Role', 'Badge type', 'Visitor'),
      field('Name', 'Name', 'Alex Morgan'),
      field('Company', 'Company', 'Northwind Traders'),
      field('Host', 'Host', 'Priya Shah'),
    ],
  );
}

function fileBoxLabel(): LabelDocument {
  const box = 216;
  const boxX = PORTRAIT.width - M - box;
  const leftW = boxX - M - 40;
  const third = Math.floor(PORTRAIT_INNER / 3); // 238
  const dateRow = (i: number, label: string, text: string) => [
    eyebrow({ x: M + i * third, y: 1086, width: third, text: label }),
    body({ x: M + i * third, y: 1122, width: third - 16, height: 48, text, fontSize: 40, fontWeight: 700 }),
  ];
  return makeDocument(
    'portrait',
    [
      eyebrow({ x: M, y: M + 8, text: 'Department' }),
      textElement({
        name: 'Department',
        x: M,
        y: M + 44,
        width: leftW,
        height: 72,
        text: '{{Dept}}',
        fontSize: 60,
        fontWeight: 800,
        verticalAlign: 'middle',
        autoFit: true,
      }),
      eyebrow({ x: M, y: M + 148, text: 'Owner' }),
      body({ x: M, y: M + 184, width: leftW, height: 44, text: '{{Owner}}', fontSize: 36 }),
      blackBox(boxX, M, box, box, 16),
      eyebrow({ x: boxX + 20, y: M + 28, width: box - 40, text: 'Box', align: 'center', invert: true, letterSpacing: 200 }),
      bigFigure({ name: 'Box number', x: boxX + 20, y: M + 68, width: box - 40, height: 124, text: '{{counter}}', invert: true }),
      hRule(M, 304, PORTRAIT_INNER, RULE_HEAVY),
      eyebrow({ x: M, y: 344, text: 'Contents' }),
      textElement({
        name: 'Contents',
        x: M,
        y: 384,
        width: PORTRAIT_INNER,
        height: 626,
        text: '{{Contents}}',
        fontSize: 120,
        fontWeight: 800,
        lineHeight: 1.08,
        verticalAlign: 'middle',
        autoFit: true,
      }),
      hRule(M, 1050, PORTRAIT_INNER, RULE_LIGHT),
      ...dateRow(0, 'From', '{{From}}'),
      ...dateRow(1, 'To', '{{To}}'),
      ...dateRow(2, 'Keep until', '{{Keep}}'),
    ],
    [
      field('Dept', 'Department', 'Finance'),
      field('Owner', 'Owner', 'J. Alvarez'),
      field('Contents', 'Contents', 'Accounts payable invoices'),
      field('From', 'Records from', 'Jan 2025'),
      field('To', 'Records to', 'Dec 2025'),
      field('Keep', 'Keep until', 'Dec 2032'),
    ],
  );
}

function reservedSign(): LabelDocument {
  const inset = M + FRAME_STROKE + 36;
  const width = LANDSCAPE.width - 2 * inset;
  const accent = 160;
  return makeDocument(
    'landscape',
    [
      frame('landscape'),
      signWord({ name: 'Heading', x: inset, y: 108, width, height: 220, text: 'Reserved', letterSpacing: 60 }),
      hRule(Math.round((LANDSCAPE.width - accent) / 2), 372, accent, RULE_HEAVY),
      eyebrow({ x: inset, y: 416, width, text: 'For', align: 'center' }),
      textElement({
        name: 'Reserved for',
        x: inset,
        y: 456,
        width,
        height: 150,
        text: '{{Name}}',
        fontSize: 120,
        fontWeight: 800,
        align: 'center',
        verticalAlign: 'middle',
        autoFit: true,
      }),
      body({ x: inset, y: 640, width, height: 56, text: '{{date}}  ·  {{Hours}}', fontSize: 44, fontWeight: 500, align: 'center' }),
    ],
    [field('Name', 'Reserved for', 'Finance team'), field('Hours', 'Hours', '9:00 – 11:30 AM')],
  );
}

export const officeTemplates: BuiltInTemplate[] = [
  {
    id: 'office-name-badge',
    name: 'Name badge',
    category: 'Office',
    description: 'Badge type, name, company, host, and today’s date.',
    build: nameBadge,
  },
  {
    id: 'office-file-box',
    name: 'File box label',
    category: 'Office',
    description: 'Department, contents, date range, and keep-until date, with the box number from the counter.',
    build: fileBoxLabel,
  },
  {
    id: 'office-reserved',
    name: 'Reserved',
    category: 'Office',
    description: 'Reserved sign for a desk, room, or table, with who it is for and when.',
    build: reservedSign,
  },
];
