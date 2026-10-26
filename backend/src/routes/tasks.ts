import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { loadProject } from '../middleware/projectAccess';
import { can, projectPeopleIds } from '../services/permissions';
import { PRIORITIES } from '../models/Catalog';
import { Budget } from '../models/Finance';
import { Project, type ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import { RELATION_TYPES, type PlanTask } from '../models/Task';
import { User } from '../models/User';
import { isISODate } from '../scheduling/calendar';
import { LINK_TYPES } from '../scheduling/scheduler';
import type { ProjectRole } from '../models/Project';
import { recordTaskCreated, recordTaskDeleted, recordTaskUpdated } from '../services/activity';
import { cleanCustomValues, getCatalog, isTransitionAllowed, type Catalog } from '../services/catalog';
import { loadTasks, mutatePlan, serializeProject, withSpentHours } from '../services/planService';
import { assertObjectId, badRequest, forbidden, notFound, parseBody } from '../utils/http';
import { sanitizeRichText } from '../utils/richText';

/** Mounted at /api/projects/:id/tasks */
export const tasksRouter = Router({ mergeParams: true });

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
const duration = z.number().int('Duration must be whole days').min(0).max(10_000);

/** Fields that can be set on one task or in bulk. */
const attributeSchema = z.object({
  type: objectId.optional(),
  status: objectId.optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: objectId.nullable().optional(),
  accountable: objectId.nullable().optional(),
  category: objectId.nullable().optional(),
  percentComplete: z.number().min(0).max(100).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  budget: objectId.nullable().optional(),
  /** Hours. */
  work: z.number().min(0).max(100_000).nullable().optional(),
  remainingWork: z.number().min(0).max(100_000).nullable().optional(),
});

const createSchema = attributeSchema.extend({
  name: z.string().trim().min(1, 'Task name is required').max(255),
  duration: duration.optional().default(1),
  afterTaskId: objectId.nullish(),
  constraintStart: isoDate.nullish(),
});

const updateSchema = attributeSchema.extend({
  name: z.string().trim().min(1, 'Task name is required').max(255).optional(),
  duration: duration.optional(),
  constraintStart: isoDate.nullable().optional(),
  manual: z.boolean().optional(),
  predecessors: z
    .array(z.object({ task: objectId, type: z.enum(LINK_TYPES).default('FS'), lag: z.number().int().min(-1000).max(1000).default(0) }))
    .max(100)
    .optional(),
  relations: z.array(z.object({ task: objectId, type: z.enum(RELATION_TYPES).default('relates') })).max(100).optional(),
  resources: z.array(objectId).max(50).optional(),
  notes: z.string().max(20000).transform(sanitizeRichText).optional(),
});

const idsSchema = z.array(objectId).min(1, 'Select at least one task').max(1000);
const bulkSchema = z.object({ taskIds: idsSchema, patch: attributeSchema });
const transferSchema = z.object({ taskIds: idsSchema, targetProjectId: objectId, mode: z.enum(['copy', 'move']) });
const moveSchema = z.object({ action: z.enum(['up', 'down', 'indent', 'outdent']) });

const sameParent = (a: PlanTask, b: PlanTask) => String(a.parent ?? '') === String(b.parent ?? '');
const siblingsOf = (tasks: PlanTask[], t: PlanTask) => tasks.filter((x) => sameParent(x, t)).sort((a, b) => a.order - b.order);
const oid = (v: string) => new Types.ObjectId(v);

/** Copy of a task for "before" history snapshots; ObjectIds are immutable so they can be shared. */
const snapshotTask = (t: PlanTask): PlanTask => ({
  ...t,
  predecessors: t.predecessors.map((l) => ({ ...l })),
  relations: (t.relations ?? []).map((r) => ({ ...r })),
  resources: [...t.resources],
  watchers: [...(t.watchers ?? [])],
  customValues: { ...(t.customValues ?? {}) },
});

function findTask(tasks: PlanTask[], id: string) {
  const task = tasks.find((t) => t._id.toString() === id);
  if (!task) throw notFound('Task');
  return task;
}

/** The given tasks plus all of their descendants. */
function withDescendants(tasks: PlanTask[], ids: Iterable<string>): Set<string> {
  const set = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) {
      if (t.parent && set.has(t.parent.toString()) && !set.has(t._id.toString())) {
        set.add(t._id.toString());
        grew = true;
      }
    }
  }
  return set;
}

/** Validates attribute ids against the catalog and project; returns a function applying them to a task. */
async function prepareAttributes(project: ProjectDoc, patch: z.infer<typeof attributeSchema>, catalog: Catalog, role: ProjectRole) {
  if (patch.type && !catalog.types.some((t) => String(t._id) === patch.type)) throw badRequest('Unknown task type');
  if (patch.status && !catalog.statuses.some((s) => String(s._id) === patch.status)) throw badRequest('Unknown status');
  if (patch.category && !project.categories.some((c) => String(c._id) === patch.category)) throw badRequest('Unknown category for this project');
  if (patch.budget && !(await Budget.exists({ _id: patch.budget, project: project._id }))) throw badRequest('Unknown budget for this project');
  const people = await projectPeopleIds(project);
  for (const field of ['assignee', 'accountable'] as const) {
    const userId = patch[field];
    if (!userId) continue;
    const user = await User.findById(userId);
    if (!user || !user.isActive || !people.has(userId)) {
      throw badRequest(`The ${field} must be a member of this project`);
    }
  }
  const closed = new Set(catalog.statuses.filter((s) => s.isClosed).map((s) => String(s._id)));

  const statusName = (id: unknown) => catalog.statuses.find((s) => String(s._id) === String(id))?.name ?? 'none';

  return (task: PlanTask) => {
    if (patch.type !== undefined) task.type = oid(patch.type);
    if (patch.budget !== undefined) task.budget = patch.budget ? oid(patch.budget) : null;
    if (!task.isSummary) {
      if (patch.work !== undefined) {
        // A first estimate also sets "remaining" unless that is given too.
        if (patch.remainingWork === undefined && (task.remainingWork == null || task.work == null)) task.remainingWork = patch.work;
        task.work = patch.work;
      }
      if (patch.remainingWork !== undefined) task.remainingWork = patch.remainingWork;
      if (task.work != null && task.remainingWork != null && task.remainingWork > task.work) task.remainingWork = task.work;
    }
    if (patch.customValues !== undefined) {
      task.customValues = cleanCustomValues(catalog, 'task', patch.customValues, task.customValues ?? {}, (id) => people.has(id));
    }
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.assignee !== undefined) {
      task.assignee = patch.assignee ? oid(patch.assignee) : null;
      // Assignees watch their tasks automatically.
      if (task.assignee && !(task.watchers ?? []).some((w) => String(w) === String(task.assignee))) task.watchers = [...(task.watchers ?? []), task.assignee];
    }
    if (patch.accountable !== undefined) task.accountable = patch.accountable ? oid(patch.accountable) : null;
    if (patch.category !== undefined) task.category = patch.category ? oid(patch.category) : null;
    if (patch.percentComplete !== undefined && !task.isSummary) task.percentComplete = Math.round(patch.percentComplete);
    if (patch.status !== undefined) {
      const from = task.status ? String(task.status) : null;
      if (!isTransitionAllowed(catalog.workflow, role, from, patch.status)) {
        throw badRequest(`Your role may not move "${task.name}" from ${statusName(from)} to ${statusName(patch.status)} (workflow rules)`);
      }
      const changed = String(task.status ?? '') !== patch.status;
      task.status = oid(patch.status);
      // Closing a task marks it as done.
      if (changed && closed.has(patch.status) && !task.isSummary) task.percentComplete = 100;
    }
  };
}


export function newTask(project: ProjectDoc, userId: Types.ObjectId, fields: Partial<PlanTask> & Pick<PlanTask, 'name' | 'duration' | 'type' | 'status'>): PlanTask {
  return {
    _id: new Types.ObjectId(),
    project: project._id,
    parent: null,
    order: Number.MAX_SAFE_INTEGER,
    constraintStart: null,
    percentComplete: 0,
    predecessors: [],
    resources: [],
    notes: '',
    priority: 'normal',
    assignee: null,
    accountable: null,
    category: null,
    watchers: [],
    number: null,
    manual: false,
    relations: [],
    work: null,
    remainingWork: null,
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
    createdBy: userId,
    updatedBy: userId,
    ...fields,
    customValues: fields.customValues ?? {},
  };
}

// ---- Routes -----------------------------------------------------------------------------------

tasksRouter.get('/', loadProject('viewer'), async (req, res) => {
  res.json({ project: await serializeProject(req.project!, req.user!), tasks: await withSpentHours(req.project!._id, await loadTasks(req.project!._id)) });
});

tasksRouter.post('/', loadProject('member'), async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const project = req.project!;
  const catalog = await getCatalog();
  const apply = await prepareAttributes(project, body, catalog, 'owner');
  const task = newTask(project, req.user!._id, {
    watchers: [req.user!._id],
    name: body.name,
    duration: body.duration,
    constraintStart: body.constraintStart ?? null,
    type: body.type ? oid(body.type) : body.duration === 0 ? catalog.milestoneType._id : catalog.defaultType._id,
    status: catalog.defaultStatus._id,
  });
  apply(task);

  const result = await mutatePlan(project, req.user!, (tasks) => {
    if (body.afterTaskId) {
      const after = findTask(tasks, body.afterTaskId);
      task.parent = after.parent;
      task.order = after.order + 0.5;
    }
    tasks.push(task);
  });
  const created = result.tasks.find((t) => String(t._id) === String(task._id));
  if (created) await recordTaskCreated(project, req.user!, created);
  res.status(201).json({ ...result, createdTaskId: task._id.toString() });
});

tasksRouter.patch('/:taskId', loadProject('member'), async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  const project = req.project!;
  const apply = await prepareAttributes(project, body, await getCatalog(), req.projectRole!);
  let before: PlanTask | null = null;

  if (body.resources?.length) {
    const count = await Resource.countDocuments({ project: project._id, _id: { $in: body.resources } });
    if (count !== new Set(body.resources).size) throw badRequest('One or more resources do not belong to this project');
  }

  const result = await mutatePlan(project, req.user!, (tasks) => {
      const task = findTask(tasks, String(req.params.taskId));
      before = snapshotTask(task);
      const ids = new Set(tasks.map((t) => t._id.toString()));
      const self = task._id.toString();
      if (body.name !== undefined) task.name = body.name;
      if (body.notes !== undefined) task.notes = body.notes;
      if (body.constraintStart !== undefined) task.constraintStart = body.constraintStart;
      if (body.manual !== undefined) task.manual = body.manual;
      if (task.manual && !task.constraintStart) task.constraintStart = task.start || project.startDate;
      // Summary duration and % complete are computed from their children.
      if (body.duration !== undefined && !task.isSummary) task.duration = body.duration;
      if (body.resources !== undefined) task.resources = [...new Set(body.resources)].map(oid);
      apply(task);

      if (body.predecessors !== undefined) {
        const seen = new Set<string>();
        task.predecessors = [];
        for (const link of body.predecessors) {
          if (!ids.has(link.task)) throw badRequest('A predecessor refers to a task that does not exist');
          if (link.task === self) throw badRequest('A task cannot be its own predecessor');
          if (seen.has(link.task)) continue;
          seen.add(link.task);
          task.predecessors.push({ task: oid(link.task), type: link.type, lag: link.lag });
        }
      }
      if (body.relations !== undefined) {
        const seen = new Set<string>();
        task.relations = [];
        for (const rel of body.relations) {
          if (!ids.has(rel.task)) throw badRequest('A related task does not exist in this project');
          if (rel.task === self) throw badRequest('A task cannot be related to itself');
          if (seen.has(rel.task)) continue;
          seen.add(rel.task);
          task.relations.push({ task: oid(rel.task), type: rel.type });
        }
      }
    });
  const after = result.tasks.find((t) => String(t._id) === String(req.params.taskId));
  if (before && after) await recordTaskUpdated(project, req.user!, before, after, result.tasks);
  res.json(result);
});

tasksRouter.post('/bulk', loadProject('member'), async (req, res) => {
  const body = parseBody(bulkSchema, req.body);
  const apply = await prepareAttributes(req.project!, body.patch, await getCatalog(), req.projectRole!);
  const befores = new Map<string, PlanTask>();
  const result = await mutatePlan(req.project!, req.user!, (tasks) => {
    const ids = new Set(body.taskIds);
    for (const t of tasks) {
      if (!ids.has(t._id.toString())) continue;
      befores.set(t._id.toString(), snapshotTask(t));
      apply(t);
    }
  });
  for (const after of result.tasks) {
    const before = befores.get(String(after._id));
    if (before) await recordTaskUpdated(req.project!, req.user!, before, after, result.tasks);
  }
  res.json(result);
});

tasksRouter.post('/bulk-delete', loadProject('member'), async (req, res) => {
  const { taskIds } = parseBody(z.object({ taskIds: idsSchema }), req.body);
  let removed: PlanTask[] = [];
  const result = await mutatePlan(req.project!, req.user!, (tasks) => {
    const doomed = withDescendants(tasks, taskIds);
    removed = tasks.filter((t) => doomed.has(t._id.toString()));
    return tasks.filter((t) => !doomed.has(t._id.toString()));
  });
  for (const t of removed) await recordTaskDeleted(req.project!, req.user!, t);
  res.json(result);
});

/** Copies or moves tasks (with their sub-tasks) to this or another project. */
tasksRouter.post('/transfer', loadProject('member'), async (req, res) => {
  const body = parseBody(transferSchema, req.body);
  const source = req.project!;
  const sameProject = body.targetProjectId === source._id.toString();
  if (sameProject && body.mode === 'move') throw badRequest('Tasks are already in this project');

  const target = sameProject ? source : await Project.findById(assertObjectId(body.targetProjectId, 'Project'));
  if (!target) throw notFound('Target project');
  if (!can(target, req.user!, 'view_project')) throw notFound('Target project');
  if (!can(target, req.user!, 'edit_tasks')) throw forbidden('You need permission to edit tasks in the target project');
  if (target.status === 'archived') throw forbidden('The target project is archived');
  const targetPeople = await projectPeopleIds(target);

  const sourceTasks = await loadTasks(source._id);
  for (const id of body.taskIds) findTask(sourceTasks, id);
  const selected = withDescendants(sourceTasks, body.taskIds);
  const picked = sourceTasks.filter((t) => selected.has(t._id.toString())).sort((a, b) => a.rowNumber - b.rowNumber);

  const idMap = new Map(picked.map((t) => [t._id.toString(), new Types.ObjectId()]));
  const remap = (id: Types.ObjectId | null) => (id ? idMap.get(id.toString()) ?? null : null);
  const keepPerson = (id: Types.ObjectId | null) => (id && (sameProject || targetPeople.has(id.toString())) ? id : null);

  const copies = picked.map((t, i) => {
    const isRoot = !t.parent || !selected.has(t.parent.toString());
    return newTask(target, req.user!._id, {
      ...t,
      _id: idMap.get(t._id.toString())!,
      project: target._id,
      parent: remap(t.parent),
      order: isRoot ? Number.MAX_SAFE_INTEGER - picked.length + i : t.order,
      name: sameProject && isRoot ? `${t.name} (copy)` : t.name,
      number: null,
      predecessors: t.predecessors.filter((l) => idMap.has(l.task.toString())).map((l) => ({ ...l, task: remap(l.task)! })),
      relations: (t.relations ?? []).filter((r) => idMap.has(r.task.toString())).map((r) => ({ ...r, task: remap(r.task)! })),
      resources: sameProject ? t.resources : [],
      category: sameProject ? t.category : null,
      assignee: keepPerson(t.assignee),
      accountable: keepPerson(t.accountable),
      watchers: [],
      baselineStart: sameProject ? t.baselineStart : null,
      baselineFinish: sameProject ? t.baselineFinish : null,
      createdAt: undefined,
      updatedAt: undefined,
      createdBy: req.user!._id,
    });
  });

  const targetPlan = await mutatePlan(target, req.user!, (tasks) => {
    tasks.push(...copies);
  });
  const sourcePlan =
    body.mode === 'move'
      ? await mutatePlan(source, req.user!, (tasks) => tasks.filter((t) => !selected.has(t._id.toString())))
      : sameProject
        ? targetPlan
        : { project: await serializeProject(source, req.user!), tasks: await loadTasks(source._id) };

  for (const copy of copies) {
    const original = picked.find((t) => idMap.get(t._id.toString())?.equals(copy._id));
    const note = sameProject ? `Copied from "${original?.name}"` : `${body.mode === 'move' ? 'Moved' : 'Copied'} from project ${source.name}`;
    await recordTaskCreated(target, req.user!, copy, note);
  }
  if (body.mode === 'move') for (const t of picked) await recordTaskDeleted(source, req.user!, t, `Moved to project ${target.name}`);
  res.json({ ...sourcePlan, transferred: copies.length });
});

tasksRouter.delete('/:taskId', loadProject('member'), async (req, res) => {
  let removed: PlanTask[] = [];
  const result = await mutatePlan(req.project!, req.user!, (tasks) => {
    findTask(tasks, String(req.params.taskId));
    const doomed = withDescendants(tasks, [String(req.params.taskId)]);
    removed = tasks.filter((t) => doomed.has(t._id.toString()));
    return tasks.filter((t) => !doomed.has(t._id.toString()));
  });
  for (const t of removed) await recordTaskDeleted(req.project!, req.user!, t);
  res.json(result);
});

tasksRouter.post('/:taskId/move', loadProject('member'), async (req, res) => {
  const { action } = parseBody(moveSchema, req.body);
  res.json(
    await mutatePlan(req.project!, req.user!, (tasks) => {
      const task = findTask(tasks, String(req.params.taskId));
      const siblings = siblingsOf(tasks, task);
      const index = siblings.indexOf(task);

      if (action === 'up' || action === 'down') {
        const other = siblings[action === 'up' ? index - 1 : index + 1];
        if (!other) return;
        [task.order, other.order] = [other.order, task.order];
      } else if (action === 'indent') {
        const newParent = siblings[index - 1];
        if (!newParent) throw badRequest('There is no task above at the same level to indent under');
        task.parent = newParent._id;
        task.order = Number.MAX_SAFE_INTEGER; // last child; normalized afterwards
      } else {
        if (!task.parent) throw badRequest('This task is already at the top level');
        const parent = findTask(tasks, task.parent.toString());
        task.parent = parent.parent;
        task.order = parent.order + 0.5; // directly below its old summary
      }
    }),
  );
});
