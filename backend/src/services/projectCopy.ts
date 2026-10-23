import { Types } from 'mongoose';
import type { ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import type { PlanTask } from '../models/Task';
import type { UserDoc } from '../models/User';
import { View } from '../models/View';
import { addDays, parseISODate } from '../scheduling/calendar';
import { loadTasks, mutatePlan } from './planService';

export interface CopyOptions {
  tasks: boolean;
  resources: boolean;
  members: boolean;
  views: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Copies settings and (optionally) tasks, resources, members and shared views from `source` into the
 * freshly created `target`. Task dates are re-planned from the target's start date: fixed dates
 * (Start-No-Earlier-Than / manual) move by the same number of days as the project start.
 */
export async function copyProjectContent(source: ProjectDoc, target: ProjectDoc, user: UserDoc, opts: CopyOptions) {
  const shift = Math.round((parseISODate(target.startDate) - parseISODate(source.startDate)) / DAY_MS);
  const moveDate = (d: string | null) => (d ? addDays(d, shift) : null);

  target.set({
    workingDays: source.workingDays,
    holidays: source.holidays.map((h) => addDays(h, shift)),
    categories: source.categories.map((c) => ({ _id: c._id, name: c.name })),
    disabledModules: source.disabledModules,
    customValues: source.customValues ?? {},
    lifecycle: source.lifecycle.map((p) => ({ definition: p.definition, start: moveDate(p.start ?? null), finish: moveDate(p.finish ?? null), gateStatus: 'pending' })),
  });
  if (opts.members) {
    const ownerId = String(target.owner);
    const members = source.members.filter((m) => String(m.user) !== ownerId).map((m) => ({ user: m.user, role: m.role }));
    // The source owner joins as a manager so they keep access to the copy.
    if (String(source.owner) !== ownerId && !members.some((m) => String(m.user) === String(source.owner))) {
      members.push({ user: source.owner, role: 'manager' });
    }
    target.set('members', members);
  }
  await target.save();

  const resourceMap = new Map<string, Types.ObjectId>();
  if (opts.resources) {
    const resources = await Resource.find({ project: source._id }).lean();
    for (const r of resources) {
      const copy = await Resource.create({ project: target._id, name: r.name, title: r.title, email: r.email, user: r.user });
      resourceMap.set(String(r._id), copy._id);
    }
  }

  if (opts.views) {
    const views = await View.find({ project: source._id, isPublic: true }).lean();
    if (views.length) await View.insertMany(views.map((v) => ({ project: target._id, owner: user._id, name: v.name, kind: v.kind, isPublic: true, config: v.config })));
  }

  if (!opts.tasks) return mutatePlan(target, user);

  const sourceTasks = await loadTasks(source._id);
  const idMap = new Map(sourceTasks.map((t) => [String(t._id), new Types.ObjectId()]));
  const people = new Set([String(target.owner), ...target.members.map((m) => String(m.user))]);
  const keepPerson = (id: Types.ObjectId | null) => (id && people.has(String(id)) ? id : null);

  const copies: PlanTask[] = sourceTasks.map((t) => ({
    ...t,
    _id: idMap.get(String(t._id))!,
    project: target._id,
    parent: t.parent ? idMap.get(String(t.parent)) ?? null : null,
    number: null,
    constraintStart: moveDate(t.constraintStart),
    predecessors: t.predecessors.map((l) => ({ ...l, task: idMap.get(String(l.task))! })).filter((l) => l.task),
    relations: (t.relations ?? []).map((r) => ({ ...r, task: idMap.get(String(r.task))! })).filter((r) => r.task),
    resources: t.resources.map((r) => resourceMap.get(String(r))).filter((r): r is Types.ObjectId => !!r),
    assignee: keepPerson(t.assignee),
    accountable: keepPerson(t.accountable),
    watchers: [user._id],
    baselineStart: null,
    baselineFinish: null,
    createdBy: user._id,
    updatedBy: user._id,
    createdAt: undefined,
    updatedAt: undefined,
  }));

  return mutatePlan(target, user, (tasks) => {
    tasks.push(...copies);
  });
}
