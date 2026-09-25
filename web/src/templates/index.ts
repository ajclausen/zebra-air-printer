import { shippingTemplates } from './shipping';
import type { BuiltInTemplate } from './types';

export type { BuiltInTemplate, TemplateCategory } from './types';
export { TEMPLATE_CATEGORIES } from './types';

/** Every built-in template, in display order within each category. */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [...shippingTemplates];

export function findTemplate(id: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
