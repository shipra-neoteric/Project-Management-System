import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { accessFilter, loadProject } from '../middleware/projectAccess';
import { Group } from '../models/Access';
import { accessFor, can, hasGlobal, projectPeopleIds, roleInfo } from '../services/permissions';
import { Baseline } from '../models/Baseline';
import { Budget, CostEntry, HourlyRate, TimeEntry } from '../models/Finance';
import { Journal } from '../models/Journal';
import { Notification } from '../models/Notification';
import { PROGRESS_MODES, Project, PROJECT_KINDS, PROJECT_MODULES, PROJECT_STATUSES, type ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { View } from '../models/View';
import { addDays, isISODate, todayISO } from '../scheduling/calendar';
import { cleanCustomValues, generateProjectKey, getCatalog } from '../services/catalog';
import { loadTasks, mutatePlan, serializeProject } from '../services/planService';
import { copyProjectContent } from '../services/projectCopy';
import { assertObjectId, badRequest, conflict, forbidden, notFound, parseBody } from '../utils/http';
import { deleteAttachmentFiles } from './attachments';
import { journalsFor } from './taskActivity';

export const projectsRouter = Router();

const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');

const copyOptionsSchema = z
  .object({ tasks: z.boolean().default(true), resources: z.boolean().default(true), members: z.boolean().default(false), views: z.boolean().default(true) })
  .default({ tasks: true, resources: true, members: false, views: true });

const createSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120),
  description: z.string().max(2000).optional().default(''),
  startDate: isoDate,
  status: z.enum(PROJECT_STATUSES).optional().default('active'),
  kind: z.enum(PROJECT_KINDS).optional().default('project'),
  parent: objectId.nullish(),
  isTemplate: z.boolean().optional().default(false),
  /** Create from a template (or copy of any project you can see). */
  fromProject: objectId.nullish(),
  copy: copyOptionsSchema,
  customValues: z.record(z.string(), z.unknown()).optional(),
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
  kind: z.enum(PROJECT_KINDS).optional(),
  parent: objectId.nullable().optional(),
  isTemplate: z.boolean().optional(),
  disabledModules: z.array(z.enum(PROJECT_MODULES)).max(PROJECT_MODULES.length).optional(),
  lifecycle: z
    .array(
      z.object({
        definition: objectId,
        start: isoDate.nullable().optional(),
        finish: isoDate.nullable().optional(),
        gateStatus: z.enum(['pending', 'passed', 'failed']).default('pending'),
      }),
    )
    .max(30)
    .optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  progressMode: z.enum(PROGRESS_MODES).optional(),
});

/** Parent must be visible with the "add sub-projects" permission, and must not create a cycle. */
async function assertValidParent(parentId: string, user: Parameters<typeof accessFor>[1], selfId?: Types.ObjectId) {
  const parent = await Project.findById(parentId);
  if (!parent) throw notFound('Parent project');
  if (!accessFor(parent, user)) throw notFound('Parent project');
  if (!can(parent, user, 'add_subprojects')) throw forbidden('You need permission to add sub-projects to the parent project');
  if (selfId) {
    let cursor: ProjectDoc | null = parent;
    for (let i = 0; cursor && i < 50; i++) {
      if (cursor._id.equals(selfId)) throw badRequest('A project cannot be placed inside itself or its own sub-projects');
      cursor = cursor.parent ? await Project.findById(cursor.parent) : null;
    }
  }
  return parent;
}

interface Rollup {
  taskCount: number;
  completedCount: number;
  overdueCount: number;
  percentComplete: number;
  startDate: string | null;
  finishDate: string | null;
  projectCount: number;
}

/** Aggregates stats of a container's visible descendant projects (programs/portfolios). */
function rollups(projects: { _id: Types.ObjectId; parent?: Types.ObjectId | null; kind?: string; startDate: string; finishDate: string; stats: { taskCount: number; completedCount: number; overdueCount: number; percentComplete: number } }[]) {
  const children = new Map<string, typeof projects>();
  for (const p of projects) {
    const key = p.parent ? String(p.parent) : '';
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(p);
  }
  const memo = new Map<string, Rollup>();
  const visit = (p: (typeof projects)[number], depth = 0): Rollup => {
    const id = String(p._id);
    if (memo.has(id)) return memo.get(id)!;
    const own: Rollup = {
      taskCount: p.stats.taskCount,
      completedCount: p.stats.completedCount,
      overdueCount: p.stats.overdueCount,
      percentComplete: p.stats.percentComplete,
      startDate: p.stats.taskCount ? p.startDate : null,
      finishDate: p.stats.taskCount ? p.finishDate : null,
      projectCount: 0,
    };
    let weighted = own.percentComplete * own.taskCount;
    for (const c of depth < 20 ? children.get(id) ?? [] : []) {
      const r = visit(c, depth + 1);
      own.taskCount += r.taskCount;
      own.completedCount += r.completedCount;
      own.overdueCount += r.overdueCount;
      own.projectCount += 1 + r.projectCount;
      weighted += r.percentComplete * r.taskCount;
      if (r.startDate && (!own.startDate || r.startDate < own.startDate)) own.startDate = r.startDate;
      if (r.finishDate && (!own.finishDate || r.finishDate > own.finishDate)) own.finishDate = r.finishDate;
    }
    own.percentComplete = own.taskCount ? Math.round(weighted / own.taskCount) : 0;
    memo.set(id, own);
    return own;
  };
  for (const p of projects) visit(p);
  return memo;
}

async function overdueCounts(projectIds: Types.ObjectId[]) {
  const overdue = await Task.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { project: { $in: projectIds }, isSummary: false, percentComplete: { $lt: 100 }, finish: { $lt: todayISO() } } },
    { $group: { _id: '$project', count: { $sum: 1 } } },
  ]);
  return new Map(overdue.map((o) => [o._id.toString(), o.count]));
}

projectsRouter.get('/', async (req, res) => {
  const projects = await Project.find(accessFilter(req.user!)).populate('owner', 'name email').sort({ updatedAt: -1 });
  const overdueBy = await overdueCounts(projects.map((p) => p._id));
  const favorites = new Set((req.user!.favorites ?? []).map(String));
  const list = projects.map((p) => {
    const json = p.toJSON();
    return { ...json, stats: { ...json.stats, overdueCount: overdueBy.get(p._id.toString()) ?? 0 } };
  });
  // Templates are reusable blueprints, not real work: keep them out of container roll-ups.
  const roll = rollups(list.filter((p) => !p.isTemplate) as never);
  res.json({
    projects: list.map((p, i) => ({
      ...p,
      ...(() => {
        const a = accessFor(projects[i], req.user!);
        return { myRole: a?.role ?? null, myRoleName: a?.roleName ?? '', myPermissions: [...(a?.permissions ?? [])] };
      })(),
      favorite: favorites.has(String(p._id)),
      rollup: roll.get(String(p._id)),
    })),
  });
});

projectsRouter.post('/', async (req, res) => {
  const body = parseBody(createSchema, req.body);
  if (!hasGlobal(req.user!, 'create_projects')) throw forbidden('You don’t have permission to create projects. Ask an administrator.');
  if (body.parent) await assertValidParent(body.parent, req.user!);

  let source: ProjectDoc | null = null;
  if (body.fromProject) {
    source = await Project.findById(body.fromProject);
    if (!source || !accessFor(source, req.user!)) throw notFound('Template');
    if (!source.isTemplate && !can(source, req.user!, 'manage_project')) throw forbidden('Copying a project needs permission to manage it');
  }

  const catalog = await getCatalog();
  const project = await Project.create({
    name: body.name,
    description: body.description || source?.description || '',
    startDate: body.startDate,
    status: body.status,
    kind: body.kind,
    parent: body.parent ?? null,
    isTemplate: body.isTemplate,
    key: await generateProjectKey(body.name),
    finishDate: body.startDate,
    owner: req.user!._id,
    createdBy: req.user!._id,
    updatedBy: req.user!._id,
  });
  if (body.customValues) {
    const people = await projectPeopleIds(project);
    project.customValues = cleanCustomValues(catalog, 'project', body.customValues, {}, (id) => people.has(id));
    await project.save();
  }
  if (source) await copyProjectContent(source, project, req.user!, body.copy);
  res.status(201).json({ project: await serializeProject(project, req.user!) });
});

projectsRouter.get('/:id', loadProject('viewer'), async (req, res) => {
  res.json({ project: await serializeProject(req.project!, req.user!) });
});

projectsRouter.patch('/:id', loadProject('manager', { allowArchived: true }), async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  const project = req.project!;
  if (project.status === 'archived' && Object.keys(body).some((k) => k !== 'status')) {
    throw forbidden('This project is archived. Change its status first to edit it.');
  }
  if (body.holidays) body.holidays = [...new Set(body.holidays)].sort();
  if (body.workingDays) body.workingDays = [...new Set(body.workingDays)].sort();
  if (body.key && body.key !== project.key && (await Project.exists({ key: body.key, _id: { $ne: project._id } }))) {
    throw conflict(`The key ${body.key} is already used by another project`);
  }
  if (body.parent) await assertValidParent(body.parent, req.user!, project._id);
  if (body.isTemplate && body.parent === undefined) body.parent = null;

  const { categories, customValues, lifecycle, ...rest } = body;
  project.set(rest);
  if (categories) {
    const names = categories.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) throw badRequest('Category names must be unique');
    const kept = new Set(categories.map((c) => c._id).filter(Boolean));
    const removed = project.categories.filter((c) => !kept.has(String(c._id))).map((c) => c._id);
    project.set('categories', categories.map((c) => (c._id && Types.ObjectId.isValid(c._id) ? { _id: c._id, name: c.name } : { name: c.name })));
    if (removed.length) await Task.updateMany({ project: project._id, category: { $in: removed } }, { $set: { category: null } });
  }
  if (customValues) {
    const people = await projectPeopleIds(project);
    project.customValues = cleanCustomValues(await getCatalog(), 'project', customValues, project.customValues ?? {}, (id) => people.has(id));
    project.markModified('customValues');
  }
  if (lifecycle) {
    const { phases } = await getCatalog();
    const known = new Set(phases.map((p) => String(p._id)));
    if (lifecycle.some((p) => !known.has(p.definition))) throw badRequest('Unknown life-cycle phase');
    if (lifecycle.some((p) => p.start && p.finish && p.finish < p.start)) throw badRequest('A phase cannot finish before it starts');
    project.set('lifecycle', lifecycle);
  }
  res.json(await mutatePlan(project, req.user!)); // reschedule (calendar/start may have changed)
});

projectsRouter.delete('/:id', loadProject('owner', { allowArchived: true }), async (req, res) => {
  const id = req.project!._id;
  await deleteAttachmentFiles({ project: id });
  await Promise.all([
    Task.deleteMany({ project: id }),
    Resource.deleteMany({ project: id }),
    View.deleteMany({ project: id }),
    Journal.deleteMany({ project: id }),
    Notification.deleteMany({ project: id }),
    Baseline.deleteMany({ project: id }),
    TimeEntry.deleteMany({ project: id }),
    CostEntry.deleteMany({ project: id }),
    Budget.deleteMany({ project: id }),
    HourlyRate.deleteMany({ project: id }),
    // Sub-projects move up to this project's parent.
    Project.updateMany({ parent: id }, { $set: { parent: req.project!.parent ?? null } }),
    User.updateMany({ favorites: id }, { $pull: { favorites: id } }),
  ]);
  await req.project!.deleteOne();
  res.status(204).end();
});

/** POST /projects/:id/copy — new project from this one (templates: anyone who can see them). */
projectsRouter.post('/:id/copy', loadProject('viewer'), async (req, res) => {
  const body = parseBody(
    z.object({ name: z.string().trim().min(1).max(120), startDate: isoDate, parent: objectId.nullish(), isTemplate: z.boolean().default(false), copy: copyOptionsSchema }),
    req.body,
  );
  const source = req.project!;
  if (!hasGlobal(req.user!, 'create_projects')) throw forbidden('You don’t have permission to create projects');
  if (!source.isTemplate && !req.permissions?.has('manage_project')) throw forbidden('Copying a project needs permission to manage it');
  if (body.parent) await assertValidParent(body.parent, req.user!);
  const project = await Project.create({
    name: body.name,
    description: source.description,
    startDate: body.startDate,
    kind: source.kind,
    // Templates live at the top level; normal copies stay next to their source.
    parent: body.parent ?? (body.isTemplate ? null : source.parent ?? null),
    isTemplate: body.isTemplate,
    key: await generateProjectKey(body.name),
    finishDate: body.startDate,
    owner: req.user!._id,
    createdBy: req.user!._id,
    updatedBy: req.user!._id,
  });
  await copyProjectContent(source, project, req.user!, body.copy);
  res.status(201).json({ project: await serializeProject(project, req.user!) });
});

// ---- Overview, activity, favorites ----------------------------------------------------------------

projectsRouter.get('/:id/overview', loadProject('viewer'), async (req, res) => {
  const project = req.project!;
  const visible = (await Project.find(accessFilter(req.user!)).select('name key kind status parent startDate finishDate stats owner members isTemplate').lean()).filter(
    (p) => !p.isTemplate || p._id.equals(project._id),
  );
  const overdueBy = await overdueCounts(visible.map((p) => p._id));
  const withOverdue = visible.map((p) => ({ ...p, stats: { ...p.stats, overdueCount: overdueBy.get(String(p._id)) ?? 0 } }));
  const roll = rollups(withOverdue as never);

  // Descendants (for container roll-ups)
  const selfId = String(project._id);
  const descendants = new Set<string>();
  let frontier = new Set([selfId]);
  while (frontier.size && descendants.size < 500) {
    const next = new Set<string>();
    for (const p of withOverdue) {
      const id = String(p._id);
      if (p.parent && frontier.has(String(p.parent)) && id !== selfId && !descendants.has(id)) next.add(id);
    }
    next.forEach((id) => descendants.add(id));
    frontier = next;
  }
  const scope = [project._id, ...[...descendants].map((id) => new Types.ObjectId(id))];

  const leaves = await Task.find({ project: { $in: scope }, isSummary: false })
    .select('project name status type priority assignee start finish percentComplete isMilestone number')
    .lean();
  const count = (key: 'status' | 'type' | 'priority' | 'assignee') => {
    const m = new Map<string, number>();
    for (const t of leaves) {
      const k = t[key] ? String(t[key]) : '';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([value, n]) => ({ value, count: n }));
  };
  const today = todayISO();
  const horizon = addDays(today, 30);
  const keys = new Map(withOverdue.map((p) => [String(p._id), { name: p.name, key: p.key }]));

  res.json({
    project: await serializeProject(project, req.user!),
    rollup: roll.get(String(project._id)),
    children: withOverdue
      .filter((p) => String(p.parent) === String(project._id))
      .map((p) => ({ ...p, rollup: roll.get(String(p._id)) })),
    counts: { status: count('status'), type: count('type'), priority: count('priority'), assignee: count('assignee') },
    upcomingMilestones: leaves
      .filter((t) => t.isMilestone && t.percentComplete < 100 && t.start >= today && t.start <= horizon)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 8)
      .map((t) => ({ ...t, projectName: keys.get(String(t.project))?.name, projectKey: keys.get(String(t.project))?.key })),
    overdue: leaves.filter((t) => t.percentComplete < 100 && t.finish && t.finish < today).length,
    recentActivity: await journalsFor({ project: { $in: scope } }, { limit: 8, newestFirst: true }),
  });
});

projectsRouter.get('/:id/activity', loadProject('viewer'), async (req, res) => {
  const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : undefined;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  res.json({ activity: await journalsFor({ project: req.project!._id }, { limit, before, newestFirst: true }) });
});

projectsRouter.post('/:id/favorite', loadProject('viewer'), async (req, res) => {
  await User.updateOne({ _id: req.user!._id }, { $addToSet: { favorites: req.project!._id } });
  res.json({ favorite: true });
});

projectsRouter.delete('/:id/favorite', loadProject('viewer'), async (req, res) => {
  await User.updateOne({ _id: req.user!._id }, { $pull: { favorites: req.project!._id } });
  res.json({ favorite: false });
});

// ---- Baselines --------------------------------------------------------------------------------

/** Saves a named snapshot and makes it the active baseline shown on the Gantt. */
async function createBaseline(project: ProjectDoc, user: Parameters<typeof mutatePlan>[1], name: string) {
  const tasks = await loadTasks(project._id);
  const baseline = await Baseline.create({
    project: project._id,
    name,
    createdBy: user._id,
    finishDate: project.finishDate,
    tasks: tasks.map((t) => ({ task: t._id, start: t.start, finish: t.finish })),
  });
  project.baselineSavedAt = new Date();
  const plan = await mutatePlan(project, user, (all) => {
    for (const t of all) {
      t.baselineStart = t.start || null;
      t.baselineFinish = t.finish || null;
    }
  });
  return { ...plan, baseline };
}

projectsRouter.get('/:id/baselines', loadProject('viewer'), async (req, res) => {
  const baselines = await Baseline.find({ project: req.project!._id }).select('-tasks').sort({ createdAt: -1 }).populate('createdBy', 'name').lean();
  res.json({ baselines });
});

projectsRouter.get('/:id/baselines/:baselineId', loadProject('viewer'), async (req, res) => {
  const baseline = await Baseline.findOne({ _id: assertObjectId(req.params.baselineId, 'Baseline'), project: req.project!._id }).lean();
  if (!baseline) throw notFound('Baseline');
  res.json({ baseline });
});

projectsRouter.post('/:id/baselines', loadProject('manager'), async (req, res) => {
  const { name } = parseBody(z.object({ name: z.string().trim().min(1, 'Name the baseline').max(80) }), req.body);
  res.status(201).json(await createBaseline(req.project!, req.user!, name));
});

projectsRouter.delete('/:id/baselines/:baselineId', loadProject('manager'), async (req, res) => {
  const deleted = await Baseline.findOneAndDelete({ _id: assertObjectId(req.params.baselineId, 'Baseline'), project: req.project!._id });
  if (!deleted) throw notFound('Baseline');
  res.status(204).end();
});

/** Legacy single-baseline endpoints (kept for older clients). */
projectsRouter.post('/:id/baseline', loadProject('manager'), async (req, res) => {
  res.json(await createBaseline(req.project!, req.user!, `Baseline ${todayISO()}`));
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

// ---- Members (users or groups, built-in or custom roles) ---------------------------------------

const memberSchema = z
  .object({
    userId: objectId.optional(),
    groupId: objectId.optional(),
    role: z.string().min(1).max(40),
  })
  .refine((v) => !!v.userId !== !!v.groupId, 'Choose a person or a group');

function assertRole(role: string) {
  if (role === 'owner' || !roleInfo(role)) throw badRequest('Unknown role');
}

const memberId = (m: { user?: unknown; group?: unknown }) => String((m.user ?? m.group) as Types.ObjectId);

projectsRouter.post('/:id/members', loadProject('manage_members'), async (req, res) => {
  const body = parseBody(memberSchema, req.body);
  assertRole(body.role);
  const project = req.project!;
  if (body.userId) {
    const user = await User.findById(body.userId);
    if (!user || !user.isActive) throw notFound('User');
    if (project.owner.toString() === body.userId) throw badRequest('The owner already has full access');
    if (project.members.some((m) => m.user && String(m.user) === body.userId)) throw conflict(`${user.name} is already a member`);
    project.members.push({ user: user._id, group: null, role: body.role });
  } else {
    const group = await Group.findById(body.groupId);
    if (!group) throw notFound('Group');
    if (project.members.some((m) => m.group && String(m.group) === body.groupId)) throw conflict(`${group.name} is already a member`);
    project.members.push({ user: null, group: group._id, role: body.role });
  }
  await project.save();
  res.status(201).json({ project: await serializeProject(project, req.user!) });
});

projectsRouter.patch('/:id/members/:memberId', loadProject('manage_members'), async (req, res) => {
  const { role } = parseBody(z.object({ role: z.string().min(1).max(40) }), req.body);
  assertRole(role);
  const project = req.project!;
  const member = project.members.find((m) => memberId(m) === assertObjectId(req.params.memberId, 'Member'));
  if (!member) throw notFound('Member');
  member.role = role;
  await project.save();
  res.json({ project: await serializeProject(project, req.user!) });
});

projectsRouter.delete('/:id/members/:memberId', loadProject('manage_members'), async (req, res) => {
  const project = req.project!;
  const id = assertObjectId(req.params.memberId, 'Member');
  const before = project.members.length;
  project.set('members', project.members.filter((m) => memberId(m) !== id));
  if (project.members.length === before) throw notFound('Member');
  await project.save();
  res.json({ project: await serializeProject(project, req.user!) });
});
