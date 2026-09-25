import { foodTemplates } from './food';
import { inventoryTemplates } from './inventory';
import { officeTemplates } from './office';
import { parkingTemplates } from './parking';
import { shippingTemplates } from './shipping';
import { signageTemplates } from './signage';
import type { BuiltInTemplate } from './types';

export type { BuiltInTemplate, TemplateCategory } from './types';
export { TEMPLATE_CATEGORIES } from './types';

/** Every built-in template, in display order within each category. */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  ...shippingTemplates,
  ...inventoryTemplates,
  ...signageTemplates,
  ...officeTemplates,
  ...parkingTemplates,
  ...foodTemplates,
];

export function findTemplate(id: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
