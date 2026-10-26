import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { publicUser, User } from '../models/User';
import { isISODate } from '../scheduling/calendar';
import { buildCalendar, taskEvent } from '../services/ical';
import { parseMsProjectXml } from '../services/msProjectXml';
import { accessFilter, accessFor, attachAccess, can, hasGlobal, loadRoles } from '../services/permissions';
import { createProjectForImport, importRowSchema, importRows, MAX_IMPORT_ROWS } from '../services/planImport';
import { runReminders } from '../services/reminders';
import { assertObjectId, badRequest, forbidden, HttpError, notFound, parseBody, patchSchema } from '../utils/http';

/** Mounted at /api (signed in): plan import, reminder preferences and calendar-feed tokens. */
export const schedulingRouter = Router();
// Mounted at /api next to other routers, so sign-in is required only on these paths.
schedulingRouter.use(['/import', '/reminders', '/calendar-feed'], requireAuth);

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// ---- Import ---------------------------------------------------------------------------------

/** POST /import/msproject/preview — parses an MS Project XML file into rows (nothing is saved). */
schedulingRouter.post(
  '/import/msproject/preview',
  (req, res, next) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'FILE_TOO_LARGE', 'Files can be at most 10 MB'));
      next(err);
    }),
  async (req, res) => {
    if (!req.file) throw badRequest('Choose an MS Project XML file');
    res.json(parseMsProjectXml(req.file.buffer.toString('utf8')));
  },
);

const commitSchema = z
  .object({
    projectId: objectId.optional(),
    newProject: z.object({ name: z.string().trim().min(1, 'Name the project').max(120), startDate: isoDate, parent: objectId.nullish(), description: z.string().max(2000).optional() }).optional(),
    rows: z.array(importRowSchema).min(1, 'The file has no tasks').max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} tasks per import`),
    options: z.object({ matchPeople: z.boolean().default(true), createResources: z.boolean().default(true) }).default({ matchPeople: true, createResources: true }),
  })
  .refine((v) => !!v.projectId !== !!v.newProject, 'Choose an existing project or a new one');

/** POST /import/commit — adds the rows to an existing project, or creates a new project from them. */
schedulingRouter.post('/import/commit', async (req, res) => {
  const body = parseBody(commitSchema, req.body);
  const user = req.user!;
  let project;
  let createdProject = false;
  if (body.projectId) {
    project = await Project.findById(body.projectId);
    if (!project || !accessFor(project, user)) throw notFound('Project');
    if (!can(project, user, 'edit_tasks')) throw forbidden('You can’t add tasks to this project');
    if (project.kind !== 'project') throw badRequest('Import tasks into a project, not a program or portfolio');
  } else {
    if (!hasGlobal(user, 'create_projects')) throw forbidden('You don’t have permission to create projects. Ask an administrator.');
    const parentId = body.newProject!.parent;
    if (parentId) {
      const parent = await Project.findById(parentId);
      if (!parent || parent.isTemplate || !can(parent, user, 'add_subprojects')) throw forbidden('You can’t add a project under that parent');
    }
    project = await createProjectForImport(user, body.newProject!);
    createdProject = true;
  }
  try {
    const summary = await importRows(project, user, body.rows, body.options);
    res.status(201).json({ projectId: String(project._id), projectName: project.name, createdProject, ...summary });
  } catch (err) {
    // A failed import must not leave an empty new project behind.
    if (createdProject) await project.deleteOne();
    throw err;
  }
});

// ---- Reminders ------------------------------------------------------------------------------

const prefsSchema = z.object({
  dueSoonDays: z.number().int().min(0).max(14),
  overdue: z.boolean(),
  digest: z.boolean(),
  assigned: z.boolean(),
  accountable: z.boolean(),
  watched: z.boolean(),
});

schedulingRouter.put('/reminders/preferences', async (req, res) => {
  const body = parseBody(patchSchema(prefsSchema), req.body);
  const user = req.user!;
  user.set('reminders', { ...publicUser(user).reminders, ...body });
  await user.save();
  res.json({ user: publicUser(user) });
});

/** POST /reminders/run — administrators can run the reminder job now (it also runs every hour). */
schedulingRouter.post('/reminders/run', requireAdmin, async (_req, res) => {
  res.json(await runReminders());
});

// ---- Calendar feed token --------------------------------------------------------------------

schedulingRouter.get('/calendar-feed', async (req, res) => {
  const user = await User.findById(req.user!._id).select('+icalToken icalTokenCreatedAt');
  res.json({ token: user?.icalToken ?? null, createdAt: user?.icalTokenCreatedAt ?? null });
});

/** POST /calendar-feed — creates (or replaces) your secret feed link; old links stop working. */
schedulingRouter.post('/calendar-feed', async (req, res) => {
  const token = randomBytes(24).toString('base64url');
  const createdAt = new Date();
  await User.updateOne({ _id: req.user!._id }, { $set: { icalToken: token, icalTokenCreatedAt: createdAt } });
  res.status(201).json({ token, createdAt });
});

schedulingRouter.delete('/calendar-feed', async (req, res) => {
  await User.updateOne({ _id: req.user!._id }, { $set: { icalToken: null, icalTokenCreatedAt: null } });
  res.status(204).end();
});

// ---- Cron entry point -----------------------------------------------------------------------

/** Mounted at /api/jobs (no sign-in): POST /reminders with header X-Cron-Secret: <CRON_SECRET>. */
export const jobsRouter = Router();

jobsRouter.post('/reminders', async (req, res) => {
  const given = Buffer.from(String(req.header('x-cron-secret') ?? ''));
  const expected = Buffer.from(env.CRON_SECRET ?? '');
  if (!env.CRON_SECRET || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid cron secret');
  res.json(await runReminders());
});

// ---- Public calendar feeds ------------------------------------------------------------------

/** Mounted at /api/ical (no sign-in; the secret token in the URL identifies the person). */
export const icalRouter = Router();

async function feedUser(token: unknown) {
  const value = String(token ?? '');
  if (value.length < 20) throw notFound('Calendar');
  const user = await User.findOne({ icalToken: value, isActive: true });
  if (!user) throw notFound('Calendar');
  await loadRoles();
  await attachAccess(user);
  return user;
}

const sendCalendar = (res: import('express').Response, name: string, body: string) => {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w.-]+/g, '-')}.ics"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(body);
};

/** GET /:token/my-tasks.ics — tasks assigned to you plus milestones of your projects. */
icalRouter.get('/:token/my-tasks.ics', async (req, res) => {
  const user = await feedUser(req.params.token);
  const projects = await Project.find({ ...accessFilter(user), isTemplate: { $ne: true }, status: { $ne: 'archived' }, kind: 'project' }).select('name key members owner status isTemplate parent');
  const visible = projects.filter((p) => accessFor(p, user));
  const byId = new Map(visible.map((p) => [String(p._id), p]));
  const tasks = await Task.find({
    project: { $in: visible.map((p) => p._id) },
    isSummary: false,
    start: { $gt: '' },
    $or: [{ assignee: user._id }, { isMilestone: true }],
  })
    .select('project name number start finish isMilestone percentComplete updatedAt')
    .sort({ start: 1 })
    .limit(2000)
    .lean();
  const events = tasks.map((t) => taskEvent(byId.get(String(t.project))!, t));
  sendCalendar(res, 'my-tasks', buildCalendar(`My tasks — ${user.name}`, events));
});

/** GET /:token/project/:projectId.ics — every task of one project you can view. */
icalRouter.get('/:token/project/:file', async (req, res) => {
  const user = await feedUser(req.params.token);
  const projectId = assertObjectId(String(req.params.file).replace(/\.ics$/, ''), 'Project');
  const project = await Project.findById(projectId);
  if (!project || !accessFor(project, user)) throw notFound('Calendar');
  const tasks = await Task.find({ project: project._id, isSummary: false, start: { $gt: '' } })
    .select('name number start finish isMilestone percentComplete updatedAt')
    .sort({ start: 1 })
    .limit(5000)
    .lean();
  sendCalendar(res, project.key || project.name, buildCalendar(project.name, tasks.map((t) => taskEvent(project, t))));
});
