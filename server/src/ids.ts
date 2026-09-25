import { randomBytes } from 'node:crypto';

/** Random URL-safe identifier (16 chars, 96 bits). */
export function newId(): string {
  return randomBytes(12).toString('base64url');
}

/** IDs we generate only contain these characters; used to validate path parameters. */
export const ID_PATTERN = '^[A-Za-z0-9_-]{1,64}$';
