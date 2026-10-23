import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { accessFilter, loadProject, roleFor } from '../middleware/projectAccess';
import { MEMBER_ROLES, Project, PROJECT_STATUSES } from '../models/Project';
import { Resource } from '../models/Resource';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { isISODate, todayISO } from '../scheduling/calendar';
import { generateProjectKey } from '../services/catalog';
import { mutatePlan, serializeProject } from '../services/planService';
import { View } from '../models/View';
import { assertObjectId, badRequest, conflict, notFound, parseBody } from '../utils/http';

export const projectsRouter = Router();

const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120),
  description: z.string().max(2000).optional().default(''),
  startDate: isoDate,
  status: z.enum(PROJECT_STATUSES).optional().default('active'),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be 2–10 letters/digits starting with a letter')
    .optional(),
  categories: z
    .array(z.object({ _id: z.string().optional(), name: z.string().trim().min(1, 'Category name is required').max(60) }))
    .max(100)
    .optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startDate: isoDate.optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Select at least one working day').max(7).optional(),
  holidays: z.array(isoDate).max(366).optional(),
});

projectsRouter.get('/', async (req, res) => {
  const projects = await Project.find(accessFilter(req.user!))
    .populate('owner', 'name email')
    .sort({ updatedAt: -1 });

  // Overdue counts change as days pass, so compute them live.
  const overdue = await Task.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        project: { $in: projects.map((p) => p._id) },
        isSummary: false,
        percentComplete: { $lt: 100 },
        finish: { $lt: todayISO() },
      },
    },
    { $group: { _id: '$project', count: { $sum: 1 } } },
  ]);
  const overdueBy = new Map(overdue.map((o) => [o._id.toString(), o.count]));

  res.json({
    projects: projects.map((p) => {
      const json = p.toJSON();
      return {
        ...json,
        stats: { ...json.stats, overdueCount: overdueBy.get(p._id.toString()) ?? 0 },
        myRole: roleFor(p, req.user!),
      };
    }),
  });
});

projectsRouter.post('/', async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const project = await Project.create({
    ...body,
    key: await generateProjectKey(body.name),
    finishDate: body.startDate,
    owner: req.user!._id,
    createdBy: req.user!._id,
    updatedBy: req.user!._id,
  });
  res.status(201).json({ project: await serializeProject(project, req.user!) });
});

projectsRouter.get('/:id', loadProject('viewer'), async (req, res) => {
  res.json({ project: await serializeProject(req.project!, req.user!) });
});

projectsRouter.patch('/:id', loadProject('manager'), async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  const project = req.project!;
  if (body.holidays) body.holidays = [...new Set(body.holidays)].sort();
  if (body.workingDays) body.workingDays = [...new Set(body.workingDays)].sort();
  if (body.key && body.key !== project.key && (await Project.exists({ key: body.key, _id: { $ne: project._id } }))) {
    throw conflict(`The key ${body.key} is already used by another project`);
  }
  const { categories, ...rest } = body;
  project.set(rest);
  if (categories) {
    const names = categories.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) throw badRequest('Category names must be unique');
    const kept = new Set(categories.map((c) => c._id).filter(Boolean));
    const removed = project.categories.filter((c) => !kept.has(String(c._id))).map((c) => c._id);
    project.set('categories', categories.map((c) => (c._id && Types.ObjectId.isValid(c._id) ? { _id: c._id, name: c.name } : { name: c.name })));
    if (removed.length) await Task.updateMany({ project: project._id, category: { $in: removed } }, { $set: { category: null } });
  }
  res.json(await mutatePlan(project, req.user!)); // reschedule (calendar/start may have changed)
});

projectsRouter.delete('/:id', loadProject('owner'), async (req, res) => {
  const id = req.project!._id;
  await Promise.all([Task.deleteMany({ project: id }), Resource.deleteMany({ project: id }), View.deleteMany({ project: id })]);
  await req.project!.deleteOne();
  res.status(204).end();
});

// ---- Baseline -------------------------------------------------------------------------------

projectsRouter.post('/:id/baseline', loadProject('manager'), async (req, res) => {
  const project = req.project!;
  project.baselineSavedAt = new Date();
  res.json(
    await mutatePlan(project, req.user!, (tasks) => {
      for (const t of tasks) {
        t.baselineStart = t.start || null;
        t.baselineFinish = t.finish || null;
      }
    }),
  );
});

projectsRouter.delete('/:id/baseline', loadProject('manager'), async (req, res) => {
  const project = req.project!;
  project.baselineSavedAt = null;
  res.json(
    await mutatePlan(project, req.user!, (tasks) => {
      for (const t of tasks) {
        t.baselineStart = null;
        t.baselineFinish = null;
      }
    }),
  );
});

// ---- Members --------------------------------------------------------------------------------

const memberSchema = z.object({
  userId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid user'),
  role: z.enum(MEMBER_ROLES),
});

projectsRouter.post('/:id/members', loadProject('manager'), async (req, res) => {
  const body = parseBody(memberSchema, req.body);
  const project = req.project!;
  const user = await User.findById(body.userId);
  if (!user || !user.isActive) throw notFound('User');
  if (project.owner.toString() === body.userId) throw badRequest('The owner already has full access');
  if (project.members.some((m) => m.user.toString() === body.userId)) throw conflict(`${user.name} is already a member`);
  project.members.push({ user: user._id, role: body.role });
  await project.save();
  res.status(201).json({ project: await serializeProject(project, req.user!) });
});

projectsRouter.patch('/:id/members/:userId', loadProject('manager'), async (req, res) => {
  const { role } = parseBody(memberSchema.pick({ role: true }), req.body);
  const project = req.project!;
  const member = project.members.find((m) => m.user.toString() === assertObjectId(req.params.userId, 'Member'));
  if (!member) throw notFound('Member');
  member.role = role;
  await project.save();
  res.json({ project: await serializeProject(project, req.user!) });
});

projectsRouter.delete('/:id/members/:userId', loadProject('manager'), async (req, res) => {
  const project = req.project!;
  const userId = assertObjectId(req.params.userId, 'Member');
  const before = project.members.length;
  project.members.pull({ user: userId });
  if (project.members.length === before) throw notFound('Member');
  await project.save();
  res.json({ project: await serializeProject(project, req.user!) });
});
