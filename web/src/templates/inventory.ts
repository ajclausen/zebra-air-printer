import { textElement } from '@/doc/elements';
import type { LabelDocument, LabelElement } from '@/doc/types';
import {
  bigFigure,
  blackBox,
  body,
  code128,
  eyebrow,
  field,
  hRule,
  LANDSCAPE,
  LANDSCAPE_INNER,
  makeDocument,
  MARGIN as M,
  PORTRAIT,
  qrCode,
  RULE_HEAVY,
  vRule,
} from './layout';
import type { BuiltInTemplate } from './types';

function assetTag(): LabelDocument {
  const asset = 'A-00421';
  const qrModule = 16;
  // The QR sits 4 modules from the label edge; the text column starts 4 modules past it.
  const qrX = 4 * qrModule;
  // Content block (QR beside the number and contact) centered between the band and the bottom margin.
  const top = 264;
  const qr = qrCode({ data: '{{Asset}}', sample: asset, moduleSize: qrModule, x: qrX, y: top });
  const colX = qrX + qr.width + 4 * qrModule;
  const colW = LANDSCAPE.width - M - colX;
  return makeDocument(
    'landscape',
    [
      textElement({
        name: 'Owner band',
        x: M,
        y: M,
        width: LANDSCAPE_INNER,
        height: 112,
        text: 'Property of {{Company}}',
        fontSize: 44,
        fontWeight: 800,
        letterSpacing: 100,
        uppercase: true,
        invert: true,
        verticalAlign: 'middle',
      }),
      qr,
      eyebrow({ x: colX, y: top, text: 'Asset no.' }),
      bigFigure({ name: 'Asset number', x: colX, y: top + 36, width: colW, height: 200, text: '{{Asset}}', align: 'left' }),
      hRule(colX, top + 268, colW),
      eyebrow({ x: colX, y: top + 300, width: colW, text: 'If found, return to' }),
      body({ x: colX, y: top + 338, width: colW, height: 50, text: '{{Contact}}', fontSize: 38, fontWeight: 600 }),
    ],
    [
      field('Company', 'Owner', 'ECO Office'),
      field('Asset', 'Asset number', asset),
      field('Contact', 'Return to', 'IT Help Desk, ext. 4357'),
    ],
  );
}

function binLabel(): LabelDocument {
  const column = LANDSCAPE_INNER / 3; // 374
  const boxX = M + 2 * column + 14;
  const boxW = LANDSCAPE.width - M - boxX;
  const valueTop = 228;
  const valueHeight = 244;
  const cell = (x: number, width: number, label: string, text: string, invert: boolean): LabelElement[] => [
    // Inset so a white-on-black eyebrow's background stays inside the black box.
    eyebrow({ x: x + 16, y: 190, width: width - 32, text: label, align: 'center', invert, letterSpacing: 200 }),
    bigFigure({ name: label, x: x + 16, y: valueTop, width: width - 32, height: valueHeight, text, invert }),
  ];
  return makeDocument(
    'landscape',
    [
      textElement({
        name: 'Item',
        x: M,
        y: M,
        width: LANDSCAPE_INNER,
        height: 64,
        text: '{{Item}}',
        fontSize: 56,
        fontWeight: 700,
        verticalAlign: 'middle',
        autoFit: true,
      }),
      hRule(M, 140, LANDSCAPE_INNER, RULE_HEAVY),
      ...cell(M, column, 'Aisle', '{{Aisle}}', false),
      vRule(M + column - 2, 180, 300, 4),
      ...cell(M + column, column, 'Shelf', '{{Shelf}}', false),
      blackBox(boxX, 172, boxW, 316),
      ...cell(boxX, boxW, 'Bin', '{{counter}}', true),
      code128({ data: '{{Aisle}}-{{Shelf}}-{{counter}}', sample: 'A-03-1', moduleSize: 4, barHeight: 136, y: 548, left: 0, span: LANDSCAPE.width }),
      textElement({
        x: M,
        y: 700,
        width: LANDSCAPE_INNER,
        height: 40,
        text: '{{Aisle}}-{{Shelf}}-{{counter}}',
        font: 'mono',
        fontSize: 32,
        align: 'center',
        letterSpacing: 160,
      }),
    ],
    [field('Item', 'Item', 'M6 hex bolts, zinc'), field('Aisle', 'Aisle', 'A'), field('Shelf', 'Shelf', '03')],
  );
}

/** Six 406-dot square tags (2 x 3) with dashed cut lines; each carries the set number and its part number. */
function tagSheet(): LabelDocument {
  const cell = PORTRAIT.width / 2; // 406
  const pad = M;
  const inner = cell - 2 * pad; // 310
  const qrModule = 6;
  const elements: LabelElement[] = [
    vRule(cell - 1, 40, PORTRAIT.height - 80, 2, true),
    hRule(40, cell - 1, PORTRAIT.width - 80, 2, true),
    hRule(40, 2 * cell - 1, PORTRAIT.width - 80, 2, true),
  ];
  for (let part = 1; part <= 6; part++) {
    const x0 = ((part - 1) % 2) * cell + pad;
    const y0 = Math.floor((part - 1) / 2) * cell + pad;
    const qr = qrCode({ data: `{{Title}}-{{counter}}-${part}`, sample: `Kit-1-${part}`, moduleSize: qrModule, x: 0, y: 0 });
    elements.push(
      eyebrow({ x: x0, y: y0, width: inner, text: '{{Title}}' }),
      bigFigure({ name: `Tag ${part} number`, x: x0, y: y0 + 40, width: inner, height: 132, text: '{{counter}}', align: 'left' }),
      eyebrow({ x: x0, y: y0 + 212, width: 160, text: 'Part' }),
      textElement({ x: x0, y: y0 + 248, width: 160, height: 56, text: `${part} of 6`, fontSize: 44, fontWeight: 800 }),
      { ...qr, x: x0 + inner - qr.width, y: y0 + inner - qr.height },
    );
  }
  return makeDocument('portrait', elements, [field('Title', 'Tag title', 'Kit')]);
}

export const inventoryTemplates: BuiltInTemplate[] = [
  {
    id: 'inventory-asset-tag',
    name: 'Asset tag',
    category: 'Inventory',
    description: 'Owner, asset number, and a QR code with the asset number.',
    build: assetTag,
  },
  {
    id: 'inventory-bin',
    name: 'Bin label',
    category: 'Inventory',
    description: 'Aisle, shelf, and a bin number from the counter, with a matching barcode.',
    build: binLabel,
  },
  {
    id: 'inventory-tag-sheet',
    name: 'Sheet of 6 tags',
    category: 'Inventory',
    description: 'Six cut-apart tags that share a set number from the counter, each with its own part number and QR code.',
    build: tagSheet,
  },
];
