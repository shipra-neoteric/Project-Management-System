import { isValidObjectId } from 'mongoose';
import { z } from 'zod';

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

/**
 * Partial version of an object schema for PATCH bodies. Unlike `schema.partial()`, fields left out stay
 * undefined: zod would otherwise fill in their `.default()` values and silently reset them.
 */
export function patchSchema<T extends z.ZodObject>(schema: T): ReturnType<T['partial']> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      let inner = field as z.ZodType;
      while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) inner = (inner as z.ZodDefault).unwrap() as z.ZodType;
      return [key, inner.optional()];
    }),
  );
  return z.object(shape) as unknown as ReturnType<T['partial']>;
}
