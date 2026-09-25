// JSON schemas for request validation (Fastify/Ajv).

import { ID_PATTERN } from '../ids.js';

export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: ID_PATTERN } },
} as const;

const nullableString = (maxLength: number) => ({ type: ['string', 'null'], maxLength }) as const;

export const designInputBody = {
  type: 'object',
  required: ['name', 'kind', 'orientation', 'document'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['design', 'template'] },
    category: nullableString(100),
    orientation: { type: 'string', enum: ['portrait', 'landscape'] },
    thumbnail: { type: ['string', 'null'], maxLength: 2_000_000, pattern: '^data:image/' },
    variables: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['key', 'label'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 100 },
          label: { type: 'string', maxLength: 200 },
          defaultValue: { type: 'string', maxLength: 10_000 },
        },
      },
    },
    document: {},
  },
} as const;

export const designListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['design', 'template'] },
    q: { type: 'string', maxLength: 200 },
    category: { type: 'string', maxLength: 100 },
    deleted: { type: 'string', enum: ['0', '1'] },
  },
} as const;

export const purgeQuery = {
  type: 'object',
  properties: { purge: { type: 'string', enum: ['0', '1'] } },
} as const;

export const printBody = {
  type: 'object',
  required: ['name', 'images', 'copies'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    images: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', minLength: 1 } },
    copies: { type: 'integer', minimum: 1, maximum: 100 },
    designId: { type: ['string', 'null'], maxLength: 64 },
    printedBy: nullableString(100),
  },
} as const;

export const reprintBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    copies: { type: 'integer', minimum: 1, maximum: 100 },
    printedBy: nullableString(100),
  },
} as const;

export const historyListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    before: { type: 'string', maxLength: 40 },
  },
} as const;

export const historyImageParams = {
  type: 'object',
  required: ['id', 'index'],
  properties: { id: { type: 'string', pattern: ID_PATTERN }, index: { type: 'integer', minimum: 0, maximum: 199 } },
} as const;

export const jobParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

export const passwordBody = {
  type: 'object',
  required: ['password'],
  additionalProperties: false,
  properties: { password: { type: 'string', minLength: 1, maxLength: 1024 } },
} as const;

export const newPasswordBody = {
  type: 'object',
  required: ['password'],
  additionalProperties: false,
  properties: { password: { type: 'string', minLength: 8, maxLength: 1024 } },
} as const;

export const changePasswordBody = {
  type: 'object',
  required: ['current', 'next'],
  additionalProperties: false,
  properties: {
    current: { type: 'string', minLength: 1, maxLength: 1024 },
    next: { type: 'string', minLength: 8, maxLength: 1024 },
  },
} as const;

export const settingsBody = {
  type: 'object',
  required: ['studioName', 'historyRetentionDays', 'defaultCopies'],
  additionalProperties: false,
  properties: {
    studioName: { type: 'string', minLength: 1, maxLength: 80 },
    historyRetentionDays: { type: 'integer', minimum: 1, maximum: 3650 },
    defaultCopies: { type: 'integer', minimum: 1, maximum: 100 },
  },
} as const;

export const printerSettingsBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    darkness: { type: 'integer', minimum: 0, maximum: 100 },
    speed: { anyOf: [{ type: 'number', minimum: 2, maximum: 6 }, { type: 'null' }] },
  },
} as const;

export const serviceParams = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', enum: ['lprint', 'avahi-daemon', 'eco-studio'] } },
} as const;

export const logsQuery = {
  type: 'object',
  required: ['unit'],
  additionalProperties: false,
  properties: {
    unit: { type: 'string', enum: ['lprint', 'eco-studio', 'eco-printer-health'] },
    lines: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
  },
} as const;
