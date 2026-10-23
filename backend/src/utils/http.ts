import { isValidObjectId } from 'mongoose';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);

/** Parses `data` with a Zod schema or throws a 400 with field-level details. */
export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest(details[0] ? `${details[0].field || 'body'}: ${details[0].message}` : 'Invalid request', details);
  }
  return result.data;
}

export function assertObjectId(value: unknown, what = 'Resource'): string {
  const id = typeof value === 'string' ? value : '';
  if (!id || !isValidObjectId(id)) throw notFound(what);
  return id;
}
