import { Types } from 'mongoose';
import { z } from 'zod';
import { Project, type ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import type { PlanTask } from '../models/Task';
import { User, type UserDoc } from '../models/User';
import { isISODate } from '../scheduling/calendar';
import { LINK_TYPES } from '../scheduling/scheduler';
import { generateProjectKey, getCatalog } from './catalog';
import { projectPeopleIds } from './permissions';
import { loadTasks, mutatePlan } from './planService';
import { badRequest } from '../utils/http';

export const MAX_IMPORT_ROWS = 2000;

/** One task row of an imported plan (from MS Project XML or a spreadsheet), before ids exist. */
export const importRowSchema = z.object({
  /** Row identifier used by predecessor references (MS Project UID, spreadsheet ID column or row number). */
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(255),
  /** 1 = top level. */
  level: z.number().int().min(1).max(20).default(1),
  /** Working days; 0 = milestone. Ignored for summary rows. */
  duration: z.number().min(0).max(5000).default(1),
  start: z.string().refine(isISODate, 'Start must be YYYY-MM-DD').nullish(),
  percentComplete: z.number().min(0).max(100).default(0),
  milestone: z.boolean().default(false),
  /** Manually scheduled: stays on `start`. */
  manual: z.boolean().default(false),
  notes: z.string().max(5000).default(''),
  /** Hours */
  work: z.number().min(0).max(1e6).nullish(),
  predecessors: z
    .array(z.object({ key: z.string().trim().min(1).max(40), type: z.enum(LINK_TYPES).default('FS'), lag: z.number().min(-1000).max(1000).default(0) }))
    .max(50)
    .default([]),
  resources: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  /** Person's name or email; matched against the project's people. */
  assignee: z.string().trim().max(200).nullish(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export interface ImportSummary {
  projectId: string;
  projectName: string;
  createdProject: boolean;
  tasks: number;
  summaries: number;
  milestones: number;
  links: number;
  resourcesCreated: number;
  assigned: number;
  warnings: string[];
}

/** New project for an imported plan (same rules as POST /projects). */
export async function createProjectForImport(user: UserDoc, input: { name: string; startDate: string; parent?: string | null; description?: string }) {
  return Project.create({
    name: input.name,
    description: input.description ?? '',
    startDate: input.startDate,
    parent: input.parent ?? null,
    key: await generateProjectKey(input.name),
    finishDate: input.startDate,
    owner: user._id,
    createdBy: user._id,
    updatedBy: user._id,
  });
}

/**
 * Appends the rows to the project as tasks (hierarchy from levels, links, resources, assignees,
 * estimates), then reschedules once. Nothing is written if scheduling fails (e.g. a link cycle).
 */
export async function importRows(project: ProjectDoc, user: UserDoc, rows: ImportRow[], options: { matchPeople: boolean; createResources: boolean }): Promise<Omit<ImportSummary, 'projectId' | 'projectName' | 'createdProject'>> {
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.length < 100 && warnings.push(msg);
  if (!rows.length) throw badRequest('The file has no tasks');

  // Keys must be unique so links resolve to one task.
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) warn(`Row "${r.name}": duplicate ID ${r.key}; links to it use the first row`);
    seen.add(r.key);
  }

  const catalog = await getCatalog();

  // People in the project, matched by email or (case-insensitive) name.
  const peopleIds = await projectPeopleIds(project);
  const people = await User.find({ _id: { $in: [...peopleIds] } }).select('name email').lean();
  const personByKey = new Map<string, Types.ObjectId>();
  for (const p of people) {
    personByKey.set(p.name.trim().toLowerCase(), p._id);
    if (p.email) personByKey.set(p.email.toLowerCase(), p._id);
  }

  // Resources: reuse by name, create the missing ones.
  const resourceIds = new Map<string, Types.ObjectId>();
  for (const r of await Resource.find({ project: project._id }).select('name').lean()) resourceIds.set(r.name.trim().toLowerCase(), r._id);
  let resourcesCreated = 0;
  const wanted = [...new Set(rows.flatMap((r) => r.resources.map((n) => n.trim())))];
  for (const name of wanted) {
    if (resourceIds.has(name.toLowerCase())) continue;
    if (!options.createResources) {
      warn(`Resource "${name}" does not exist in the project and was skipped`);
      continue;
    }
    const doc = await Resource.create({ project: project._id, name, user: personByKey.get(name.toLowerCase()) ?? null });
    resourceIds.set(name.toLowerCase(), doc._id);
    resourcesCreated++;
  }

  const existing = await loadTasks(project._id);
  const topOrder = existing.filter((t) => !t.parent).length;
  const idByKey = new Map<string, Types.ObjectId>();
  const created: PlanTask[] = [];
  // stack[i] = last task seen at level i+1 (its children come next)
  const stack: PlanTask[] = [];
  const childCount = new Map<string, number>();
  const parentKeys = new Set<string>();
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    if (next && next.level > r.level) parentKeys.add(r.key);
  });

  let assigned = 0;
  let milestones = 0;
  const unmatched = new Set<string>();
  for (const r of rows) {
    let level = r.level;
    if (level > stack.length + 1) {
      warn(`Row "${r.name}": outline level ${level} skips a level; placed at level ${stack.length + 1}`);
      level = stack.length + 1;
    }
    stack.length = level - 1;
    const parent = stack[level - 2] ?? null;
    const parentKey = parent ? String(parent._id) : '';
    const order = parent ? (childCount.get(parentKey) ?? 0) : topOrder + (childCount.get('') ?? 0);
    childCount.set(parentKey, (childCount.get(parentKey) ?? 0) + 1);

    const isParent = parentKeys.has(r.key);
    const milestone = !isParent && (r.milestone || r.duration === 0);
    const pinned = !isParent && r.manual && !!r.start;
    if (milestone) milestones++;
    let assignee: Types.ObjectId | null = null;
    if (r.assignee && options.matchPeople) {
      assignee = personByKey.get(r.assignee.trim().toLowerCase()) ?? null;
      if (assignee) assigned++;
      else unmatched.add(r.assignee.trim());
    }
    const id = new Types.ObjectId();
    if (!idByKey.has(r.key)) idByKey.set(r.key, id);
    const work = r.work ?? null;
    const task: PlanTask = {
      _id: id,
      project: project._id,
      parent: parent ? parent._id : null,
      order,
      name: r.name,
      duration: milestone ? 0 : Math.max(1, Math.round(r.duration)),
      // Manual tasks are pinned to their start; unlinked leaf tasks keep it as "start no earlier than".
      constraintStart: pinned ? r.start! : !isParent && r.start && r.predecessors.length === 0 && r.start > project.startDate ? r.start : null,
      percentComplete: Math.round(r.percentComplete),
      predecessors: [],
      resources: r.resources.map((n) => resourceIds.get(n.toLowerCase())).filter((x): x is Types.ObjectId => !!x),
      notes: r.notes,
      type: milestone ? catalog.milestoneType._id : catalog.defaultType._id,
      status: catalog.defaultStatus._id,
      priority: 'normal',
      assignee,
      accountable: null,
      category: null,
      watchers: assignee ? [assignee, user._id] : [user._id],
      number: null,
      manual: pinned,
      relations: [],
      customValues: {},
      work: !isParent && work != null ? work : null,
      remainingWork: !isParent && work != null ? Math.round(work * (1 - r.percentComplete / 100) * 100) / 100 : null,
      budget: null,
      baselineStart: null,
      baselineFinish: null,
      start: '',
      finish: '',
      isSummary: false,
      isMilestone: false,
      isCritical: false,
      totalSlack: 0,
      wbs: '',
      outlineLevel: 0,
      rowNumber: 0,
      createdBy: user._id,
      updatedBy: user._id,
    } as PlanTask;
    created.push(task);
    stack[level - 1] = task;
  }

  if (unmatched.size) {
    const list = [...unmatched];
    warn(`Not project members, so their tasks were left unassigned: ${list.slice(0, 10).join(', ')}${list.length > 10 ? ` and ${list.length - 10} more` : ''}. Add them to the project and assign the tasks.`);
  }

  // Links (after every row has an id).
  let links = 0;
  rows.forEach((r, i) => {
    const task = created[i];
    for (const p of r.predecessors) {
      const pred = idByKey.get(p.key);
      if (!pred) {
        warn(`Row "${r.name}": predecessor ${p.key} was not found`);
        continue;
      }
      if (pred.equals(task._id)) continue;
      if (task.predecessors.some((l) => l.task.equals(pred))) continue;
      task.predecessors.push({ task: pred, type: p.type, lag: Math.round(p.lag) });
      links++;
    }
  });

  try {
    await mutatePlan(project, user, (tasks) => {
      tasks.push(...created);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw badRequest(`The plan could not be scheduled: ${message}`);
  }

  return {
    tasks: created.length,
    summaries: parentKeys.size,
    milestones,
    links,
    resourcesCreated,
    assigned,
    warnings,
  };
}
