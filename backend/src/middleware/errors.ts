import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ScheduleError } from '../scheduling/scheduler';
import { HttpError } from '../utils/http';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { message: `Route ${req.method} ${req.path} not found`, code: 'NOT_FOUND', requestId: req.requestId } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ScheduleError) {
    status = 400;
    code = 'SCHEDULE_ERROR';
    message = err.message;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = Object.values(err.errors)[0]?.message ?? 'Invalid data';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Resource not found';
  } else if ((err as { code?: number })?.code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'This record already exists';
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request body is not valid JSON';
  }

  if (status >= 500) {
    // Never log request bodies (may contain passwords).
    console.error(`[${req.requestId}] ${req.method} ${req.path}`, err);
  }
  res.status(status).json({ error: { message, code, details, requestId: req.requestId } });
}
