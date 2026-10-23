import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { loadProject } from '../middleware/projectAccess';
import { Resource } from '../models/Resource';
import type { PlanTask } from '../models/Task';
import { isISODate } from '../scheduling/calendar';
import { LINK_TYPES } from '../scheduling/scheduler';
import { loadTasks, mutatePlan, serializeProject } from '../services/planService';
import { badRequest, notFound, parseBody } from '../utils/http';

/** Mounted at /api/projects/:id/tasks */
export const tasksRouter = Router({ mergeParams: true });

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
const duration = z.number().int('Duration must be whole days').min(0).max(10_000);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Task name is required').max(255),
  duration: duration.optional().default(1),
  afterTaskId: objectId.nullish(),
  constraintStart: isoDate.nullish(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Task name is required').max(255).optional(),
  duration: duration.optional(),
  constraintStart: isoDate.nullable().optional(),
  percentComplete: z.number().min(0).max(100).optional(),
  predecessors: z
    .array(z.object({ task: objectId, type: z.enum(LINK_TYPES).default('FS'), lag: z.number().int().min(-1000).max(1000).default(0) }))
    .max(100)
    .optional(),
  resources: z.array(objectId).max(50).optional(),
  notes: z.string().max(5000).optional(),
});

const moveSchema = z.object({ action: z.enum(['up', 'down', 'indent', 'outdent']) });

const sameParent = (a: PlanTask, b: PlanTask) => String(a.parent ?? '') === String(b.parent ?? '');
const siblingsOf = (tasks: PlanTask[], t: PlanTask) =>
  tasks.filter((x) => sameParent(x, t)).sort((a, b) => a.order - b.order);

function findTask(tasks: PlanTask[], id: string) {
  const task = tasks.find((t) => t._id.toString() === id);
  if (!task) throw notFound('Task');
  return task;
}

tasksRouter.get('/', loadProject('viewer'), async (req, res) => {
  res.json({ project: await serializeProject(req.project!, req.user!), tasks: await loadTasks(req.project!._id) });
});

tasksRouter.post('/', loadProject('member'), async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const project = req.project!;
  const newId = new Types.ObjectId();

  const result = await mutatePlan(project, req.user!, (tasks) => {
    let parent: Types.ObjectId | null = null;
    let order = tasks.filter((t) => !t.parent).length;
    if (body.afterTaskId) {
      const after = findTask(tasks, body.afterTaskId);
      parent = after.parent;
      order = after.order + 0.5;
    }
    tasks.push({
      _id: newId,
      project: project._id,
      parent,
      order,
      name: body.name,
      duration: body.duration,
      constraintStart: body.constraintStart ?? null,
      percentComplete: 0,
      predecessors: [],
      resources: [],
      notes: '',
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
      createdBy: req.user!._id,
      updatedBy: req.user!._id,
    });
  });
  res.status(201).json({ ...result, createdTaskId: newId.toString() });
});

tasksRouter.patch('/:taskId', loadProject('member'), async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  const project = req.project!;

  if (body.resources?.length) {
    const count = await Resource.countDocuments({ project: project._id, _id: { $in: body.resources } });
    if (count !== new Set(body.resources).size) throw badRequest('One or more resources do not belong to this project');
  }

  res.json(
    await mutatePlan(project, req.user!, (tasks) => {
      const task = findTask(tasks, String(req.params.taskId));
      if (body.name !== undefined) task.name = body.name;
      if (body.notes !== undefined) task.notes = body.notes;
      if (body.constraintStart !== undefined) task.constraintStart = body.constraintStart;
      // Summary duration and % complete are computed from their children.
      if (body.duration !== undefined && !task.isSummary) task.duration = body.duration;
      if (body.percentComplete !== undefined && !task.isSummary) task.percentComplete = Math.round(body.percentComplete);
      if (body.resources !== undefined) task.resources = [...new Set(body.resources)].map((id) => new Types.ObjectId(id));
      if (body.predecessors !== undefined) {
        const ids = new Set(tasks.map((t) => t._id.toString()));
        const seen = new Set<string>();
        task.predecessors = [];
        for (const link of body.predecessors) {
          if (!ids.has(link.task)) throw badRequest('A predecessor refers to a task that does not exist');
          if (link.task === task._id.toString()) throw badRequest('A task cannot be its own predecessor');
          if (seen.has(link.task)) continue;
          seen.add(link.task);
          task.predecessors.push({ task: new Types.ObjectId(link.task), type: link.type, lag: link.lag });
        }
      }
    }),
  );
});

tasksRouter.delete('/:taskId', loadProject('member'), async (req, res) => {
  res.json(
    await mutatePlan(req.project!, req.user!, (tasks) => {
      const root = findTask(tasks, String(req.params.taskId));
      const doomed = new Set([root._id.toString()]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of tasks) {
          if (t.parent && doomed.has(t.parent.toString()) && !doomed.has(t._id.toString())) {
            doomed.add(t._id.toString());
            grew = true;
          }
        }
      }
      return tasks.filter((t) => !doomed.has(t._id.toString()));
    }),
  );
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
