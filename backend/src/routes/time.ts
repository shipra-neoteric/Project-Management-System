import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { TimeOff } from '../models/Access';
import { HourlyRate, TimeActivity, TimeEntry } from '../models/Finance';
import { Project, type ProjectDoc } from '../models/Project';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { addDays, isISODate, parseISODate } from '../scheduling/calendar';
import { effectiveRate, ensureFinanceDefaults, repriceTime, round2 } from '../services/costing';
import { accessFilter, accessFor, hasGlobal, projectPeopleIds } from '../services/permissions';
import { assertObjectId, badRequest, forbidden, notFound, parseBody } from '../utils/http';

/** Time entries (incl. the weekly timesheet), default hourly rates, time off and the resource planner. */
export const timeRouter = Router();

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const isoDate = z.string().refine(isISODate, 'Use a valid date (YYYY-MM-DD)');
const hours = z.number().min(0.01, 'Hours must be more than 0').max(24, 'At most 24 hours per entry');

async function projectFor(req: Express.Request, projectId: string, perm: 'log_time' | 'edit_time' | 'view_time') {
  const project = await Project.findById(assertObjectId(projectId, 'Project'));
  const access = project ? accessFor(project, req.user!) : null;
  if (!project || !access) throw notFound('Project');
  if (!access.permissions.has(perm)) throw forbidden(perm === 'log_time' ? 'You can’t log time in this project' : 'You can’t manage other people’s time in this project');
  if (project.status === 'archived') throw forbidden('This project is archived and read-only');
  return { project, access };
}

async function assertTask(project: ProjectDoc, taskId?: string | null) {
  if (taskId && !(await Task.exists({ _id: taskId, project: project._id }))) throw badRequest('That task is not in this project');
}

async function defaultActivity() {
  await ensureFinanceDefaults();
  return (await TimeActivity.findOne({ isDefault: true }).lean())?._id ?? (await TimeActivity.findOne().sort({ position: 1 }).lean())?._id ?? null;
}

// ---- Time entries --------------------------------------------------------------------------

const entrySchema = z.object({
  project: objectId,
  task: objectId.nullish(),
  user: objectId.optional(),
  activity: objectId.nullish(),
  date: isoDate,
  hours,
  comment: z.string().max(500).optional().default(''),
});

/**
 * GET /time-entries?project=&task=&user=&from=&to=
 * Without `project`: your own entries across projects (timesheet). With it: everyone's if you may view time.
 */
timeRouter.get('/time-entries', async (req, res) => {
  const q = parseBody(z.object({ project: objectId.optional(), task: objectId.optional(), user: objectId.optional(), from: isoDate.optional(), to: isoDate.optional() }), req.query);
  const filter: Record<string, unknown> = {};
  let canSeeCost = false;
  if (q.project) {
    const project = await Project.findById(q.project);
    const access = project ? accessFor(project, req.user!) : null;
    if (!project || !access) throw notFound('Project');
    filter.project = project._id;
    canSeeCost = access.permissions.has('view_costs');
    if (!access.permissions.has('view_time')) filter.user = req.user!._id;
    else if (q.user) filter.user = q.user;
  } else {
    filter.user = req.user!._id;
    canSeeCost = true; // your own cost is visible to you
  }
  if (q.task) filter.task = q.task;
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const entries = await TimeEntry.find(filter).sort({ date: -1, createdAt: -1 }).limit(2000).populate('user', 'name').populate('activity', 'name color').lean();
  const projects = await Project.find({ _id: { $in: [...new Set(entries.map((e) => String(e.project)))] } }).select('name key').lean();
  const tasks = await Task.find({ _id: { $in: entries.map((e) => e.task).filter(Boolean) } }).select('name number').lean();
  const pName = new Map(projects.map((p) => [String(p._id), p]));
  const tName = new Map(tasks.map((t) => [String(t._id), t]));
  res.json({
    entries: entries.map((e) => ({
      ...e,
      projectName: pName.get(String(e.project))?.name ?? '',
      projectKey: pName.get(String(e.project))?.key ?? '',
      taskName: e.task ? tName.get(String(e.task))?.name ?? '' : '',
      taskNumber: e.task ? tName.get(String(e.task))?.number ?? null : null,
      ...(canSeeCost ? {} : { rate: null, cost: null }),
    })),
  });
});

timeRouter.post('/time-entries', async (req, res) => {
  const body = parseBody(entrySchema, req.body);
  const forOther = body.user && body.user !== String(req.user!._id);
  const { project } = await projectFor(req, body.project, forOther ? 'edit_time' : 'log_time');
  const userId = body.user ?? String(req.user!._id);
  if (forOther && !(await projectPeopleIds(project)).has(userId)) throw badRequest('That person is not in this project');
  await assertTask(project, body.task);
  const rate = await effectiveRate(userId, project._id, body.date);
  const entry = await TimeEntry.create({
    project: project._id,
    task: body.task ?? null,
    user: userId,
    activity: body.activity ?? (await defaultActivity()),
    date: body.date,
    hours: body.hours,
    comment: body.comment,
    rate,
    cost: round2(rate * body.hours),
    createdBy: req.user!._id,
  });
  res.status(201).json({ entry });
});

async function loadEntry(req: Express.Request, id: unknown) {
  const entry = await TimeEntry.findById(assertObjectId(id, 'Time entry'));
  if (!entry) throw notFound('Time entry');
  const own = String(entry.user) === String(req.user!._id);
  await projectFor(req, String(entry.project), own ? 'log_time' : 'edit_time');
  return entry;
}

timeRouter.patch('/time-entries/:entryId', async (req, res) => {
  const body = parseBody(entrySchema.omit({ project: true, user: true }).partial(), req.body);
  const entry = await loadEntry(req, req.params.entryId);
  const project = (await Project.findById(entry.project))!;
  await assertTask(project, body.task);
  entry.set({ ...body, ...(body.task !== undefined ? { task: body.task ?? null } : {}) });
  entry.rate = await effectiveRate(entry.user, entry.project, entry.date);
  entry.cost = round2(entry.rate * entry.hours);
  await entry.save();
  res.json({ entry });
});

timeRouter.delete('/time-entries/:entryId', async (req, res) => {
  const entry = await loadEntry(req, req.params.entryId);
  await entry.deleteOne();
  res.status(204).end();
});

/**
 * PUT /time-entries/cell — the weekly timesheet: sets *your* total hours for one
 * project/task/activity on one day (0 removes it).
 */
timeRouter.put('/time-entries/cell', async (req, res) => {
  const body = parseBody(
    z.object({ project: objectId, task: objectId.nullish(), activity: objectId.nullish(), date: isoDate, hours: z.number().min(0).max(24) }),
    req.body,
  );
  const { project } = await projectFor(req, body.project, 'log_time');
  await assertTask(project, body.task);
  const activity = body.activity ?? (await defaultActivity());
  const match = { project: project._id, task: body.task ?? null, activity, date: body.date, user: req.user!._id };
  await TimeEntry.deleteMany(match);
  if (body.hours > 0) {
    const rate = await effectiveRate(req.user!._id, project._id, body.date);
    await TimeEntry.create({ ...match, hours: body.hours, rate, cost: round2(rate * body.hours), createdBy: req.user!._id });
  }
  res.json({ ok: true });
});

// ---- Default hourly rates ------------------------------------------------------------------

timeRouter.get('/rates', async (req, res) => {
  const { user } = parseBody(z.object({ user: objectId.optional() }), req.query);
  const target = user ?? String(req.user!._id);
  if (target !== String(req.user!._id) && !hasGlobal(req.user!, 'manage_rates')) throw forbidden('You can only see your own rates');
  const rates = await HourlyRate.find({ user: target, project: null }).sort({ validFrom: -1 }).lean();
  res.json({ rates });
});

timeRouter.post('/rates', async (req, res) => {
  if (!hasGlobal(req.user!, 'manage_rates')) throw forbidden('You don’t have permission to set hourly rates');
  const body = parseBody(z.object({ user: objectId, rate: z.number().min(0).max(1e7), validFrom: isoDate }), req.body);
  if (!(await User.exists({ _id: body.user }))) throw notFound('User');
  const rate = await HourlyRate.findOneAndUpdate({ user: body.user, project: null, validFrom: body.validFrom }, { $set: { rate: body.rate } }, { upsert: true, new: true });
  await repriceTime(body.user);
  res.status(201).json({ rate });
});

timeRouter.delete('/rates/:rateId', async (req, res) => {
  if (!hasGlobal(req.user!, 'manage_rates')) throw forbidden('You don’t have permission to set hourly rates');
  const rate = await HourlyRate.findOneAndDelete({ _id: assertObjectId(req.params.rateId, 'Rate'), project: null });
  if (!rate) throw notFound('Rate');
  await repriceTime(rate.user);
  res.status(204).end();
});

// ---- Time off ------------------------------------------------------------------------------

timeRouter.get('/time-off', async (req, res) => {
  const q = parseBody(z.object({ user: objectId.optional() }), req.query);
  const target = q.user ?? String(req.user!._id);
  const list = await TimeOff.find({ user: target }).sort({ start: -1 }).lean();
  res.json({ timeOff: list });
});

timeRouter.post('/time-off', async (req, res) => {
  const body = parseBody(z.object({ start: isoDate, end: isoDate, note: z.string().max(200).optional().default(''), user: objectId.optional() }), req.body);
  if (body.end < body.start) throw badRequest('Time off cannot end before it starts');
  const target = body.user ?? String(req.user!._id);
  if (target !== String(req.user!._id) && !hasGlobal(req.user!, 'manage_users')) throw forbidden('You can only add your own time off');
  const entry = await TimeOff.create({ ...body, user: target });
  res.status(201).json({ timeOff: entry });
});

timeRouter.delete('/time-off/:id', async (req, res) => {
  const entry = await TimeOff.findById(assertObjectId(req.params.id, 'Time off'));
  if (!entry) throw notFound('Time off');
  if (String(entry.user) !== String(req.user!._id) && !hasGlobal(req.user!, 'manage_users')) throw forbidden('You can only remove your own time off');
  await entry.deleteOne();
  res.status(204).end();
});

// ---- Resource planner ----------------------------------------------------------------------

/**
 * GET /planner?from=&to= — for every person in projects you can see: daily capacity (working hours
 * minus time off) and allocated hours (each assigned task's work spread over its working days;
 * without an estimate, a full working day per task day).
 */
timeRouter.get('/planner', async (req, res) => {
  const q = parseBody(z.object({ from: isoDate, to: isoDate, project: objectId.optional() }), req.query);
  if (q.to < q.from) throw badRequest('Invalid range');
  const span = Math.round((parseISODate(q.to) - parseISODate(q.from)) / 86_400_000) + 1;
  if (span > 190) throw badRequest('Choose a range of at most 6 months');

  const projects = await Project.find({ ...accessFilter(req.user!), isTemplate: { $ne: true }, status: { $ne: 'archived' }, kind: 'project' });
  const people = new Set<string>();
  if (q.project) {
    // Team planner: only this project's people (their load still counts every project).
    const only = projects.find((p) => String(p._id) === q.project);
    if (!only) throw notFound('Project');
    for (const id of await projectPeopleIds(only)) people.add(id);
  } else {
    for (const p of projects) for (const id of await projectPeopleIds(p)) people.add(id);
  }
  const users = await User.find({ _id: { $in: [...people] }, isActive: true }).select('name email kind workSchedule').sort({ name: 1 }).lean();
  const byUser = new Map(users.map((u) => [String(u._id), u]));
  const timeOff = await TimeOff.find({ user: { $in: users.map((u) => u._id) }, start: { $lte: q.to }, end: { $gte: q.from } }).lean();

  const days: string[] = [];
  for (let i = 0; i < span; i++) days.push(addDays(q.from, i));
  const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

  const capacity: Record<string, number[]> = {};
  for (const u of users) {
    const sched = u.workSchedule ?? { hoursPerDay: 8, workingDays: [1, 2, 3, 4, 5] };
    const off = timeOff.filter((t) => String(t.user) === String(u._id));
    capacity[String(u._id)] = days.map((d) => (sched.workingDays?.includes(weekday(d)) && !off.some((t) => d >= t.start && d <= t.end) ? sched.hoursPerDay ?? 8 : 0));
  }

  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const tasks = await Task.find({
    project: { $in: projects.map((p) => p._id) },
    isSummary: false,
    assignee: { $in: users.map((u) => u._id) },
    start: { $lte: q.to },
    finish: { $gte: q.from },
    percentComplete: { $lt: 100 },
  })
    .select('project name number assignee start finish duration work remainingWork percentComplete isMilestone')
    .lean();

  const allocation: Record<string, number[]> = Object.fromEntries(users.map((u) => [String(u._id), days.map(() => 0)]));
  const taskRows = [];
  for (const t of tasks) {
    const p = projectById.get(String(t.project))!;
    const uid = String(t.assignee);
    const u = byUser.get(uid);
    if (!u || t.isMilestone) continue;
    // Working days of the task in its project's calendar
    const taskDays: string[] = [];
    for (let d = t.start; d <= t.finish && taskDays.length < 2000; d = addDays(d, 1)) {
      if (p.workingDays.includes(weekday(d)) && !p.holidays.includes(d)) taskDays.push(d);
    }
    if (!taskDays.length) continue;
    // Spread the effort over the days the person is actually available (their working days, not on leave).
    const sched = u.workSchedule ?? { hoursPerDay: 8, workingDays: [1, 2, 3, 4, 5] };
    const off = timeOff.filter((o) => String(o.user) === uid);
    const available = taskDays.filter((d) => sched.workingDays?.includes(weekday(d)) && !off.some((o) => d >= o.start && d <= o.end));
    const spread = available.length ? available : taskDays;
    const effort = t.remainingWork ?? t.work ?? spread.length * (sched.hoursPerDay ?? 8);
    const perDay = round2(effort / spread.length);
    for (const d of spread) {
      const i = days.indexOf(d);
      if (i >= 0) allocation[uid][i] = round2(allocation[uid][i] + perDay);
    }
    taskRows.push({ _id: t._id, project: t.project, projectName: p.name, projectKey: p.key, name: t.name, number: t.number, assignee: uid, start: t.start, finish: t.finish, hoursPerDay: perDay });
  }

  res.json({
    from: q.from,
    to: q.to,
    days,
    users: users.map((u) => ({ _id: u._id, name: u.name, kind: u.kind ?? 'user', hoursPerDay: u.workSchedule?.hoursPerDay ?? 8 })),
    capacity,
    allocation,
    tasks: taskRows,
    timeOff: timeOff.map((t) => ({ user: t.user, start: t.start, end: t.end, note: t.note })),
  });
});
