import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { hasPerm, loadProject } from '../middleware/projectAccess';
import { Meeting, MEETING_STATUSES, RECURRENCE_FREQUENCIES, type MeetingDoc } from '../models/Meeting';
import { Notification } from '../models/Notification';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { isISODate } from '../scheduling/calendar';
import { recordTaskCreated } from '../services/activity';
import { getCatalog } from '../services/catalog';
import { renderEmail, sendMail } from '../services/mailer';
import { meetingIcs } from '../services/meetingIcs';
import { projectPeopleIds } from '../services/permissions';
import { mutatePlan } from '../services/planService';
import { env } from '../config/env';
import { assertObjectId, badRequest, forbidden, notFound, parseBody, patchSchema } from '../utils/http';
import { richTextToHtml, richTextToPlain, sanitizeRichText } from '../utils/richText';
import { newTask } from './tasks';

/** Mounted at /api/projects/:id/meetings — agendas, minutes, attendance, action items and invitations. */
export const meetingsRouter = Router({ mergeParams: true });

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const richText = (max: number) => z.string().max(max).transform(sanitizeRichText);
const MAX_OCCURRENCES = 52;

const agendaItemSchema = z.object({
  _id: objectId.optional(),
  title: z.string().trim().min(1, 'Give every agenda item a title').max(200),
  notes: richText(20000).optional().default(''),
  durationMinutes: z.number().int().min(0).max(600).optional().default(10),
  presenter: objectId.nullish(),
  task: objectId.nullish(),
  outcome: richText(20000).optional().default(''),
});

const baseSchema = z.object({
  title: z.string().trim().min(1, 'Give the meeting a title').max(200),
  location: z.string().trim().max(300).optional().default(''),
  startsAt: z.iso.datetime({ offset: true, message: 'Choose a date and time' }),
  durationMinutes: z.number().int().min(5).max(1440).optional().default(60),
  participants: z.array(objectId).max(200).optional().default([]),
  agenda: z.array(agendaItemSchema).max(100).optional().default([]),
});

const createSchema = baseSchema.extend({
  recurrence: z
    .object({ frequency: z.enum(RECURRENCE_FREQUENCIES), until: z.string().refine(isISODate, 'Choose an end date for the series') })
    .nullish(),
});

const updateSchema = patchSchema(baseSchema).extend({
  minutes: richText(50000).optional(),
  status: z.enum(MEETING_STATUSES).exclude(['closed']).optional(),
});

const scopeSchema = z.object({ scope: z.enum(['this', 'future']).optional().default('this') });

// ---- Helpers ----------------------------------------------------------------------------------

async function loadMeeting(req: Request) {
  const meeting = await Meeting.findOne({ _id: assertObjectId(req.params.meetingId, 'Meeting'), project: req.project!._id });
  if (!meeting) throw notFound('Meeting');
  return meeting;
}

function assertOpen(meeting: MeetingDoc) {
  if (meeting.status === 'closed') throw badRequest('This meeting is closed. Reopen it to make changes.');
}

/** Participants, presenters and linked tasks must belong to the project. */
async function validateRefs(req: Request, body: { participants?: string[]; agenda?: { presenter?: string | null; task?: string | null }[] }) {
  const people = await projectPeopleIds(req.project!);
  for (const id of body.participants ?? []) if (!people.has(id)) throw badRequest('Every participant must be a member of the project');
  for (const item of body.agenda ?? []) {
    if (item.presenter && !people.has(item.presenter)) throw badRequest('Presenters must be members of the project');
  }
  const taskIds = (body.agenda ?? []).map((a) => a.task).filter(Boolean) as string[];
  if (taskIds.length && (await Task.countDocuments({ _id: { $in: taskIds }, project: req.project!._id })) !== new Set(taskIds).size) {
    throw badRequest('Linked tasks must be in this project');
  }
}

/** Keeps invitation/attendance state for people who stay on the list. */
function mergeParticipants(meeting: MeetingDoc, ids: string[]) {
  const existing = new Map(meeting.participants.map((p) => [String(p.user), p]));
  return [...new Set(ids)].map((id) => existing.get(id) ?? { user: new Types.ObjectId(id), invitedAt: null, attended: null });
}

/** Keeps action-item links of agenda items that are still there. */
function mergeAgenda(meeting: MeetingDoc, items: z.infer<typeof agendaItemSchema>[]) {
  const existing = new Map(meeting.agenda.map((a) => [String(a._id), a]));
  return items.map((item) => ({
    ...(item._id && existing.has(item._id) ? { _id: item._id, actions: existing.get(item._id)!.actions } : { actions: [] }),
    title: item.title,
    notes: item.notes,
    durationMinutes: item.durationMinutes,
    presenter: item.presenter ?? null,
    task: item.task ?? null,
    outcome: item.outcome,
  }));
}

function nextOccurrence(date: Date, frequency: (typeof RECURRENCE_FREQUENCIES)[number], n: number) {
  const d = new Date(date);
  if (frequency === 'monthly') {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  } else {
    d.setUTCDate(d.getUTCDate() + n * (frequency === 'weekly' ? 7 : 14));
  }
  return d;
}

/** Meeting JSON with people and task names filled in. */
async function serialize(meeting: MeetingDoc) {
  await meeting.populate([
    { path: 'organizer', select: 'name email' },
    { path: 'participants.user', select: 'name email kind' },
    { path: 'agenda.presenter', select: 'name' },
    { path: 'closedBy', select: 'name' },
  ]);
  const json = meeting.toJSON();
  const taskIds = meeting.agenda.flatMap((a) => [a.task, ...a.actions]).filter(Boolean);
  const tasks = await Task.find({ _id: { $in: taskIds } }).select('name number percentComplete finish assignee').lean();
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  const ref = (id: unknown) => {
    const t = id ? byId.get(String(id)) : undefined;
    return t ? { _id: String(t._id), name: t.name, number: t.number ?? null, percentComplete: t.percentComplete, finish: t.finish, assignee: t.assignee ? String(t.assignee) : null } : null;
  };
  return {
    ...json,
    agenda: json.agenda.map((a, i) => ({ ...a, task: ref(meeting.agenda[i].task), actions: meeting.agenda[i].actions.map(ref).filter(Boolean) })),
  };
}

/** Real people (not placeholders or pending invitations) with an email address. */
async function reachable(ids: unknown[]) {
  return User.find({ _id: { $in: ids }, isActive: true, kind: { $ne: 'placeholder' }, invited: { $ne: true }, email: { $nin: [null, ''] } })
    .select('name email')
    .lean();
}

const when = (d: Date) => new Date(d).toUTCString().replace(/:\d\d GMT$/, ' UTC');
const meetingLink = (projectId: unknown, meetingId: unknown) => `/projects/${projectId}/meetings?meeting=${meetingId}`;

async function notify(req: Request, meeting: MeetingDoc, recipients: unknown[], summary: string) {
  const actor = req.user!._id;
  const docs = recipients
    .filter((r) => String(r) !== String(actor))
    .map((recipient) => ({
      recipient,
      actor,
      project: req.project!._id,
      projectName: req.project!.name,
      taskName: meeting.title,
      reason: 'meeting' as const,
      summary,
      link: meetingLink(req.project!._id, meeting._id),
    }));
  if (docs.length) await Notification.insertMany(docs);
}

// ---- Routes ----------------------------------------------------------------------------------

/** GET ?scope=upcoming|past|all — meetings sorted by date (upcoming first by default). */
meetingsRouter.get('/', loadProject('view_project'), async (req, res) => {
  const { scope } = parseBody(z.object({ scope: z.enum(['upcoming', 'past', 'all']).optional().default('all') }), req.query);
  const now = new Date();
  const filter: Record<string, unknown> = { project: req.project!._id };
  if (scope === 'upcoming') filter.startsAt = { $gte: new Date(now.getTime() - 12 * 3600_000) };
  if (scope === 'past') filter.startsAt = { $lt: now };
  const meetings = await Meeting.find(filter)
    .sort({ startsAt: scope === 'past' ? -1 : 1 })
    .limit(500)
    .select('-agenda.notes -agenda.outcome -minutes')
    .populate('organizer', 'name')
    .lean();
  res.json({
    meetings: meetings.map((m) => ({
      ...m,
      agendaCount: m.agenda.length,
      agendaMinutes: m.agenda.reduce((a, i) => a + (i.durationMinutes ?? 0), 0),
      actionCount: m.agenda.reduce((a, i) => a + (i.actions?.length ?? 0), 0),
      agenda: undefined,
    })),
    canManage: hasPerm(req, 'manage_meetings'),
  });
});

meetingsRouter.post('/', loadProject('manage_meetings'), async (req, res) => {
  const body = parseBody(createSchema, req.body);
  await validateRefs(req, body);
  const startsAt = new Date(body.startsAt);
  const participants = [...new Set([String(req.user!._id), ...body.participants])].map((id) => ({ user: new Types.ObjectId(id), invitedAt: null, attended: null }));
  const agenda = body.agenda.map((a) => ({ ...a, _id: undefined, presenter: a.presenter ?? null, task: a.task ?? null, actions: [] }));
  const base = {
    project: req.project!._id,
    title: body.title,
    location: body.location,
    durationMinutes: body.durationMinutes,
    organizer: req.user!._id,
    participants,
    agenda,
    createdBy: req.user!._id,
  };

  if (!body.recurrence) {
    const meeting = await Meeting.create({ ...base, startsAt });
    return res.status(201).json({ meeting: await serialize(meeting), created: 1 });
  }
  const until = new Date(`${body.recurrence.until}T23:59:59Z`);
  if (until < startsAt) throw badRequest('The series must end after the first meeting');
  const seriesId = new Types.ObjectId();
  const dates: Date[] = [];
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const d = nextOccurrence(startsAt, body.recurrence.frequency, n);
    if (d > until) break;
    dates.push(d);
  }
  const created = await Meeting.insertMany(dates.map((d) => ({ ...base, startsAt: d, seriesId, recurrence: body.recurrence })));
  res.status(201).json({ meeting: await serialize(created[0] as unknown as MeetingDoc), created: created.length });
});

meetingsRouter.get('/:meetingId', loadProject('view_project'), async (req, res) => {
  const meeting = await loadMeeting(req);
  const series = meeting.seriesId ? await Meeting.find({ seriesId: meeting.seriesId }).sort({ startsAt: 1 }).select('startsAt status').lean() : [];
  res.json({ meeting: await serialize(meeting), series, canManage: hasPerm(req, 'manage_meetings'), canCreateTasks: hasPerm(req, 'edit_tasks') });
});

/** PATCH ?scope=this|future — "future" applies title, place, length, people and a time shift to later meetings in the series. */
meetingsRouter.patch('/:meetingId', loadProject('manage_meetings'), async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  const { scope } = parseBody(scopeSchema, req.query);
  const meeting = await loadMeeting(req);
  assertOpen(meeting);
  await validateRefs(req, body);

  const shift = body.startsAt ? new Date(body.startsAt).getTime() - meeting.startsAt.getTime() : 0;
  const apply = (m: MeetingDoc, self: boolean) => {
    if (body.title !== undefined) m.title = body.title;
    if (body.location !== undefined) m.location = body.location;
    if (body.durationMinutes !== undefined) m.durationMinutes = body.durationMinutes;
    if (body.participants !== undefined) m.set('participants', mergeParticipants(m, body.participants));
    if (shift) m.startsAt = new Date(m.startsAt.getTime() + shift);
    if (self) {
      if (body.agenda !== undefined) m.set('agenda', mergeAgenda(m, body.agenda));
      if (body.minutes !== undefined) m.minutes = body.minutes;
      if (body.status !== undefined) m.status = body.status;
    }
    m.sequence = (m.sequence ?? 0) + 1;
  };
  apply(meeting, true);
  await meeting.save();
  let updated = 1;
  if (scope === 'future' && meeting.seriesId) {
    const later = await Meeting.find({ seriesId: meeting.seriesId, _id: { $ne: meeting._id }, startsAt: { $gt: new Date(meeting.startsAt.getTime() - shift) }, status: { $ne: 'closed' } });
    for (const m of later) {
      apply(m, false);
      await m.save();
    }
    updated += later.length;
  }
  res.json({ meeting: await serialize(meeting), updated });
});

meetingsRouter.delete('/:meetingId', loadProject('manage_meetings'), async (req, res) => {
  const { scope } = parseBody(scopeSchema, req.query);
  const meeting = await loadMeeting(req);
  const filter =
    scope === 'future' && meeting.seriesId
      ? { seriesId: meeting.seriesId, startsAt: { $gte: meeting.startsAt }, status: { $ne: 'closed' as const } }
      : { _id: meeting._id };
  const { deletedCount } = await Meeting.deleteMany(filter);
  res.json({ deleted: deletedCount });
});

/** Participants record their own attendance; meeting managers can record anyone's. */
meetingsRouter.post('/:meetingId/attendance', loadProject('view_project'), async (req, res) => {
  const body = parseBody(z.object({ userId: objectId.optional(), attended: z.boolean().nullable() }), req.body);
  const meeting = await loadMeeting(req);
  assertOpen(meeting);
  const target = body.userId ?? String(req.user!._id);
  if (target !== String(req.user!._id) && !hasPerm(req, 'manage_meetings')) throw forbidden('Only the organiser can record other people’s attendance');
  const participant = meeting.participants.find((p) => String(p.user) === target);
  if (!participant) throw badRequest('That person is not a participant');
  participant.attended = body.attended;
  await meeting.save();
  res.json({ meeting: await serialize(meeting) });
});

/** Creates a task (action item) in the project from an agenda item. */
meetingsRouter.post('/:meetingId/agenda/:itemId/actions', loadProject('manage_meetings'), async (req, res) => {
  if (!hasPerm(req, 'edit_tasks')) throw forbidden('Creating action items needs permission to edit tasks');
  const body = parseBody(
    z.object({
      title: z.string().trim().min(1, 'Describe the action').max(200),
      assignee: objectId.nullish(),
      dueDate: z.string().refine(isISODate, 'Choose a valid due date').nullish(),
    }),
    req.body,
  );
  const meeting = await loadMeeting(req);
  assertOpen(meeting);
  const item = meeting.agenda.find((a) => String(a._id) === req.params.itemId);
  if (!item) throw notFound('Agenda item');
  const project = req.project!;
  if (body.assignee && !(await projectPeopleIds(project)).has(body.assignee)) throw badRequest('The assignee must be a member of the project');

  // Starts on the meeting day (or the project start, if later) and ends on the due date (in working days).
  const meetingDay = meeting.startsAt.toISOString().slice(0, 10);
  const startDay = meetingDay > project.startDate ? meetingDay : project.startDate;
  let duration = 1;
  if (body.dueDate) {
    if (body.dueDate < startDay) throw badRequest('The due date must be on or after the meeting');
    duration = 0;
    for (let d = new Date(`${startDay}T00:00:00Z`); d.toISOString().slice(0, 10) <= body.dueDate && duration < 1000; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (project.workingDays.includes(d.getUTCDay()) && !project.holidays.includes(iso)) duration++;
    }
    duration = Math.max(1, duration);
  }
  const catalog = await getCatalog();
  const assignee = body.assignee ? new Types.ObjectId(body.assignee) : null;
  const task = newTask(project, req.user!._id, {
    name: body.title,
    duration,
    constraintStart: startDay,
    type: catalog.defaultType._id,
    status: catalog.defaultStatus._id,
    assignee,
    watchers: [...new Set([String(req.user!._id), ...(assignee ? [String(assignee)] : [])])].map((id) => new Types.ObjectId(id)),
    notes: sanitizeRichText(`<p>Action item from the meeting “${meeting.title}” (${meetingDay}), agenda item “${item.title}”.</p>`),
  });
  const result = await mutatePlan(project, req.user!, (tasks) => {
    tasks.push(task);
  });
  const created = result.tasks.find((t) => String(t._id) === String(task._id));
  if (created) await recordTaskCreated(project, req.user!, created);
  item.actions.push(task._id);
  await meeting.save();
  res.status(201).json({ meeting: await serialize(meeting), taskId: String(task._id) });
});

/** Emails the invitation (with an .ics calendar file) and notifies participants in the app. */
meetingsRouter.post('/:meetingId/invite', loadProject('manage_meetings'), async (req, res) => {
  const meeting = await loadMeeting(req);
  assertOpen(meeting);
  if (!meeting.participants.length) throw badRequest('Add participants first');
  if (meeting.status === 'draft') meeting.status = 'open';
  meeting.sequence = (meeting.sequence ?? 0) + 1;
  const people = await reachable(meeting.participants.map((p) => p.user));
  const organizer = (await User.findById(meeting.organizer).select('name email').lean()) ?? { name: req.user!.name, email: req.user!.email };
  const ics = meetingIcs(meeting, req.project!.name, organizer, people, 'REQUEST');
  const url = `${env.appUrl}${meetingLink(req.project!._id, meeting._id)}`;
  const lines = [
    `${req.user!.name} invited you to "${meeting.title}" (${req.project!.name}).`,
    `When: ${when(meeting.startsAt)} · ${meeting.durationMinutes} minutes`,
    ...(meeting.location ? [`Where: ${meeting.location}`] : []),
    ...(meeting.agenda.length ? [`Agenda:\n${meeting.agenda.map((a, i) => `${i + 1}. ${a.title}`).join('\n')}`] : []),
    'The attached calendar file adds it to Outlook or Google Calendar.',
  ];
  const { text, html } = renderEmail(`Meeting: ${meeting.title}`, lines, { label: 'Open meeting', url });
  for (const p of people) {
    await sendMail({ to: p.email!, subject: `Invitation: ${meeting.title} — ${when(meeting.startsAt)}`, text, html, attachments: [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=REQUEST; charset=utf-8' }] });
  }
  const now = new Date();
  for (const p of meeting.participants) p.invitedAt = now;
  await meeting.save();
  await notify(req, meeting, meeting.participants.map((p) => p.user), `invited you to ${meeting.title}`);
  res.json({ meeting: await serialize(meeting), emailed: people.length });
});

/** Locks the agenda and minutes and emails the minutes to participants. */
meetingsRouter.post('/:meetingId/close', loadProject('manage_meetings'), async (req, res) => {
  const body = parseBody(z.object({ minutes: richText(50000).optional() }), req.body);
  const meeting = await loadMeeting(req);
  assertOpen(meeting);
  if (body.minutes !== undefined) meeting.minutes = body.minutes;
  meeting.status = 'closed';
  meeting.closedAt = new Date();
  meeting.closedBy = req.user!._id;
  await meeting.save();

  const people = await reachable(meeting.participants.map((p) => p.user));
  const decisions = meeting.agenda.filter((a) => a.outcome).map((a) => `• ${a.title}: ${richTextToPlain(a.outcome)}`);
  const attended = meeting.participants.filter((p) => p.attended === true).length;
  const lines = [
    `Minutes of "${meeting.title}" (${req.project!.name}), held ${when(meeting.startsAt)}.`,
    `Attendance: ${attended} of ${meeting.participants.length}`,
    ...(meeting.minutes ? [richTextToPlain(meeting.minutes)] : []),
    ...(decisions.length ? [`Decisions:\n${decisions.join('\n')}`] : []),
  ];
  const { text, html } = renderEmail(`Minutes: ${meeting.title}`, lines, { label: 'Open meeting', url: `${env.appUrl}${meetingLink(req.project!._id, meeting._id)}` });
  // Keep the formatting of the minutes in the HTML email.
  const richHtml = meeting.minutes ? html.replace(richTextToPlain(meeting.minutes).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!), richTextToHtml(meeting.minutes)) : html;
  for (const p of people) await sendMail({ to: p.email!, subject: `Minutes: ${meeting.title}`, text, html: richHtml });
  await notify(req, meeting, meeting.participants.map((p) => p.user), `shared the minutes of ${meeting.title}`);
  res.json({ meeting: await serialize(meeting), emailed: people.length });
});

meetingsRouter.post('/:meetingId/reopen', loadProject('manage_meetings'), async (req, res) => {
  const meeting = await loadMeeting(req);
  if (meeting.status !== 'closed') throw badRequest('This meeting is not closed');
  meeting.status = 'open';
  meeting.closedAt = null;
  meeting.closedBy = null;
  await meeting.save();
  res.json({ meeting: await serialize(meeting) });
});

/** Calendar file for one meeting (add to Outlook / Google Calendar). */
meetingsRouter.get('/:meetingId/ics', loadProject('view_project'), async (req, res) => {
  const meeting = await loadMeeting(req);
  const [organizer, people] = await Promise.all([User.findById(meeting.organizer).select('name email').lean(), reachable(meeting.participants.map((p) => p.user))]);
  const ics = meetingIcs(meeting, req.project!.name, organizer ?? { name: 'Organiser' }, people, 'PUBLISH');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${meeting.title.replace(/[^\w\- ]+/g, '').trim() || 'meeting'}.ics"`);
  res.send(ics);
});
