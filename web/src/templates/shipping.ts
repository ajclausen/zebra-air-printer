import { Package } from 'lucide';
import { iconElement, textElement } from '@/doc/elements';
import type { LabelDocument } from '@/doc/types';
import { lucide } from './icons';
import {
  body,
  centerIn,
  code128,
  eyebrow,
  field,
  frame,
  hRule,
  makeDocument,
  MARGIN as M,
  PORTRAIT,
  PORTRAIT_INNER as INNER,
  RULE_HEAVY,
  RULE_LIGHT,
  signWord,
  symbol,
} from './layout';
import type { BuiltInTemplate } from './types';

const W = PORTRAIT.width;

/** Human-readable line under a barcode, in the same mono face on every template. */
function barcodeCaption(text: string, y: number) {
  return textElement({ x: M, y, width: INNER, height: 40, text, font: 'mono', fontSize: 32, align: 'center', letterSpacing: 160 });
}

function addressLabel(): LabelDocument {
  const reference = 'PO-20417';
  return makeDocument(
    'portrait',
    [
      eyebrow({ x: M, y: M, text: 'From' }),
      body({ x: M, y: M + 40, width: 480, height: 114, text: '{{Sender}}\n{{Sender street}}\n{{Sender city}}', fontSize: 30 }),
      iconElement({ ...lucide('package', Package), x: W - M - 124, y: M, width: 124, height: 124, strokeWidth: 1.5 }),
      hRule(M, 232, INNER, RULE_HEAVY),
      eyebrow({ x: M, y: 272, text: 'Ship to', fontSize: 28, fontWeight: 800, height: 34 }),
      textElement({
        name: 'Recipient',
        x: M,
        y: 324,
        width: INNER,
        height: 330,
        text: '{{Recipient}}\n{{Street}}\n{{City}}',
        fontSize: 96,
        fontWeight: 700,
        lineHeight: 1.12,
        autoFit: true,
      }),
      textElement({
        x: M,
        y: 696,
        width: INNER,
        height: 116,
        text: 'REF  {{Reference}}',
        font: 'condensed',
        fontSize: 76,
        fontWeight: 700,
        invert: true,
        verticalAlign: 'middle',
        letterSpacing: 40,
      }),
      code128({ data: '{{Reference}}', sample: reference, moduleSize: 3, barHeight: 220, y: 862, left: 0, span: W }),
      barcodeCaption('{{Reference}}', 1100),
    ],
    [
      field('Sender', 'Sender name', 'ECO Office'),
      field('Sender street', 'Sender street', '100 Main Street'),
      field('Sender city', 'Sender city, state, ZIP', 'Portland, OR 97204'),
      field('Recipient', 'Recipient', 'Jordan Rivera'),
      field('Street', 'Street', '2150 Harbor Way, Suite 400'),
      field('City', 'City, state, ZIP', 'Seattle, WA 98101'),
      field('Reference', 'Reference', reference),
    ],
  );
}

function returnLabel(): LabelDocument {
  const rma = 'RMA-58213';
  return makeDocument(
    'portrait',
    [
      signWord({ name: 'Heading', x: M, y: M, width: INNER, height: 132, text: 'Return', invert: true, letterSpacing: 120 }),
      eyebrow({ x: M, y: 220, text: 'From' }),
      body({ x: M, y: 258, width: INNER, height: 112, text: '{{Customer}}\n{{Customer street}}\n{{Customer city}}', fontSize: 30 }),
      hRule(M, 404, INNER, RULE_LIGHT),
      eyebrow({ x: M, y: 436, text: 'Return to', fontSize: 28, fontWeight: 800, height: 34 }),
      textElement({
        name: 'Return address',
        x: M,
        y: 486,
        width: INNER,
        height: 290,
        text: '{{Company}}\n{{Street}}\n{{City}}',
        fontSize: 96,
        fontWeight: 700,
        lineHeight: 1.12,
        autoFit: true,
      }),
      hRule(M, 812, INNER, RULE_HEAVY),
      eyebrow({ x: M, y: 852, width: INNER, text: 'Return authorization' }),
      textElement({
        name: 'RMA',
        x: M,
        y: 888,
        width: INNER,
        height: 96,
        text: '{{RMA}}',
        font: 'condensed',
        fontSize: 96,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: 20,
        autoFit: true,
      }),
      code128({ data: '{{RMA}}', sample: rma, moduleSize: 3, barHeight: 140, x: M, y: 1012 }),
    ],
    [
      field('Customer', 'Your name', 'Sam Lee'),
      field('Customer street', 'Your street', '48 Alder Lane'),
      field('Customer city', 'Your city, state, ZIP', 'Eugene, OR 97401'),
      field('Company', 'Return to', 'ECO Returns Dept.'),
      field('Street', 'Street', '100 Main Street'),
      field('City', 'City, state, ZIP', 'Portland, OR 97204'),
      field('RMA', 'Return authorization (RMA)', rma),
    ],
  );
}

function fragileLabel(): LabelDocument {
  const glass = 380;
  const small = 188;
  const inner = INNER - 2 * 48;
  const columns = [W / 2 - 170, W / 2 + 170];
  return makeDocument('portrait', [
    frame('portrait'),
    symbol('fragile', { x: centerIn(glass, 0, W), y: 104, width: glass, height: glass, strokeWidth: 1.75 }),
    signWord({ name: 'Heading', x: M + 48, y: 504, width: inner, height: 170, text: 'Fragile' }),
    textElement({
      x: M + 48,
      y: 704,
      width: inner,
      height: 96,
      text: 'Handle with care',
      fontSize: 48,
      fontWeight: 800,
      letterSpacing: 120,
      uppercase: true,
      invert: true,
      align: 'center',
      verticalAlign: 'middle',
    }),
    hRule(M + 48, 848, inner, RULE_LIGHT),
    symbol('this-side-up', { x: Math.round(columns[0]! - small / 2), y: 888, width: small, height: small }),
    symbol('keep-dry', { x: Math.round(columns[1]! - small / 2), y: 888, width: small, height: small }),
    eyebrow({ x: Math.round(columns[0]! - 150), y: 1092, width: 300, text: 'This way up', align: 'center' }),
    eyebrow({ x: Math.round(columns[1]! - 150), y: 1092, width: 300, text: 'Keep dry', align: 'center' }),
  ]);
}

export const shippingTemplates: BuiltInTemplate[] = [
  {
    id: 'shipping-address',
    name: 'Address label',
    category: 'Shipping',
    description: 'Sender and recipient addresses with a scannable reference number.',
    build: addressLabel,
  },
  {
    id: 'shipping-return',
    name: 'Return label',
    category: 'Shipping',
    description: 'Return address, the sender, and a scannable return authorization number.',
    build: returnLabel,
  },
  {
    id: 'shipping-fragile',
    name: 'Fragile',
    category: 'Shipping',
    description: 'Fragile and handle-with-care warning with this-way-up and keep-dry symbols.',
    build: fragileLabel,
  },
];
