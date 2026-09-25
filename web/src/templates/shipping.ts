import { Package } from 'lucide';
import { barcodeElement, emptyDocument, iconElement, lineElement, textElement } from '@/doc/elements';
import type { LabelDocument } from '@/doc/types';
import { lucide } from './icons';
import type { BuiltInTemplate } from './types';

/**
 * Portrait 812 x 1218 dots. Layout grid: 48-dot outer margin (about 1/4 in),
 * black bands for the most important information.
 */
const M = 48;
const W = 812;
const INNER = W - 2 * M;

function addressLabel(): LabelDocument {
  const doc = emptyDocument('portrait');
  doc.elements = [
    textElement({ x: M, y: M, width: 360, height: 34, text: 'FROM', fontSize: 26, fontWeight: 700, letterSpacing: 120 }),
    textElement({
      x: M,
      y: M + 42,
      width: 480,
      height: 110,
      text: '{{Sender name}}\n{{Sender address}}\n{{Sender city}}',
      fontSize: 30,
      lineHeight: 1.2,
    }),
    iconElement({ ...lucide('package', Package), x: W - M - 140, y: M + 4, width: 140, height: 140, strokeWidth: 1.5 }),
    lineElement({ x: M, y: 250, width: INNER, height: 4 }),
    textElement({ x: M, y: 288, width: 360, height: 40, text: 'SHIP TO', fontSize: 30, fontWeight: 800, letterSpacing: 120 }),
    textElement({
      x: M,
      y: 340,
      width: INNER,
      height: 340,
      text: '{{Recipient name}}\n{{Street address}}\n{{City, State ZIP}}',
      fontSize: 64,
      fontWeight: 700,
      lineHeight: 1.12,
      autoFit: true,
    }),
    textElement({
      x: M,
      y: 730,
      width: INNER,
      height: 110,
      text: 'REF  {{Reference}}',
      font: 'condensed',
      fontSize: 72,
      fontWeight: 700,
      invert: true,
      verticalAlign: 'middle',
      letterSpacing: 40,
    }),
    barcodeElement({ x: M, y: 890, symbology: 'code128', data: '{{Reference}}', moduleSize: 4, barHeight: 200, showText: true }),
  ];
  doc.fields = [
    { key: 'Sender name', label: 'Sender name', defaultValue: 'ECO Office' },
    { key: 'Sender address', label: 'Sender street', defaultValue: '100 Main Street' },
    { key: 'Sender city', label: 'Sender city', defaultValue: 'Portland, OR 97204' },
    { key: 'Recipient name', label: 'Recipient', defaultValue: 'Jordan Rivera' },
    { key: 'Street address', label: 'Street', defaultValue: '2150 Harbor Way, Suite 400' },
    { key: 'City, State ZIP', label: 'City, state, ZIP', defaultValue: 'Seattle, WA 98101' },
    { key: 'Reference', label: 'Reference', defaultValue: 'PO-20417' },
  ];
  return doc;
}

export const shippingTemplates: BuiltInTemplate[] = [
  { id: 'shipping-address', name: 'Address label', category: 'Shipping', description: 'Sender, recipient, and a scannable reference.', build: addressLabel },
];
