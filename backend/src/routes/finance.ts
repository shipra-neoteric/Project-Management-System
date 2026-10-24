import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { hasPerm, loadProject } from '../middleware/projectAccess';
import { Budget, CostEntry, CostType, HourlyRate, TimeActivity, TimeEntry } from '../models/Finance';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { isISODate, todayISO } from '../scheduling/calendar';
import { accessFor, projectPeopleIds } from '../services/permissions';
import { budgetExists, ensureFinanceDefaults, repriceTime, round2, summarizeBudgets } from '../services/costing';
import { assertObjectId, badRequest, forbidden, notFound, parseBody } from '../utils/http';

/** Mounted at /api/projects/:id — cost entries, budgets, project hourly rates and reports. */
export const financeRouter = Router({ mergeParams: true });

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
const money = z.number().min(0).max(1e10);

async function assertTask(projectId: Types.ObjectId, taskId: string | null | undefined) {
  if (taskId && !(await Task.exists({ _id: taskId, project: projectId }))) throw badRequest('That task is not in this project');
}

// ---- Cost entries (materials, equipment, subcontracts…) -----------------------------------------

const costEntrySchema = z.object({
  costType: objectId,
  units: z.number().min(0).max(1e9),
  date: isoDate,
  task: objectId.nullish(),
  budget: objectId.nullish(),
  comment: z.string().max(500).optional().default(''),
});

/** Everyone's entries with "view costs"; only your own with just "log costs". */
financeRouter.get('/cost-entries', loadProject('view_project'), async (req, res) => {
  const all = hasPerm(req, 'view_costs');
  if (!all && !hasPerm(req, 'log_costs')) throw forbidden('You don’t have permission to see costs');
  const entries = await CostEntry.find({ project: req.project!._id, ...(all ? {} : { user: req.user!._id }) }).sort({ date: -1, createdAt: -1 }).populate('user', 'name').populate('costType', 'name unit').lean();
  res.json({ entries });
});

financeRouter.post('/cost-entries', loadProject('log_costs'), async (req, res) => {
  const body = parseBody(costEntrySchema, req.body);
  const type = await CostType.findById(body.costType);
  if (!type) throw badRequest('Unknown cost type');
  await assertTask(req.project!._id, body.task);
  if (body.budget && !(await budgetExists(req.project!._id, body.budget))) throw badRequest('Unknown budget');
  const entry = await CostEntry.create({
    ...body,
    task: body.task ?? null,
    budget: body.budget ?? null,
    project: req.project!._id,
    user: req.user!._id,
    unitRate: type.unitRate,
    cost: round2(type.unitRate * body.units),
  });
  res.status(201).json({ entry });
});

financeRouter.patch('/cost-entries/:entryId', loadProject('log_costs'), async (req, res) => {
  const body = parseBody(costEntrySchema.partial(), req.body);
  const entry = await CostEntry.findOne({ _id: assertObjectId(req.params.entryId, 'Cost entry'), project: req.project!._id });
  if (!entry) throw notFound('Cost entry');
  if (String(entry.user) !== String(req.user!._id) && !hasPerm(req, 'manage_budgets')) throw forbidden('You can only change your own cost entries');
  await assertTask(req.project!._id, body.task);
  if (body.costType) {
    const type = await CostType.findById(body.costType);
    if (!type) throw badRequest('Unknown cost type');
    entry.unitRate = type.unitRate;
  }
  entry.set({ ...body, ...(body.task !== undefined ? { task: body.task ?? null } : {}), ...(body.budget !== undefined ? { budget: body.budget ?? null } : {}) });
  entry.cost = round2(entry.unitRate * entry.units);
  await entry.save();
  res.json({ entry });
});

financeRouter.delete('/cost-entries/:entryId', loadProject('log_costs'), async (req, res) => {
  const entry = await CostEntry.findOne({ _id: assertObjectId(req.params.entryId, 'Cost entry'), project: req.project!._id });
  if (!entry) throw notFound('Cost entry');
  if (String(entry.user) !== String(req.user!._id) && !hasPerm(req, 'manage_budgets')) throw forbidden('You can only delete your own cost entries');
  await entry.deleteOne();
  res.status(204).end();
});

// ---- Budgets -------------------------------------------------------------------------------

const budgetSchema = z.object({
  name: z.string().trim().min(1, 'Name the budget').max(120),
  description: z.string().max(2000).optional().default(''),
  labor: z.array(z.object({ label: z.string().max(80).default(''), user: objectId.nullish(), hours: z.number().min(0).max(1e6), rate: money })).max(100).default([]),
  material: z.array(z.object({ costType: objectId, units: z.number().min(0).max(1e9), unitRate: money.optional(), comment: z.string().max(200).default('') })).max(100).default([]),
});

async function prepareMaterial(material: z.infer<typeof budgetSchema>['material']) {
  const types = new Map((await CostType.find({ _id: { $in: material.map((m) => m.costType) } }).lean()).map((t) => [String(t._id), t]));
  return material.map((m) => {
    const t = types.get(m.costType);
    if (!t) throw badRequest('Unknown cost type in budget');
    return { ...m, unitRate: m.unitRate ?? t.unitRate };
  });
}

financeRouter.get('/budgets', loadProject('view_budgets'), async (req, res) => {
  const budgets = await Budget.find({ project: req.project!._id }).sort({ createdAt: 1 }).populate('material.costType', 'name unit').populate('labor.user', 'name').lean();
  const summary = await summarizeBudgets(req.project!._id, budgets);
  const showMoney = hasPerm(req, 'view_costs') || hasPerm(req, 'manage_budgets');
  res.json({ budgets: budgets.map((b) => ({ ...b, summary: summary.get(String(b._id)) })), canSeeMoney: showMoney });
});

financeRouter.post('/budgets', loadProject('manage_budgets'), async (req, res) => {
  const body = parseBody(budgetSchema, req.body);
  const budget = await Budget.create({ ...body, material: await prepareMaterial(body.material), project: req.project!._id });
  res.status(201).json({ budget });
});

financeRouter.patch('/budgets/:budgetId', loadProject('manage_budgets'), async (req, res) => {
  const body = parseBody(budgetSchema.partial(), req.body);
  const budget = await Budget.findOne({ _id: assertObjectId(req.params.budgetId, 'Budget'), project: req.project!._id });
  if (!budget) throw notFound('Budget');
  budget.set({ ...body, ...(body.material ? { material: await prepareMaterial(body.material) } : {}) });
  await budget.save();
  res.json({ budget });
});

financeRouter.delete('/budgets/:budgetId', loadProject('manage_budgets'), async (req, res) => {
  const id = assertObjectId(req.params.budgetId, 'Budget');
  const deleted = await Budget.findOneAndDelete({ _id: id, project: req.project!._id });
  if (!deleted) throw notFound('Budget');
  await Promise.all([
    Task.updateMany({ project: req.project!._id, budget: id }, { $set: { budget: null } }),
    CostEntry.updateMany({ project: req.project!._id, budget: id }, { $set: { budget: null } }),
  ]);
  res.status(204).end();
});

// ---- Project hourly rates (override a person's default rate in this project) --------------

financeRouter.get('/rates', loadProject('view_costs'), async (req, res) => {
  const rates = await HourlyRate.find({ project: req.project!._id }).sort({ validFrom: -1 }).populate('user', 'name').lean();
  res.json({ rates });
});

financeRouter.post('/rates', loadProject('manage_rates'), async (req, res) => {
  const body = parseBody(z.object({ user: objectId, rate: money, validFrom: isoDate }), req.body);
  if (!(await projectPeopleIds(req.project!)).has(body.user)) throw badRequest('That person is not in this project');
  const rate = await HourlyRate.findOneAndUpdate(
    { user: body.user, project: req.project!._id, validFrom: body.validFrom },
    { $set: { rate: body.rate } },
    { upsert: true, new: true },
  );
  await repriceTime(body.user, req.project!._id);
  res.status(201).json({ rate });
});

financeRouter.delete('/rates/:rateId', loadProject('manage_rates'), async (req, res) => {
  const rate = await HourlyRate.findOneAndDelete({ _id: assertObjectId(req.params.rateId, 'Rate'), project: req.project!._id });
  if (!rate) throw notFound('Rate');
  await repriceTime(rate.user, req.project!._id);
  res.status(204).end();
});

// ---- Reports -------------------------------------------------------------------------------

const reportSchema = z.object({
  kind: z.enum(['time', 'cost']).default('time'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  groupBy: z.enum(['user', 'activity', 'task', 'month', 'week', 'costType', 'project']).default('user'),
  includeSubprojects: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  user: objectId.optional(),
});

const weekOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** GET /projects/:id/reports — time or cost totals grouped by person, activity, task, period, cost type or project. */
financeRouter.get('/reports', loadProject('view_project'), async (req, res) => {
  const q = parseBody(reportSchema, req.query);
  const project = req.project!;
  if (q.kind === 'time' && !hasPerm(req, 'view_time') && !hasPerm(req, 'log_time')) throw forbidden('You don’t have permission to see time reports');
  if (q.kind === 'cost' && !hasPerm(req, 'view_costs')) throw forbidden('You don’t have permission to see cost reports');

  // Scope: this project plus sub-projects the user can see with the same permission.
  const scope = [project];
  if (q.includeSubprojects) {
    let frontier = [project._id];
    for (let depth = 0; frontier.length && depth < 10; depth++) {
      const children = await Project.find({ parent: { $in: frontier }, isTemplate: { $ne: true } });
      const visible = children.filter((c) => {
        const a = accessFor(c, req.user!);
        return a && a.permissions.has(q.kind === 'time' ? 'view_time' : 'view_costs');
      });
      scope.push(...visible);
      frontier = children.map((c) => c._id);
    }
  }
  const ids = scope.map((p) => p._id);
  const names = new Map(scope.map((p) => [String(p._id), p.name]));
  const dateFilter = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const base = { project: { $in: ids }, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) };
  const showCost = hasPerm(req, 'view_costs');

  type Row = { project: unknown; task: unknown; user: unknown; date: string; hours?: number; units?: number; cost: number; activity?: unknown; costType?: unknown };
  let rows: Row[];
  if (q.kind === 'time') {
    const onlyOwn = !hasPerm(req, 'view_time');
    rows = await TimeEntry.find({ ...base, ...(onlyOwn ? { user: req.user!._id } : q.user ? { user: q.user } : {}) }).lean<Row[]>();
  } else {
    rows = await CostEntry.find({ ...base, ...(q.user ? { user: q.user } : {}) }).lean<Row[]>();
  }

  // Labels for the grouping keys
  await ensureFinanceDefaults();
  const [users, activities, types, tasks] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.user)))] } }).select('name').lean(),
    TimeActivity.find().lean(),
    CostType.find().lean(),
    Task.find({ _id: { $in: [...new Set(rows.map((r) => String(r.task)).filter((t) => t !== 'null'))] } }).select('name number project').lean(),
  ]);
  const label = {
    user: new Map(users.map((u) => [String(u._id), u.name])),
    activity: new Map(activities.map((a) => [String(a._id), a.name])),
    costType: new Map(types.map((t) => [String(t._id), t.name])),
    task: new Map(tasks.map((t) => [String(t._id), t.name])),
  };

  const groups = new Map<string, { key: string; label: string; hours: number; units: number; cost: number; count: number }>();
  for (const r of rows) {
    let key: string;
    let text: string;
    switch (q.groupBy) {
      case 'user': key = String(r.user); text = label.user.get(key) ?? 'Former user'; break;
      case 'activity': key = String(r.activity ?? ''); text = label.activity.get(key) ?? 'No activity'; break;
      case 'costType': key = String(r.costType ?? ''); text = label.costType.get(key) ?? 'Unknown cost type'; break;
      case 'task': key = String(r.task ?? ''); text = label.task.get(key) ?? 'No task (project level)'; break;
      case 'project': key = String(r.project); text = names.get(key) ?? 'Project'; break;
      case 'week': key = weekOf(r.date); text = `Week of ${key}`; break;
      default: key = r.date.slice(0, 7); text = key;
    }
    const g = groups.get(key) ?? { key, label: text, hours: 0, units: 0, cost: 0, count: 0 };
    g.hours += r.hours ?? 0;
    g.units += r.units ?? 0;
    g.cost += r.cost;
    g.count += 1;
    groups.set(key, g);
  }
  const sorted = [...groups.values()]
    .map((g) => ({ ...g, hours: round2(g.hours), units: round2(g.units), cost: showCost ? round2(g.cost) : null }))
    .sort((a, b) => (q.groupBy === 'month' || q.groupBy === 'week' ? a.key.localeCompare(b.key) : (b.cost ?? b.hours) - (a.cost ?? a.hours)));

  res.json({
    kind: q.kind,
    groupBy: q.groupBy,
    rows: sorted,
    totals: { hours: round2(rows.reduce((a, r) => a + (r.hours ?? 0), 0)), cost: showCost ? round2(rows.reduce((a, r) => a + r.cost, 0)) : null, entries: rows.length },
    projects: scope.length,
    generatedAt: todayISO(),
  });
});
