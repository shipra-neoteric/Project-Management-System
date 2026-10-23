import type { Types } from 'mongoose';
import { env } from '../config/env';
import { roleFor } from '../middleware/projectAccess';
import { Journal, type JournalKind } from '../models/Journal';
import { Notification, NOTIFICATION_REASONS, type NotificationReason } from '../models/Notification';
import type { ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import type { PlanTask } from '../models/Task';
import { User, type UserDoc } from '../models/User';
import { getCatalog } from './catalog';
import { renderEmail, sendMail } from './mailer';

/** Fields whose changes are recorded in a task's history, in display order. */
const TRACKED: { field: keyof PlanTask; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'type', label: 'Type' },
  { field: 'status', label: 'Status' },
  { field: 'priority', label: 'Priority' },
  { field: 'assignee', label: 'Assignee' },
  { field: 'accountable', label: 'Accountable' },
  { field: 'category', label: 'Category' },
  { field: 'duration', label: 'Duration' },
  { field: 'constraintStart', label: 'Start no earlier than' },
  { field: 'percentComplete', label: '% complete' },
  { field: 'predecessors', label: 'Predecessors' },
  { field: 'resources', label: 'Resources' },
  { field: 'manual', label: 'Scheduling mode' },
  { field: 'relations', label: 'Related tasks' },
  { field: 'notes', label: 'Notes' },
];

const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', immediate: 'Immediate' };
const MENTION = /@\[([^\]]{1,80})\]\(([a-f0-9]{24})\)/g;

/** Plain-text version of a comment (mention markup → @Name). */
export const commentPlainText = (text: string) => text.replace(MENTION, '@$1');

export function parseMentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[2]))];
}

const sid = (v: unknown) => (v == null ? '' : String(v));

/** Resolves ids to readable names for history entries. */
async function buildNames(project: ProjectDoc, tasks: PlanTask[]) {
  const catalog = await getCatalog();
  const userIds = [project.owner, ...project.members.map((m) => m.user)];
  const [users, resources] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name').lean(),
    Resource.find({ project: project._id }).select('name').lean(),
  ]);
  const maps = {
    type: new Map(catalog.types.map((t) => [String(t._id), t.name])),
    status: new Map(catalog.statuses.map((s) => [String(s._id), s.name])),
    user: new Map(users.map((u) => [String(u._id), u.name])),
    resource: new Map(resources.map((r) => [String(r._id), r.name])),
    category: new Map(project.categories.map((c) => [String(c._id), c.name])),
    task: new Map(tasks.map((t) => [String(t._id), `#${t.rowNumber} ${t.name}`])),
  };
  return { catalog, maps };
}

/** Readable value of a custom field. */
function customDisplay(catalog: Awaited<ReturnType<typeof getCatalog>>, fieldId: string, value: unknown, names: { user: Map<string, string> }): string {
  const field = catalog.customFields.find((f) => String(f._id) === fieldId);
  if (!field || value == null || value === '') return '';
  const option = (id: unknown) => field.options.find((o) => String(o._id) === String(id))?.name ?? '?';
  switch (field.kind) {
    case 'select': return option(value);
    case 'multiselect': return (value as unknown[]).map(option).join(', ');
    case 'boolean': return value ? 'Yes' : 'No';
    case 'user': return names.user.get(String(value)) ?? 'Unknown user';
    default: return String(value);
  }
}
type Names = Awaited<ReturnType<typeof buildNames>>['maps'];

function display(field: keyof PlanTask, value: unknown, names: Names): string {
  if (value == null || value === '') return '';
  switch (field) {
    case 'type': return names.type.get(sid(value)) ?? '';
    case 'status': return names.status.get(sid(value)) ?? '';
    case 'assignee':
    case 'accountable': return names.user.get(sid(value)) ?? 'Unknown user';
    case 'category': return names.category.get(sid(value)) ?? '';
    case 'priority': return PRIORITY_LABELS[String(value)] ?? String(value);
    case 'duration': return `${value} day${value === 1 ? '' : 's'}`;
    case 'percentComplete': return `${value}%`;
    case 'resources': return (value as Types.ObjectId[]).map((r) => names.resource.get(sid(r)) ?? '?').join(', ');
    case 'predecessors':
      return (value as PlanTask['predecessors'])
        .map((l) => `${names.task.get(sid(l.task)) ?? '?'}${l.type !== 'FS' ? ` ${l.type}` : ''}${l.lag ? ` ${l.lag > 0 ? '+' : ''}${l.lag}d` : ''}`)
        .join(', ');
    case 'notes': return String(value).length > 120 ? `${String(value).slice(0, 117)}…` : String(value);
    case 'manual': return value ? 'Manual' : 'Automatic';
    case 'relations': return (value as PlanTask['relations']).map((r) => `${r.type} ${names.task.get(sid(r.task)) ?? '?'}`).join(', ');
    default: return String(value);
  }
}

const comparable = (field: keyof PlanTask, value: unknown) =>
  field === 'predecessors'
    ? JSON.stringify(((value as PlanTask['predecessors']) ?? []).map((l) => [sid(l.task), l.type, l.lag]))
    : field === 'relations'
      ? JSON.stringify(((value as PlanTask['relations']) ?? []).map((r) => [sid(r.task), r.type]))
      : field === 'manual'
        ? JSON.stringify(!!value)
        : JSON.stringify(value ?? null);

// ---- Notifications --------------------------------------------------------------------------------

const rank = (r: NotificationReason) => NOTIFICATION_REASONS.indexOf(r);

/** Collects the most important reason per recipient. */
class Recipients {
  private readonly map = new Map<string, NotificationReason>();
  add(userId: unknown, reason: NotificationReason) {
    const id = sid(userId);
    if (!id) return;
    const current = this.map.get(id);
    if (!current || rank(reason) < rank(current)) this.map.set(id, reason);
  }
  addAll(ids: unknown[], reason: NotificationReason) {
    ids.forEach((id) => this.add(id, reason));
  }
  entries() {
    return [...this.map.entries()];
  }
}

const REASON_TEXT: Record<NotificationReason, string> = {
  mentioned: 'mentioned you',
  assigned: 'assigned you',
  accountable: 'made you accountable for',
  commented: 'commented on',
  updated: 'updated',
  watched: 'updated',
};

async function notify(
  project: ProjectDoc,
  actor: UserDoc,
  task: { _id: Types.ObjectId | null; name: string },
  journalId: Types.ObjectId,
  recipients: Recipients,
  summary: string,
) {
  const entries = recipients.entries().filter(([id]) => id !== actor._id.toString());
  if (!entries.length) return;
  const users = await User.find({ _id: { $in: entries.map(([id]) => id) }, isActive: true });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const allowed = entries.filter(([id]) => {
    const u = byId.get(id);
    return u && roleFor(project, u);
  });
  if (!allowed.length) return;

  await Notification.insertMany(
    allowed.map(([id, reason]) => ({
      recipient: id,
      actor: actor._id,
      project: project._id,
      projectName: project.name,
      task: task._id,
      taskName: task.name,
      journal: journalId,
      reason,
      summary,
    })),
  );

  const link = `${env.appUrl}/projects/${project._id}${task._id ? `?task=${task._id}` : ''}`;
  for (const [id, reason] of allowed) {
    const u = byId.get(id)!;
    if (u.notifyByEmail === false) continue;
    const title = `${actor.name} ${REASON_TEXT[reason]} "${task.name}"`;
    const { text, html } = renderEmail(title, [`Project: ${project.name}`, summary].filter(Boolean), { label: 'Open task', url: link });
    void sendMail({ to: u.email, subject: `[${project.name}] ${title}`, text, html });
  }
}

// ---- Public API ---------------------------------------------------------------------------------

async function writeJournal(project: ProjectDoc, actor: UserDoc, task: { _id: Types.ObjectId | null; name: string }, kind: JournalKind, extra: object = {}) {
  return Journal.create({ project: project._id, task: task._id, taskName: task.name, user: actor._id, kind, ...extra });
}

export async function recordTaskCreated(project: ProjectDoc, actor: UserDoc, task: PlanTask, text = '') {
  const journal = await writeJournal(project, actor, task, 'created', { text });
  const recipients = new Recipients();
  recipients.add(task.assignee, 'assigned');
  recipients.add(task.accountable, 'accountable');
  await notify(project, actor, task, journal._id, recipients, 'New task created');
}

export async function recordTaskDeleted(project: ProjectDoc, actor: UserDoc, task: PlanTask, text = '') {
  await writeJournal(project, actor, task, 'deleted', { text });
}

/** Records field changes made by a user (not schedule recalculations) and notifies people involved. */
export async function recordTaskUpdated(project: ProjectDoc, actor: UserDoc, before: PlanTask, after: PlanTask, tasks: PlanTask[]) {
  const { catalog, maps } = await buildNames(project, tasks);
  const changes: { field: string; label: string; from: string; to: string }[] = TRACKED.filter(({ field }) => comparable(field, before[field]) !== comparable(field, after[field])).map(({ field, label }) => ({
    field,
    label,
    from: display(field, before[field], maps),
    to: display(field, after[field], maps),
  }));
  const bv = before.customValues ?? {};
  const av = after.customValues ?? {};
  for (const id of new Set([...Object.keys(bv), ...Object.keys(av)])) {
    if (JSON.stringify(bv[id] ?? null) === JSON.stringify(av[id] ?? null)) continue;
    const field = catalog.customFields.find((f) => String(f._id) === id);
    if (!field) continue;
    changes.push({ field: `custom:${id}`, label: field.name, from: customDisplay(catalog, id, bv[id], maps), to: customDisplay(catalog, id, av[id], maps) });
  }
  if (!changes.length) return;
  const journal = await writeJournal(project, actor, after, 'change', { changes });

  const recipients = new Recipients();
  recipients.addAll(after.watchers, 'watched');
  recipients.add(after.assignee, 'updated');
  recipients.add(after.accountable, 'updated');
  if (sid(before.assignee) !== sid(after.assignee)) recipients.add(after.assignee, 'assigned');
  if (sid(before.accountable) !== sid(after.accountable)) recipients.add(after.accountable, 'accountable');
  const summary = changes.map((c) => `${c.label}: ${c.from || '—'} → ${c.to || '—'}`).join('\n');
  await notify(project, actor, after, journal._id, recipients, summary);
}

export async function recordComment(project: ProjectDoc, actor: UserDoc, task: PlanTask, text: string) {
  const mentions = parseMentions(text);
  const journal = await writeJournal(project, actor, task, 'comment', { text, mentions });
  const recipients = new Recipients();
  recipients.addAll(task.watchers, 'commented');
  recipients.add(task.assignee, 'commented');
  recipients.add(task.accountable, 'commented');
  recipients.addAll(mentions, 'mentioned');
  const plain = commentPlainText(text);
  await notify(project, actor, task, journal._id, recipients, plain.length > 300 ? `${plain.slice(0, 297)}…` : plain);
  return journal;
}

export async function recordAttachment(project: ProjectDoc, actor: UserDoc, task: PlanTask, text: string) {
  const journal = await writeJournal(project, actor, task, 'attachment', { text });
  const recipients = new Recipients();
  recipients.addAll(task.watchers, 'watched');
  recipients.add(task.assignee, 'updated');
  await notify(project, actor, task, journal._id, recipients, text);
}
