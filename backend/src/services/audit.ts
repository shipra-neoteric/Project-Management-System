import type { Request } from 'express';
import { Types } from 'mongoose';
import { AuditLog } from '../models/AuditLog';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { subscribe, type AppEvent } from './events';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Friendly names for changed fields in summaries. */
const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  percentComplete: '% done',
  status: 'status',
  type: 'type',
  priority: 'priority',
  assignee: 'assignee',
  accountable: 'accountable',
  category: 'category',
  duration: 'duration',
  constraintStart: 'start date',
  predecessors: 'links',
  relations: 'related tasks',
  resources: 'resources',
  notes: 'notes',
  manual: 'scheduling mode',
  work: 'work',
  remainingWork: 'remaining work',
  budget: 'budget',
  customValues: 'custom fields',
  startDate: 'start date',
  workingDays: 'working days',
  holidays: 'holidays',
  members: 'members',
  disabledModules: 'modules',
  lifecycle: 'life cycle',
  progressMode: 'progress mode',
  role: 'role',
  isActive: 'active',
  globalRoles: 'global roles',
  workSchedule: 'working hours',
  permissions: 'permissions',
  hours: 'hours',
  units: 'units',
  date: 'date',
  rate: 'rate',
};

const VERBS: Record<string, string> = { created: 'created', updated: 'updated', deleted: 'deleted' };

function noun(resource: string) {
  const last = resource.split('/').pop() || 'item';
  const singular = last.endsWith('ies') ? `${last.slice(0, -3)}y` : last.endsWith('s') && !last.endsWith('ss') ? last.slice(0, -1) : last;
  return singular.replace(/-/g, ' ');
}

function changedFields(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const b = body as Record<string, unknown>;
  // Bulk edits wrap the changes in `patch`.
  const source = b.patch && typeof b.patch === 'object' ? (b.patch as Record<string, unknown>) : b;
  return Object.keys(source)
    .filter((k) => !['taskIds', 'afterTaskId'].includes(k))
    .map((k) => FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase())
    .slice(0, 8);
}

/** Builds "Rahul Verma updated task COFO-7 Demolition in Corporate Office Fit-out: status, % done". */
export async function describe(event: Pick<AppEvent, 'actor' | 'action' | 'resource' | 'path' | 'projectId' | 'entityId' | 'body'>) {
  const who = event.actor?.name ?? 'Someone';
  const project = event.projectId && OBJECT_ID.test(event.projectId) ? await Project.findById(event.projectId).select('name key').lean() : null;
  const segments = event.path.split('/');
  const taskIdx = segments.indexOf('tasks');
  const taskId = taskIdx >= 0 && OBJECT_ID.test(segments[taskIdx + 1] ?? '') ? segments[taskIdx + 1] : event.resource === 'projects/tasks' ? event.entityId : null;
  const task = taskId ? await Task.findById(taskId).select('name number').lean() : null;
  const taskLabel = task ? `${task.number && project?.key ? `${project.key}-${task.number} ` : ''}${task.name}` : '';
  const body = (event.body ?? {}) as Record<string, unknown>;
  const thing = noun(event.resource);
  const verb = VERBS[event.action] ?? event.action;

  let what: string;
  if (event.resource === 'projects') what = `project ${project?.name ?? (typeof body.name === 'string' ? body.name : '')}`.trim();
  else if (event.resource === 'projects/tasks') what = `task ${taskLabel || (typeof body.name === 'string' ? body.name : '')}`.trim();
  else if (event.resource.startsWith('projects/tasks/') && taskLabel) what = `${thing} on task ${taskLabel}`;
  else what = `${thing}${typeof body.name === 'string' ? ` "${body.name}"` : ''}`;

  const where = project && event.resource !== 'projects' ? ` in ${project.name}` : '';
  const fields = event.action === 'updated' ? changedFields(event.body) : [];
  return { summary: `${who} ${verb} ${what}${where}${fields.length ? `: ${fields.join(', ')}` : ''}`, projectName: project?.name ?? '' };
}

async function record(event: AppEvent) {
  const { summary, projectName } = await describe(event);
  await AuditLog.create({
    at: new Date(event.at),
    category: event.resource.startsWith('auth/') ? 'security' : 'change',
    type: event.type,
    action: event.action,
    resource: event.resource,
    method: event.method,
    path: event.path,
    status: event.status,
    actor: event.actor && OBJECT_ID.test(event.actor.id) ? new Types.ObjectId(event.actor.id) : null,
    actorName: event.actor?.name ?? '',
    project: event.projectId && OBJECT_ID.test(event.projectId) ? new Types.ObjectId(event.projectId) : null,
    projectName,
    entityId: event.entityId,
    summary,
    requestId: event.requestId ?? '',
    ip: event.ip ?? '',
    userAgent: event.userAgent ?? '',
    body: event.body ?? null,
  });
}

let started = false;
/** Persists every change event. Idempotent. */
export function startAuditTrail() {
  if (started) return;
  started = true;
  subscribe((event) => record(event));
}

const SECURITY_VERBS: Record<string, string> = {
  'auth.login': 'signed in',
  'auth.login_failed': 'failed to sign in',
  'auth.login_password_ok': 'entered the right password (two-factor code pending)',
};

/**
 * Security events that never go through the change feed (sign-ins, failed sign-ins). Never throws:
 * auditing must not break signing in.
 */
export function auditSecurity(req: Request, type: string, actor: { id: string; name: string } | null, details: Record<string, unknown> = {}) {
  void AuditLog.create({
    category: 'security',
    type,
    action: type.split('.').pop() ?? '',
    resource: 'auth',
    method: req.method,
    path: req.originalUrl.split('?')[0],
    status: type.endsWith('failed') ? 401 : 200,
    actor: actor ? new Types.ObjectId(actor.id) : null,
    actorName: actor?.name ?? '',
    summary: `${actor?.name ?? 'Someone'} ${SECURITY_VERBS[type] ?? type.replace('auth.', '').replace(/_/g, ' ')}${details.email ? ` (${String(details.email)})` : ''}`,
    requestId: req.requestId ?? '',
    ip: req.ip ?? '',
    userAgent: req.get('user-agent')?.slice(0, 300) ?? '',
    body: details,
  }).catch((err) => console.error('[audit] could not record security event', err));
}
