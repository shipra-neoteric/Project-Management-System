'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckSquare,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Presentation,
  Repeat,
  Send,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { RichTextEditor, RichTextView } from '@/components/ui/RichTextEditor';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import {
  FREQUENCY_LABEL,
  fmtMeetingTime,
  icsPath,
  useMeeting,
  useMeetingMutations,
  type AgendaInput,
  type Meeting,
  type MeetingStatus,
  type Scope,
} from '@/features/meetings';
import { useWorkspace } from '@/features/project-context';
import { confirmAction, confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { apiDownload, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { isRichTextEmpty } from '@/lib/richText';
import { useTheme } from '@/lib/theme';
import { MeetingFormDrawer } from './MeetingForm';

export const MEETING_STATUS: Record<MeetingStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Invited', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
};

/** "Only this meeting" or "this and following" for meetings in a series. */
export async function askSeriesScope(action: 'Change' | 'Delete'): Promise<Scope | null> {
  const Swal = (await import('sweetalert2')).default;
  const res = await Swal.fire({
    title: `${action} recurring meeting`,
    input: 'radio',
    inputOptions: { this: 'Only this meeting', future: 'This and all following meetings' },
    inputValue: 'this',
    showCancelButton: true,
    confirmButtonText: action,
    confirmButtonColor: action === 'Delete' ? '#ef4444' : undefined,
    reverseButtons: true,
  });
  return res.isConfirmed ? (res.value as Scope) : null;
}

type DraftItem = AgendaInput & { key: string; actions: Meeting['agenda'][number]['actions'] };
let keySeq = 0;
const toDraft = (m: Meeting): DraftItem[] =>
  m.agenda.map((a) => ({
    key: a._id,
    _id: a._id,
    title: a.title,
    notes: a.notes,
    durationMinutes: a.durationMinutes,
    presenter: a.presenter?._id ?? null,
    task: a.task?._id ?? null,
    outcome: a.outcome,
    actions: a.actions,
  }));

export function MeetingDetailDrawer({ projectId, meetingId, onClose }: { projectId: string; meetingId: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useMeeting(projectId, meetingId);
  const meeting = data?.meeting;
  return (
    <Drawer
      open={!!meetingId}
      onClose={onClose}
      title={meeting?.title ?? 'Meeting'}
      subtitle={meeting ? fmtMeetingTime(meeting.startsAt, meeting.durationMinutes) : undefined}
      icon={Presentation}
      width="lg"
    >
      {isLoading || !data ? error ? <Alert>{errorMessage(error)}</Alert> : <PageLoader /> : <MeetingBody projectId={projectId} data={data} onDeleted={onClose} />}
    </Drawer>
  );
}

function MeetingBody({
  projectId,
  data,
  onDeleted,
}: {
  projectId: string;
  data: NonNullable<ReturnType<typeof useMeeting>['data']>;
  onDeleted: () => void;
}) {
  const { meeting, series, canManage, canCreateTasks } = data;
  const { user } = useAuth();
  const { ctx, tasks, openTask } = useWorkspace();
  const { themeColor } = useTheme();
  const m = useMeetingMutations(projectId);
  const people = useMemo(() => [...(ctx?.people.values() ?? [])], [ctx]);
  const closed = meeting.status === 'closed';
  const editable = canManage && !closed;
  const [editOpen, setEditOpen] = useState(false);

  const [items, setItems] = useState<DraftItem[]>(() => toDraft(meeting));
  const [agendaDirty, setAgendaDirty] = useState(false);
  const [minutes, setMinutes] = useState(meeting.minutes);
  const [minutesDirty, setMinutesDirty] = useState(false);

  // Follow server changes unless the user has unsaved edits.
  useEffect(() => {
    if (!agendaDirty) setItems(toDraft(meeting));
    if (!minutesDirty) setMinutes(meeting.minutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting]);

  const run = async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)) => {
    try {
      const r = await fn();
      if (success) void toastSuccess(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (err) {
      void toastError(errorMessage(err));
      return undefined;
    }
  };

  const changeItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setAgendaDirty(true);
  };
  const move = (index: number, delta: -1 | 1) => {
    setItems((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
    setAgendaDirty(true);
  };
  const addItem = () => {
    setItems((list) => [...list, { key: `new-${++keySeq}`, title: '', notes: '', durationMinutes: 10, presenter: null, task: null, outcome: '', actions: [] }]);
    setAgendaDirty(true);
  };
  const removeItem = async (item: DraftItem) => {
    if (item.actions.length && !(await confirmDanger('Remove this agenda item?', 'Its action items stay in the plan as tasks.', 'Remove'))) return;
    setItems((list) => list.filter((i) => i.key !== item.key));
    setAgendaDirty(true);
  };
  const saveAgenda = async () => {
    if (items.some((i) => !i.title.trim())) return void toastError('Give every agenda item a title');
    const agenda = items.map(({ key: _k, actions: _a, ...rest }) => ({ ...rest, title: rest.title.trim() }));
    const ok = await run(() => m.update.mutateAsync({ id: meeting._id, agenda }), 'Agenda saved');
    if (ok) setAgendaDirty(false);
  };
  const saveMinutes = async () => {
    const ok = await run(() => m.update.mutateAsync({ id: meeting._id, minutes }), 'Minutes saved');
    if (ok) setMinutesDirty(false);
  };

  const planned = items.reduce((a, i) => a + (i.durationMinutes ?? 0), 0);
  const over = planned > meeting.durationMinutes;
  const me = meeting.participants.find((p) => p.user?._id === user?._id);
  const attendedCount = meeting.participants.filter((p) => p.attended === true).length;
  const taskOptions = useMemo(
    () => [{ value: '', label: 'No linked task' }, ...tasks.filter((t) => !t.isSummary).map((t) => ({ value: t._id, label: t.name, description: t.number ? `#${t.number}` : undefined }))],
    [tasks],
  );
  const presenterOptions = [{ value: '', label: 'No presenter' }, ...people.map((p) => ({ value: p._id, label: p.name }))];

  const invite = async () => {
    if (agendaDirty) await saveAgenda();
    const again = meeting.participants.some((p) => p.invitedAt);
    if (again && !(await confirmAction('Send the invitation again?', 'Everyone gets an updated invitation with the calendar file.', 'Send', themeColor))) return;
    await run(() => m.invite.mutateAsync(meeting._id), (r) => (r.emailed ? `Invitation emailed to ${r.emailed} ${r.emailed === 1 ? 'person' : 'people'}` : 'Participants notified in the app'));
  };
  const close = async () => {
    if (agendaDirty) await saveAgenda();
    if (!(await confirmAction('Close the meeting?', 'The agenda and minutes are locked and the minutes are emailed to every participant.', 'Close & send minutes', themeColor))) return;
    const ok = await run(() => m.close.mutateAsync({ id: meeting._id, minutes }), 'Meeting closed and minutes sent');
    if (ok) setMinutesDirty(false);
  };
  const remove = async () => {
    const scope = meeting.seriesId ? await askSeriesScope('Delete') : (await confirmDanger(`Delete “${meeting.title}”?`, 'The agenda and minutes are deleted. Action items stay in the plan.')) ? 'this' : null;
    if (!scope) return;
    const ok = await run(() => m.remove.mutateAsync({ id: meeting._id, scope }), (r) => (r.deleted > 1 ? `Deleted ${r.deleted} meetings` : 'Meeting deleted'));
    if (ok) onDeleted();
  };

  return (
    <div className="space-y-6">
      {/* Summary + actions */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={MEETING_STATUS[meeting.status].tone} dot>
            {MEETING_STATUS[meeting.status].label}
          </Badge>
          {meeting.recurrence && (
            <Badge tone="purple">
              <Repeat className="w-3 h-3" /> {FREQUENCY_LABEL[meeting.recurrence.frequency]} until {fmtDate(meeting.recurrence.until)}
            </Badge>
          )}
          {closed && meeting.closedAt && (
            <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" /> Closed {fmtDateTime(meeting.closedAt)}
              {meeting.closedBy ? ` by ${meeting.closedBy.name}` : ''}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <Info icon={CalendarDays} label="When" value={fmtMeetingTime(meeting.startsAt, meeting.durationMinutes)} />
          <Info icon={MapPin} label="Where" value={meeting.location || '—'} />
          <Info icon={UserCheck} label="Organiser" value={meeting.organizer?.name ?? '—'} />
        </dl>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
              Edit details
            </Button>
          )}
          {editable && (
            <Button size="sm" icon={Send} onClick={invite} loading={m.invite.isPending}>
              {meeting.participants.some((p) => p.invitedAt) ? 'Resend invites' : 'Send invites'}
            </Button>
          )}
          <Button
            size="sm"
            icon={Download}
            onClick={() => void apiDownload(icsPath(projectId, meeting._id), `${meeting.title.replace(/[^\w\- ]+/g, '').trim() || 'meeting'}.ics`).catch((err) => toastError(errorMessage(err)))}
          >
            Add to calendar (.ics)
          </Button>
          {editable && (
            <Button size="sm" variant="primary" icon={Lock} onClick={close} loading={m.close.isPending}>
              Close & send minutes
            </Button>
          )}
          {canManage && closed && (
            <Button size="sm" icon={Unlock} onClick={() => void run(() => m.reopen.mutateAsync(meeting._id), 'Meeting reopened')}>
              Reopen
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="danger" icon={Trash2} onClick={remove}>
              Delete
            </Button>
          )}
        </div>
        {series.length > 1 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Meeting {series.findIndex((s) => s._id === meeting._id) + 1} of {series.length} in this series.
          </p>
        )}
      </section>

      {/* Participants */}
      <section>
        <Sec title={`Participants · ${attendedCount} of ${meeting.participants.length} attended`} icon={Users} />
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-lg">
          {meeting.participants.map((p, i) => {
            const mine = p.user?._id === user?._id;
            const canMark = !closed && (canManage || mine);
            return (
              <li key={p.user?._id ?? `former-${i}`} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate block">
                    {p.user?.name ?? 'Former user'}
                    {mine && <span className="text-gray-400 font-normal"> (you)</span>}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {p.user?.kind === 'placeholder' ? 'Placeholder — no email' : p.invitedAt ? `Invited ${fmtDateTime(p.invitedAt)}` : 'Not invited yet'}
                  </span>
                </span>
                <div className="flex items-center gap-1" role="group" aria-label={`Attendance of ${p.user?.name ?? 'participant'}`}>
                  {(
                    [
                      [true, 'Present', Check, 'text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400'],
                      [false, 'Absent', X, 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400'],
                    ] as const
                  ).map(([value, label, Icon, activeCls]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={!canMark || !p.user}
                      aria-pressed={p.attended === value}
                      onClick={() => void run(() => m.attendance.mutateAsync({ id: meeting._id, userId: p.user!._id, attended: p.attended === value ? null : value }))}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed',
                        p.attended === value ? activeCls : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:hover:bg-transparent',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {!me && !canManage && <p className="text-xs text-gray-400 mt-2">You are not a participant of this meeting.</p>}
      </section>

      {/* Agenda */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <Sec title="Agenda" icon={ClipboardList} className="mb-0 pb-0 border-0 flex-1" />
          {editable && agendaDirty && (
            <Button size="sm" variant="primary" icon={Check} onClick={saveAgenda} loading={m.update.isPending}>
              Save agenda
            </Button>
          )}
        </div>
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {planned} of {meeting.durationMinutes} min planned
            </span>
            {over && <span className="text-red-600 dark:text-red-400 font-medium">{planned - meeting.durationMinutes} min over</span>}
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden" role="progressbar" aria-valuenow={planned} aria-valuemax={meeting.durationMinutes} aria-label="Agenda time">
            <div className={cn('h-full rounded-full', over && 'bg-red-500')} style={{ width: `${Math.min(100, (planned / Math.max(1, meeting.durationMinutes)) * 100)}%`, ...(over ? {} : { backgroundColor: themeColor }) }} />
          </div>
        </div>

        {items.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No agenda items yet.</p>}
        <ol className="space-y-3">
          {items.map((item, index) => (
            <li key={item.key} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 bg-white dark:bg-gray-800">
              {editable ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 text-xs font-bold text-gray-400 w-5 shrink-0">{index + 1}.</span>
                    <input
                      className={cn(inputCls, 'font-medium')}
                      value={item.title}
                      onChange={(e) => changeItem(item.key, { title: e.target.value })}
                      placeholder="Agenda item"
                      aria-label={`Agenda item ${index + 1} title`}
                    />
                    <IconButton icon={ArrowUp} label="Move up" disabled={index === 0} onClick={() => move(index, -1)} />
                    <IconButton icon={ArrowDown} label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)} />
                    <IconButton icon={Trash2} label="Remove item" tone="delete" onClick={() => void removeItem(item)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr] gap-3">
                    <Field label="Minutes">
                      <input
                        type="number"
                        min={0}
                        max={600}
                        className={inputCls}
                        value={item.durationMinutes ?? 0}
                        onChange={(e) => changeItem(item.key, { durationMinutes: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
                      />
                    </Field>
                    <Field label="Presenter">
                      <ThemedSelect options={presenterOptions} value={item.presenter ?? ''} onChange={(v) => changeItem(item.key, { presenter: v || null })} searchable />
                    </Field>
                    <Field label="About task">
                      <ThemedSelect options={taskOptions} value={item.task ?? ''} onChange={(v) => changeItem(item.key, { task: v || null })} searchable />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <RichTextEditor value={item.notes ?? ''} onChange={(html) => changeItem(item.key, { notes: html })} placeholder="Background, questions to discuss…" minHeight="min-h-16" />
                  </Field>
                  <Field label="Outcome / decision">
                    <RichTextEditor value={item.outcome ?? ''} onChange={(html) => changeItem(item.key, { outcome: html })} placeholder="What was decided?" minHeight="min-h-16" />
                  </Field>
                </div>
              ) : (
                <ReadOnlyItem index={index} item={item} people={people} tasks={tasks} onOpenTask={openTask} />
              )}
              <ActionItems
                item={item}
                canAdd={editable && canCreateTasks && !!item._id}
                needsSave={editable && !item._id}
                people={people}
                meetingDay={meeting.startsAt}
                onOpenTask={openTask}
                onAdd={(body) => run(() => m.addAction.mutateAsync({ id: meeting._id, itemId: item._id!, ...body }), 'Action item added to the plan')}
              />
            </li>
          ))}
        </ol>
        {editable && (
          <Button size="sm" icon={Plus} className="mt-3" onClick={addItem}>
            Add agenda item
          </Button>
        )}
      </section>

      {/* Minutes */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <Sec title="Minutes" icon={FileText} className="mb-0 pb-0 border-0 flex-1" />
          {editable && minutesDirty && (
            <Button size="sm" variant="primary" icon={Check} onClick={saveMinutes} loading={m.update.isPending}>
              Save minutes
            </Button>
          )}
        </div>
        {editable ? (
          <RichTextEditor
            value={minutes}
            onChange={(html) => {
              setMinutes(html);
              setMinutesDirty(true);
            }}
            placeholder="Summary of the discussion, decisions and next steps…"
            minHeight="min-h-40"
          />
        ) : (
          <RichTextView value={meeting.minutes} empty={<p className="text-sm text-gray-400 dark:text-gray-500">No minutes recorded.</p>} />
        )}
      </section>

      <MeetingFormDrawer open={editOpen} onClose={() => setEditOpen(false)} projectId={projectId} people={people} meeting={meeting} askScope={() => askSeriesScope('Change')} />
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</dt>
        <dd className="text-gray-800 dark:text-gray-100 break-words">{value}</dd>
      </div>
    </div>
  );
}

function ReadOnlyItem({
  index,
  item,
  people,
  tasks,
  onOpenTask,
}: {
  index: number;
  item: DraftItem;
  people: { _id: string; name: string }[];
  tasks: { _id: string; name: string }[];
  onOpenTask: (id: string) => void;
}) {
  const presenter = people.find((p) => p._id === item.presenter);
  const task = tasks.find((t) => t._id === item.task);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {index + 1}. {item.title}
        </p>
        <span className="text-xs text-gray-400 whitespace-nowrap">{item.durationMinutes ?? 0} min</span>
      </div>
      {(presenter || task) && (
        <p className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3">
          {presenter && <span>Presenter: {presenter.name}</span>}
          {task && (
            <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => onOpenTask(task._id)}>
              Task: {task.name}
            </button>
          )}
        </p>
      )}
      <RichTextView value={item.notes} />
      {!isRichTextEmpty(item.outcome) && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/40 px-3 py-2">
          <p className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase tracking-widest mb-1">Outcome</p>
          <RichTextView value={item.outcome} />
        </div>
      )}
    </div>
  );
}

function ActionItems({
  item,
  canAdd,
  needsSave,
  people,
  meetingDay,
  onOpenTask,
  onAdd,
}: {
  item: DraftItem;
  canAdd: boolean;
  needsSave: boolean;
  people: { _id: string; name: string }[];
  meetingDay: string;
  onOpenTask: (id: string) => void;
  onAdd: (body: { title: string; assignee: string | null; dueDate: string | null }) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const minDue = meetingDay.slice(0, 10);
  if (!item.actions.length && !canAdd && !needsSave) return null;

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const ok = await onAdd({ title: title.trim(), assignee: assignee || null, dueDate: due || null });
    setBusy(false);
    if (ok) {
      setTitle('');
      setAssignee('');
      setDue('');
      setAdding(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-700">
      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <CheckSquare className="w-3 h-3" /> Action items ({item.actions.length})
      </p>
      {item.actions.length > 0 && (
        <ul className="space-y-1 mb-2">
          {item.actions.map((a) => (
            <li key={a._id} className="flex items-center gap-2 text-sm">
              <span className={cn('w-2 h-2 rounded-full shrink-0', a.percentComplete >= 100 ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600')} aria-hidden />
              <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline truncate text-left" onClick={() => onOpenTask(a._id)}>
                {a.number ? `#${a.number} ` : ''}
                {a.name}
              </button>
              <span className="text-xs text-gray-400 whitespace-nowrap ml-auto">
                {people.find((p) => p._id === a.assignee)?.name ?? 'Unassigned'} · due {fmtDate(a.finish)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {needsSave && <p className="text-xs text-gray-400">Save the agenda to add action items to this item.</p>}
      {canAdd &&
        (adding ? (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px_150px_auto] gap-2 items-end">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" aria-label="Action item" autoFocus />
            <ThemedSelect options={[{ value: '', label: 'Unassigned' }, ...people.map((p) => ({ value: p._id, label: p.name }))]} value={assignee} onChange={setAssignee} searchable compact />
            <input type="date" className={inputCls} value={due} min={minDue} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
            <div className="flex gap-1">
              <Button size="sm" variant="primary" icon={Plus} disabled={!title.trim()} loading={busy} onClick={submit}>
                Add
              </Button>
              <IconButton icon={X} label="Cancel" onClick={() => setAdding(false)} />
            </div>
          </div>
        ) : (
          <button type="button" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1" onClick={() => setAdding(true)}>
            <Plus className="w-3 h-3" /> Add action item (creates a task)
          </button>
        ))}
    </div>
  );
}
