import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AuditLog } from '../models/AuditLog';
import { Project } from '../models/Project';
import { isISODate } from '../scheduling/calendar';
import { accessFor } from '../services/permissions';
import { forbidden, notFound, parseBody } from '../utils/http';

/**
 * Audit trail. Administrators see everything; project managers (manage_project) can read the
 * entries of their own project by passing ?project=.
 */
export const auditRouter = Router();

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const querySchema = z.object({
  from: z.string().refine(isISODate, 'Use YYYY-MM-DD').optional(),
  to: z.string().refine(isISODate, 'Use YYYY-MM-DD').optional(),
  user: objectId.optional(),
  project: objectId.optional(),
  type: z.string().max(60).optional(),
  category: z.enum(['change', 'security']).optional(),
  q: z.string().trim().max(100).optional(),
  /** Cursor: the `_id` of the last entry of the previous page. */
  before: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(50),
});

/** Checks access and turns the query into a Mongo filter. */
async function scope(req: Parameters<Parameters<typeof auditRouter.get>[1]>[0], q: z.infer<typeof querySchema>) {
  const filter: Record<string, unknown> = {};
  if (req.user!.role !== 'Admin') {
    if (!q.project) throw forbidden('Only administrators can see the organisation audit trail');
    const project = await Project.findById(q.project);
    if (!project) throw notFound('Project');
    if (!accessFor(project, req.user!)?.permissions.has('manage_project')) throw forbidden('You need permission to manage this project to see its audit trail');
    // Managers never see security events (sign-ins).
    filter.category = 'change';
  }
  if (q.project) filter.project = new Types.ObjectId(q.project);
  if (q.user) filter.actor = new Types.ObjectId(q.user);
  if (q.category && !filter.category) filter.category = q.category;
  if (q.type) filter.type = q.type.includes('.') ? q.type : new RegExp(`^${q.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`);
  if (q.from || q.to) {
    filter.at = {
      ...(q.from ? { $gte: new Date(`${q.from}T00:00:00Z`) } : {}),
      ...(q.to ? { $lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}),
    };
  }
  if (q.q) {
    const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ summary: rx }, { actorName: rx }, { projectName: rx }, { type: rx }, { path: rx }];
  }
  return filter;
}

/** GET /audit — newest first, cursor paging with ?before=<last id>. */
auditRouter.get('/', async (req, res) => {
  const q = parseBody(querySchema, req.query);
  const filter = await scope(req, q);
  if (q.before) filter._id = { $lt: new Types.ObjectId(q.before) };
  const entries = await AuditLog.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const more = entries.length > q.limit;
  const page = more ? entries.slice(0, q.limit) : entries;
  res.json({ entries: page, nextCursor: more ? String(page[page.length - 1]._id) : null });
});

/** GET /audit/stats — changes and active people today, failed sign-ins in the last 24 hours. */
auditRouter.get('/stats', async (req, res) => {
  const q = parseBody(querySchema.pick({ project: true }), req.query);
  const base = await scope(req, { ...q, limit: 1 });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [changesToday, actors, failedLogins, types] = await Promise.all([
    AuditLog.countDocuments({ ...base, category: 'change', at: { $gte: today } }),
    AuditLog.distinct('actor', { ...base, at: { $gte: today }, actor: { $ne: null } }),
    req.user!.role === 'Admin' ? AuditLog.countDocuments({ type: 'auth.login_failed', at: { $gte: new Date(Date.now() - 86_400_000) } }) : Promise.resolve(0),
    AuditLog.distinct('type', base),
  ]);
  res.json({ changesToday, activeUsers: actors.length, failedLogins, types: types.sort() });
});
