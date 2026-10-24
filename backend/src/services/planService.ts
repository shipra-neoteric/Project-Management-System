import { Types } from 'mongoose';
import { TimeEntry } from '../models/Finance';
import { getCatalog } from './catalog';
import type { ProjectDoc } from '../models/Project';
import { Task, type PlanTask } from '../models/Task';
import type { UserDoc } from '../models/User';
import { accessFor } from './permissions';
import { todayISO } from '../scheduling/calendar';
import { schedule } from '../scheduling/scheduler';

/** Fields persisted for each task (everything except identity/audit timestamps). */
const PERSISTED_FIELDS = [
  'parent', 'order', 'name', 'duration', 'constraintStart', 'percentComplete', 'predecessors', 'resources', 'notes',
  'type', 'status', 'priority', 'assignee', 'accountable', 'category', 'watchers', 'number', 'manual', 'relations', 'customValues', 'work', 'remainingWork', 'budget', 'baselineStart', 'baselineFinish', 'start', 'finish', 'isSummary', 'isMilestone', 'isCritical', 'totalSlack', 'wbs',
  'outlineLevel', 'rowNumber', 'updatedBy',
] as const;

const snapshot = (t: PlanTask) => JSON.stringify(PERSISTED_FIELDS.map((f) => t[f]));

export async function loadTasks(projectId: Types.ObjectId): Promise<PlanTask[]> {
  return Task.find({ project: projectId }).sort({ rowNumber: 1 }).lean<PlanTask[]>();
}

/** Renumbers `order` within each sibling group to 0..n-1, preserving relative order. */
export function normalizeOrders(tasks: PlanTask[]): void {
  const groups = new Map<string, PlanTask[]>();
  for (const t of tasks) {
    const key = t.parent ? t.parent.toString() : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.order - b.order).forEach((t, i) => (t.order = i));
  }
}

export interface PlanResponse {
  project: Record<string, unknown>;
  tasks: (PlanTask & { spentHours?: number })[];
}

/** Adds `spentHours` (logged time, rolled up to summary tasks) to each task — not stored on the task. */
export async function withSpentHours<T extends PlanTask>(projectId: Types.ObjectId, tasks: T[]): Promise<(T & { spentHours: number })[]> {
  const rows = await TimeEntry.aggregate<{ _id: Types.ObjectId; hours: number }>([
    { $match: { project: new Types.ObjectId(String(projectId)), task: { $ne: null } } },
    { $group: { _id: '$task', hours: { $sum: '$hours' } } },
  ]);
  const own = new Map(rows.map((r) => [String(r._id), r.hours]));
  const total = new Map<string, number>();
  // Deepest tasks first so children are summed before their parents.
  for (const t of [...tasks].sort((a, b) => b.outlineLevel - a.outlineLevel)) {
    const id = String(t._id);
    total.set(id, (total.get(id) ?? 0) + (own.get(id) ?? 0));
    if (t.parent) total.set(String(t.parent), (total.get(String(t.parent)) ?? 0) + total.get(id)!);
  }
  return tasks.map((t) => ({ ...t, spentHours: Math.round((total.get(String(t._id)) ?? 0) * 100) / 100 }));
}

/**
 * Progress modes: "work" derives % complete from work vs remaining work, "status" from the
 * status' % done. Runs before scheduling so summaries roll the result up.
 */
async function applyProgressMode(project: ProjectDoc, tasks: PlanTask[]) {
  const parents = new Set(tasks.filter((t) => t.parent).map((t) => String(t.parent)));
  const mode = project.progressMode ?? 'manual';
  const percentDone = mode === 'status' ? new Map((await getCatalog()).statuses.map((st) => [String(st._id), st.percentDone])) : null;
  for (const t of tasks) {
    if (parents.has(String(t._id))) continue;
    if (mode === 'work' && t.work && t.work > 0 && t.remainingWork != null) {
      t.percentComplete = Math.round(((t.work - Math.min(t.remainingWork, t.work)) / t.work) * 100);
    } else if (mode === 'status' && t.status) {
      const pct = percentDone?.get(String(t.status));
      if (pct != null) t.percentComplete = pct;
    }
  }
}

/** Summary tasks total the work and remaining work of their children (null when nobody estimated). */
function rollUpWork(tasks: PlanTask[], mode: string) {
  const children = new Map<string, PlanTask[]>();
  for (const t of tasks) if (t.parent) {
    const k = String(t.parent);
    if (!children.has(k)) children.set(k, []);
    children.get(k)!.push(t);
  }
  for (const t of [...tasks].sort((a, b) => b.outlineLevel - a.outlineLevel)) {
    const kids = children.get(String(t._id));
    if (!kids?.length) continue;
    const estimated = kids.filter((k) => k.work != null);
    t.work = estimated.length ? estimated.reduce((a, k) => a + (k.work ?? 0), 0) : null;
    const withRemaining = kids.filter((k) => k.remainingWork != null);
    t.remainingWork = withRemaining.length ? withRemaining.reduce((a, k) => a + (k.remainingWork ?? 0), 0) : null;
    if (mode === 'work' && t.work && t.remainingWork != null) t.percentComplete = Math.round(((t.work - t.remainingWork) / t.work) * 100);
  }
}

/**
 * Loads the plan, lets `mutator` change it in memory, reschedules everything and persists
 * only the tasks that changed. If scheduling fails nothing is written.
 */
export async function mutatePlan(
  project: ProjectDoc,
  user: UserDoc,
  mutator: (tasks: PlanTask[]) => PlanTask[] | void = () => undefined,
): Promise<PlanResponse> {
  const original = await loadTasks(project._id);
  const before = new Map(original.map((t) => [t._id.toString(), snapshot(t)]));
  const working = mutator(original) ?? original;

  normalizeOrders(working);
  const ids = new Set(working.map((t) => t._id.toString()));
  for (const t of working) {
    // Drop links/parents that point at tasks that no longer exist.
    t.predecessors = t.predecessors.filter((l) => ids.has(l.task.toString()));
    t.relations = (t.relations ?? []).filter((r) => ids.has(r.task.toString()));
    if (t.number == null) t.number = project.taskSeq = (project.taskSeq ?? 0) + 1;
    if (t.parent && !ids.has(t.parent.toString())) t.parent = null;
  }
  await applyProgressMode(project, working);

  const out = schedule(
    { startDate: project.startDate, workingDays: project.workingDays, holidays: project.holidays },
    working.map((t) => ({
      id: t._id.toString(),
      parent: t.parent ? t.parent.toString() : null,
      order: t.order,
      name: t.name,
      duration: t.duration,
      constraintStart: t.constraintStart,
      percentComplete: t.percentComplete,
      predecessors: t.predecessors.map((l) => ({ task: l.task.toString(), type: l.type, lag: l.lag })),
      manual: t.manual,
    })),
  );

  for (const t of working) Object.assign(t, out.results.get(t._id.toString()));
  rollUpWork(working, project.progressMode ?? 'manual');

  // ---- Persist the diff -------------------------------------------------------------------
  const removed = [...before.keys()].filter((id) => !ids.has(id));
  const inserts: PlanTask[] = [];
  const updates: PlanTask[] = [];
  for (const t of working) {
    const prev = before.get(t._id.toString());
    if (prev === undefined) inserts.push(t);
    else if (prev !== snapshot(t)) updates.push({ ...t, updatedBy: user._id });
  }
  if (removed.length) await Task.deleteMany({ project: project._id, _id: { $in: removed } });
  if (inserts.length) await Task.insertMany(inserts);
  if (updates.length) {
    await Task.bulkWrite(
      updates.map((t) => ({
        updateOne: {
          filter: { _id: t._id, project: project._id },
          update: { $set: Object.fromEntries(PERSISTED_FIELDS.map((f) => [f, t[f]])) },
        },
      })),
    );
  }

  // ---- Project roll-up ------------------------------------------------------------------
  const today = todayISO();
  const leaves = working.filter((t) => !t.isSummary);
  project.finishDate = out.finishDate;
  project.stats = {
    taskCount: leaves.length,
    completedCount: leaves.filter((t) => t.percentComplete >= 100).length,
    overdueCount: leaves.filter((t) => t.percentComplete < 100 && t.finish < today).length,
    percentComplete: out.percentComplete,
  };
  project.updatedBy = user._id;
  await project.save();

  working.sort((a, b) => a.rowNumber - b.rowNumber);
  return { project: await serializeProject(project, user), tasks: await withSpentHours(project._id, working) };
}

/** Project JSON with owner/members populated and the caller's role. */
export async function serializeProject(project: ProjectDoc, user: UserDoc) {
  await project.populate([
    { path: 'owner', select: 'name email' },
    { path: 'members.user', select: 'name email kind invited' },
    { path: 'members.group', select: 'name members', populate: { path: 'members', select: 'name email kind' } },
    { path: 'parent', select: 'name key kind' },
  ]);
  const access = accessFor(project, user);
  return {
    ...project.toJSON(),
    myRole: access?.role ?? null,
    myRoleName: access?.roleName ?? '',
    myPermissions: [...(access?.permissions ?? [])],
    favorite: (user.favorites ?? []).some((f) => String(f) === String(project._id)),
  };
}
