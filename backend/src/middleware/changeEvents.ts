import type { NextFunction, Request, Response } from 'express';
import { publish, type ChangeAction } from '../services/events';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ACTIONS: Record<string, ChangeAction> = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' };
/** Requests that change nothing worth announcing (or must never be logged with their body). */
const SKIP = [/^\/api\/auth\/(login|register|forgot-password|reset-password|verify-email|resend-verification|accept-invite|2fa\/verify)/, /^\/api\/events/];
const SECRET_KEYS = /pass(word)?|token|secret|code|otp|hash/i;

/** Copy of a request body with passwords, tokens and codes replaced. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

/** "/api/projects/:id/tasks/:taskId/comments" → "projects/tasks/comments" */
function resourceOf(path: string) {
  return path
    .replace(/^\/api\//, '')
    .split('/')
    .filter((s) => s && !OBJECT_ID.test(s))
    .join('/');
}

/** "projects/tasks/comments" + created → "comment.created"; "projects" → "project.updated" */
function typeOf(resource: string, action: ChangeAction) {
  const last = resource.split('/').pop() || 'resource';
  const singular = last.endsWith('ies') ? `${last.slice(0, -3)}y` : last.endsWith('s') && !last.endsWith('ss') ? last.slice(0, -1) : last;
  return `${singular}.${action}`;
}

/**
 * Publishes an AppEvent after every successful POST/PUT/PATCH/DELETE. Mount before the routers; it
 * reads req.user / req.project, which are set by the time the response finishes.
 */
export function changeEvents(req: Request, res: Response, next: NextFunction) {
  const action = ACTIONS[req.method];
  const path = req.originalUrl.split('?')[0];
  if (!action || !path.startsWith('/api/') || SKIP.some((rx) => rx.test(path))) return next();

  // Remember the id of a created record from the JSON response.
  let createdId: string | null = null;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const nested = Object.values(b).find((v) => v && typeof v === 'object' && !Array.isArray(v) && OBJECT_ID.test(String((v as { _id?: unknown })._id ?? ''))) as { _id: unknown } | undefined;
      const id = b.createdTaskId ?? b._id ?? nested?._id;
      if (id && OBJECT_ID.test(String(id))) createdId = String(id);
    }
    return json(body);
  };

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const segments = path.split('/');
    const ids = segments.filter((s) => OBJECT_ID.test(s));
    const projectIdx = segments.indexOf('projects');
    const projectId = req.project?._id ? String(req.project._id) : projectIdx >= 0 && OBJECT_ID.test(segments[projectIdx + 1] ?? '') ? segments[projectIdx + 1] : null;
    const resource = resourceOf(path);
    const newProject = resource === 'projects' && action === 'created' ? createdId : null;
    publish({
      type: typeOf(resource, action),
      action,
      resource,
      method: req.method,
      path,
      status: res.statusCode,
      actor: req.user ? { id: String(req.user._id), name: req.user.name } : null,
      projectId: projectId ?? newProject,
      entityId: action === 'created' ? (createdId ?? null) : (ids[ids.length - 1] ?? createdId ?? null),
      requestId: req.requestId,
      body: req.is('multipart/form-data') ? undefined : redact(req.body),
    });
  });
  next();
}
