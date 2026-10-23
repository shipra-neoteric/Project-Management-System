import type { Types } from 'mongoose';
import type { ProjectDoc } from '../models/Project';
import { Task, type PlanTask } from '../models/Task';
import type { UserDoc } from '../models/User';
import { roleFor } from '../middleware/projectAccess';
import { todayISO } from '../scheduling/calendar';
import { schedule } from '../scheduling/scheduler';

/** Fields persisted for each task (everything except identity/audit timestamps). */
const PERSISTED_FIELDS = [
  'parent', 'order', 'name', 'duration', 'constraintStart', 'percentComplete', 'predecessors', 'resources', 'notes',
  'baselineStart', 'baselineFinish', 'start', 'finish', 'isSummary', 'isMilestone', 'isCritical', 'totalSlack', 'wbs',
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
  tasks: PlanTask[];
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
    if (t.parent && !ids.has(t.parent.toString())) t.parent = null;
  }

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
    })),
  );

  for (const t of working) Object.assign(t, out.results.get(t._id.toString()));

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
  return { project: await serializeProject(project, user), tasks: working };
}

/** Project JSON with owner/members populated and the caller's role. */
export async function serializeProject(project: ProjectDoc, user: UserDoc) {
  await project.populate([
    { path: 'owner', select: 'name email' },
    { path: 'members.user', select: 'name email' },
  ]);
  return { ...project.toJSON(), myRole: roleFor(project, user) };
}
