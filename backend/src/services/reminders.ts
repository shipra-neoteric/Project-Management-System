import type { Types } from 'mongoose';
import { env } from '../config/env';
import { Notification } from '../models/Notification';
import { Project } from '../models/Project';
import { ReminderLog } from '../models/Reminder';
import { Task } from '../models/Task';
import { reminderPrefs, User } from '../models/User';
import { addDays, parseISODate, todayISO } from '../scheduling/calendar';
import { renderEmail, sendMail } from './mailer';
import { accessFor, attachAccessMany, loadRoles } from './permissions';

/** Furthest ahead anyone can ask to be reminded (see the user preference limit). */
const MAX_DAYS = 14;

export interface ReminderStats {
  checkedTasks: number;
  notifications: number;
  emails: number;
}

const daysBetween = (from: string, to: string) => Math.round((parseISODate(to) - parseISODate(from)) / 86_400_000);
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function relative(days: number, verb: 'Starts' | 'Due', date: string) {
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow (${fmt(date)})`;
  return `${verb} in ${days} days (${fmt(date)})`;
}

/** Inserts the marker; false when this alert was already sent. */
async function firstTime(user: Types.ObjectId, task: Types.ObjectId | null, kind: 'start' | 'finish' | 'overdue' | 'digest', key: string) {
  try {
    await ReminderLog.create({ user, task, kind, key });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/**
 * Creates "due soon" and "overdue" notifications for open tasks people are assigned to,
 * accountable for or watch (per their preferences), and sends daily digest emails. Safe to run as
 * often as you like: every alert is sent once.
 */
export async function runReminders(today = todayISO()): Promise<ReminderStats> {
  const stats: ReminderStats = { checkedTasks: 0, notifications: 0, emails: 0 };
  const users = await User.find({ isActive: true, kind: { $ne: 'placeholder' }, invited: { $ne: true } });
  if (!users.length) return stats;
  await loadRoles();
  await attachAccessMany(users);
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const ids = users.map((u) => u._id);
  const horizon = addDays(today, MAX_DAYS);

  const tasks = await Task.find({
    isSummary: false,
    percentComplete: { $lt: 100 },
    $and: [
      { $or: [{ finish: { $lt: today, $gt: '' } }, { start: { $gte: today, $lte: horizon } }, { finish: { $gte: today, $lte: horizon } }] },
      { $or: [{ assignee: { $in: ids } }, { accountable: { $in: ids } }, { watchers: { $in: ids } }] },
    ],
  })
    .select('project name number start finish isMilestone percentComplete assignee accountable watchers')
    .lean();
  stats.checkedTasks = tasks.length;
  if (!tasks.length) return stats;

  const projects = await Project.find({ _id: { $in: [...new Set(tasks.map((t) => String(t.project)))] }, isTemplate: { $ne: true }, status: { $nin: ['archived', 'completed'] } });
  const projectById = new Map(projects.map((p) => [String(p._id), p]));

  type Item = { project: string; projectName: string; key: string; task: string; name: string; message: string; overdue: boolean };
  const digest = new Map<string, Item[]>();
  const notifications: Record<string, unknown>[] = [];

  for (const t of tasks) {
    const project = projectById.get(String(t.project));
    if (!project) continue;
    const roles = new Map<string, { assigned: boolean; accountable: boolean; watched: boolean }>();
    const mark = (id: unknown, role: 'assigned' | 'accountable' | 'watched') => {
      const k = String(id);
      if (!byId.has(k)) return;
      roles.set(k, { ...(roles.get(k) ?? { assigned: false, accountable: false, watched: false }), [role]: true });
    };
    if (t.assignee) mark(t.assignee, 'assigned');
    if (t.accountable) mark(t.accountable, 'accountable');
    for (const w of t.watchers ?? []) mark(w, 'watched');

    for (const [uid, role] of roles) {
      const user = byId.get(uid)!;
      const prefs = reminderPrefs(user);
      if (!((role.assigned && prefs.assigned) || (role.accountable && prefs.accountable) || (role.watched && prefs.watched))) continue;
      if (!accessFor(project, user)) continue;

      const alerts: { kind: 'start' | 'finish' | 'overdue'; key: string; message: string; reason: 'due_soon' | 'overdue' }[] = [];
      if (t.finish && t.finish < today) {
        if (prefs.overdue) alerts.push({ kind: 'overdue', key: t.finish, message: `Overdue since ${fmt(t.finish)} (${t.percentComplete}% done)`, reason: 'overdue' });
      } else if (prefs.dueSoonDays > 0) {
        const untilFinish = daysBetween(today, t.finish);
        const untilStart = daysBetween(today, t.start);
        if (untilFinish >= 0 && untilFinish <= prefs.dueSoonDays) {
          alerts.push({ kind: 'finish', key: t.finish, message: relative(untilFinish, 'Due', t.finish), reason: 'due_soon' });
        } else if (!t.isMilestone && t.percentComplete === 0 && untilStart >= 0 && untilStart <= prefs.dueSoonDays) {
          alerts.push({ kind: 'start', key: t.start, message: relative(untilStart, 'Starts', t.start), reason: 'due_soon' });
        }
      }

      for (const a of alerts) {
        const item: Item = {
          project: String(project._id),
          projectName: project.name,
          key: project.key && t.number ? `${project.key}-${t.number}` : '',
          task: String(t._id),
          name: t.name,
          message: a.message,
          overdue: a.kind === 'overdue',
        };
        if (prefs.digest) digest.set(uid, [...(digest.get(uid) ?? []), item]);
        if (!(await firstTime(user._id, t._id, a.kind, a.key))) continue;
        notifications.push({
          recipient: user._id,
          actor: null,
          project: project._id,
          projectName: project.name,
          task: t._id,
          taskName: t.name,
          reason: a.reason,
          summary: a.message,
        });
      }
    }
  }
  if (notifications.length) await Notification.insertMany(notifications);
  stats.notifications = notifications.length;

  // One digest email per person per day.
  for (const [uid, items] of digest) {
    const user = byId.get(uid)!;
    if (!user.email || user.notifyByEmail === false) continue;
    if (!(await firstTime(user._id, null, 'digest', today))) continue;
    const overdue = items.filter((i) => i.overdue);
    const soon = items.filter((i) => !i.overdue);
    const line = (i: Item) => `• ${i.key ? `${i.key} ` : ''}${i.name} — ${i.message} [${i.projectName}]`;
    const lines = [
      ...(overdue.length ? [`Overdue (${overdue.length}):`, ...overdue.slice(0, 25).map(line)] : []),
      ...(soon.length ? [`Coming up (${soon.length}):`, ...soon.slice(0, 25).map(line)] : []),
    ];
    const { text, html } = renderEmail(`Your tasks for ${fmt(today)}`, lines, { label: 'Open my tasks', url: `${env.appUrl}/dashboard` });
    void sendMail({ to: user.email, subject: `Task reminders: ${overdue.length} overdue, ${soon.length} coming up`, text, html });
    stats.emails++;
  }
  return stats;
}

let timer: NodeJS.Timeout | null = null;

/** Runs the reminder job every hour inside the API process (plus once shortly after start). */
export function startReminderSchedule() {
  if (timer) return;
  const run = () =>
    runReminders()
      .then((s) => s.notifications + s.emails > 0 && console.log(`[reminders] ${s.notifications} notifications, ${s.emails} digest emails`))
      .catch((err) => console.error('[reminders] failed', err));
  setTimeout(run, 60_000).unref();
  timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
}
