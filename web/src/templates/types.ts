import type { LabelDocument } from '@/doc/types';

export type TemplateCategory = 'Shipping' | 'Inventory' | 'Signage' | 'Office' | 'Parking' | 'Food';

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Shipping', 'Inventory', 'Signage', 'Office', 'Parking', 'Food'];

/** A starter design that ships in the web bundle. */
export interface BuiltInTemplate {
  /** Stable id, e.g. "shipping-address". */
  id: string;
  name: string;
  category: TemplateCategory;
  /** One short sentence for the template picker. */
  description: string;
  /** Build a fresh document (new element ids every call). */
  build: () => LabelDocument;
}
