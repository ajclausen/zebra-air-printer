import type { ApiError } from '@eco/shared';

/** An error that maps directly to an ApiError response. */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  toJSON(): ApiError {
    return { error: this.code, message: this.message };
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Admin login required');
