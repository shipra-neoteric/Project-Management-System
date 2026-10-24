import { Types } from 'mongoose';
import { Budget, CostEntry, DEFAULT_ACTIVITIES, HourlyRate, TimeActivity, TimeEntry } from '../models/Finance';
import { Task } from '../models/Task';

let seeded: Promise<void> | null = null;

/** Seeds default time activities on first use. */
export function ensureFinanceDefaults(): Promise<void> {
  seeded ??= (async () => {
    if ((await TimeActivity.estimatedDocumentCount()) === 0) {
      await TimeActivity.insertMany(DEFAULT_ACTIVITIES.map((a, position) => ({ ...a, position })));
    }
  })().catch((err) => {
    seeded = null;
    throw err;
  });
  return seeded;
}

const oid = (v: unknown) => new Types.ObjectId(String(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rate valid for a person on a date: the project rate if one applies, otherwise their default rate (0 if none). */
export async function effectiveRate(userId: unknown, projectId: unknown, date: string): Promise<number> {
  const rate = (project: Types.ObjectId | null) =>
    HourlyRate.findOne({ user: oid(userId), project, validFrom: { $lte: date } })
      .sort({ validFrom: -1 })
      .lean<{ rate: number }>();
  return (await rate(oid(projectId)))?.rate ?? (await rate(null))?.rate ?? 0;
}

/**
 * Re-prices a person's time entries after their rates change (for one project, or all projects when
 * a default rate changed). Keeps costs consistent with the rate table.
 */
export async function repriceTime(userId: unknown, projectId?: unknown) {
  const entries = await TimeEntry.find({ user: oid(userId), ...(projectId ? { project: oid(projectId) } : {}) }).select('project date hours');
  const ops = [];
  for (const e of entries) {
    const rate = await effectiveRate(userId, e.project, e.date);
    ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { rate, cost: round2(rate * e.hours) } } } });
  }
  if (ops.length) await TimeEntry.bulkWrite(ops);
}

export interface BudgetSummary {
  plannedLabor: number;
  plannedMaterial: number;
  planned: number;
  actualLabor: number;
  actualMaterial: number;
  actual: number;
  hours: number;
  plannedHours: number;
  remaining: number;
  percentUsed: number;
}

/** Planned vs actual for budgets: actuals come from time on linked tasks and cost entries on the budget or linked tasks. */
export async function summarizeBudgets(projectId: unknown, budgets: { _id: unknown; labor: { hours?: number | null; rate?: number | null }[]; material: { units?: number | null; unitRate?: number | null }[] }[]) {
  const ids = budgets.map((b) => oid(b._id));
  const tasks = await Task.find({ project: oid(projectId), budget: { $in: ids } }).select('_id budget').lean();
  const taskBudget = new Map(tasks.map((t) => [String(t._id), String(t.budget)]));
  const [time, costs] = await Promise.all([
    TimeEntry.find({ project: oid(projectId), task: { $in: tasks.map((t) => t._id) } }).select('task hours cost').lean(),
    CostEntry.find({ project: oid(projectId), $or: [{ budget: { $in: ids } }, { task: { $in: tasks.map((t) => t._id) } }] }).select('task budget cost').lean(),
  ]);
  const result = new Map<string, BudgetSummary>();
  for (const b of budgets) {
    const id = String(b._id);
    const plannedLabor = round2(b.labor.reduce((a, l) => a + (l.hours ?? 0) * (l.rate ?? 0), 0));
    const plannedMaterial = round2(b.material.reduce((a, m) => a + (m.units ?? 0) * (m.unitRate ?? 0), 0));
    const myTime = time.filter((t) => taskBudget.get(String(t.task)) === id);
    const myCosts = costs.filter((c) => String(c.budget) === id || (!c.budget && taskBudget.get(String(c.task)) === id));
    const actualLabor = round2(myTime.reduce((a, t) => a + t.cost, 0));
    const actualMaterial = round2(myCosts.reduce((a, c) => a + c.cost, 0));
    const planned = round2(plannedLabor + plannedMaterial);
    const actual = round2(actualLabor + actualMaterial);
    result.set(id, {
      plannedLabor,
      plannedMaterial,
      planned,
      actualLabor,
      actualMaterial,
      actual,
      hours: round2(myTime.reduce((a, t) => a + t.hours, 0)),
      plannedHours: round2(b.labor.reduce((a, l) => a + (l.hours ?? 0), 0)),
      remaining: round2(planned - actual),
      percentUsed: planned > 0 ? Math.round((actual / planned) * 100) : 0,
    });
  }
  return result;
}

export async function budgetExists(projectId: unknown, budgetId: unknown) {
  return !!(await Budget.exists({ _id: oid(budgetId), project: oid(projectId) }));
}

export { round2 };
