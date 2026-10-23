'use client';

import { Bell, BellOff, CalendarRange, ClipboardList, GitBranch, Link2, ListPlus, Plus, StickyNote, Tag, Trash2, Users, X } from 'lucide-react';
import { CustomFieldInput, isEmptyValue } from '@/components/ui/CustomFieldInput';
import { FilterTabs } from '@/components/ui/Layout';
import { useCommentMutations, useTaskActivity } from '@/features/queries';
import { useAuth } from '@/lib/auth';
import { atLeast } from '@/lib/status';
import { isTransitionAllowed } from '@/lib/workflow';
import { TaskActivityPanel, TaskFilesPanel } from './TaskPanels';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls, Sec, textareaCls } from '@/components/ui/Field';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useWorkspace } from '@/features/project-context';
import { useTaskMutations, type TaskPatch } from '@/features/queries';
import { confirmDanger, toastError } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/dates';
import { PRIORITY_LABELS, readableId } from '@/lib/query';
import { TASK_STATUS, taskStatus } from '@/lib/status';
import type { LinkType, Priority, RelationType, Task, TaskLink } from '@/lib/types';
import { LINK_LABELS } from './predecessors';

interface Draft {
  name: string;
  type: string;
  status: string;
  priority: Priority;
  assignee: string;
  accountable: string;
  category: string;
  duration: string;
  manual: boolean;
  constraintStart: string;
  percentComplete: string;
  predecessors: TaskLink[];
  relations: { task: string; type: RelationType }[];
  resources: string[];
  notes: string;
  customValues: Record<string, unknown>;
}

const LINK_OPTIONS = (Object.keys(LINK_LABELS) as LinkType[]).map((t) => ({ value: t, label: LINK_LABELS[t] }));
export const RELATION_LABELS: Record<RelationType, { out: string; in: string }> = {
  relates: { out: 'Relates to', in: 'Relates to' },
  blocks: { out: 'Blocks', in: 'Blocked by' },
  duplicates: { out: 'Duplicates', in: 'Duplicated by' },
  includes: { out: 'Includes', in: 'Part of' },
  requires: { out: 'Requires', in: 'Required by' },
};
const RELATION_OPTIONS = (Object.keys(RELATION_LABELS) as RelationType[]).map((t) => ({ value: t, label: RELATION_LABELS[t].out }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));

function toDraft(t: Task): Draft {
  return {
    name: t.name,
    type: t.type ?? '',
    status: t.status ?? '',
    priority: t.priority ?? 'normal',
    assignee: t.assignee ?? '',
    accountable: t.accountable ?? '',
    category: t.category ?? '',
    duration: String(t.duration),
    manual: !!t.manual,
    constraintStart: t.constraintStart ?? '',
    percentComplete: String(t.percentComplete),
    predecessors: t.predecessors.map((p) => ({ ...p })),
    relations: (t.relations ?? []).map((r) => ({ ...r })),
    resources: [...t.resources],
    notes: t.notes,
    customValues: { ...(t.customValues ?? {}) },
  };
}

/** Opens the drawer for the workspace's `openTaskId`. Mounted once per project layout. */
export function TaskDrawerHost() {
  const { openTaskId, openTask, byId } = useWorkspace();
  const task = openTaskId ? byId.get(openTaskId) ?? null : null;
  if (!task) return null;
  return <TaskDrawer key={task._id} task={task} onClose={() => openTask(null)} />;
}

function TaskDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const { projectId, tasks, resources, ctx, canEdit, workSettings, plan } = useWorkspace();
  const mutations = useTaskMutations(projectId);
  const [draft, setDraft] = useState<Draft>(() => toDraft(task));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'details' | 'activity' | 'files'>('details');
  const { user } = useAuth();
  const activity = useTaskActivity(projectId, task._id);
  const { watch } = useCommentMutations(projectId, task._id);
  const watching = (activity.data?.watchers ?? task.watchers ?? []).includes(user?._id ?? '');

  useEffect(() => setError(null), [task._id]);

  const otherTasks = useMemo(
    () => tasks.filter((t) => t._id !== task._id).map((t) => ({ value: t._id, label: `${t.rowNumber}. ${t.name}`, description: ctx ? readableId(t, ctx.project) : undefined })),
    [tasks, task._id, ctx],
  );
  /** Relations other tasks have pointing at this one (shown read-only with inverse labels). */
  const incoming = useMemo(
    () => tasks.flatMap((t) => (t.relations ?? []).filter((r) => r.task === task._id).map((r) => ({ from: t, type: r.type }))),
    [tasks, task._id],
  );

  if (!ctx || !plan) return null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const status = taskStatus(task, ctx.today);
  const people = [...ctx.people.values()].map((u) => ({ value: u._id, label: u.name }));
  const readOnly = !canEdit;
  const role = plan.project.myRole;
  const typeDef = draft.type ? ctx.types.get(draft.type) : undefined;
  const hidden = new Set(typeDef?.hiddenFields ?? []);
  const shown = (key: string) => !hidden.has(key);
  const customFields = (workSettings?.customFields ?? []).filter((f) => f.scope === 'task' && shown(f._id));
  // Only statuses the workflow allows from the task's current status.
  const statusOptions = (workSettings?.statuses ?? [])
    .filter((s) => isTransitionAllowed(workSettings?.workflow, role, task.status, s._id))
    .map((s) => ({ value: s._id, label: s.name }));

  const save = async () => {
    setError(null);
    const name = draft.name.trim();
    const duration = Number(draft.duration);
    const pct = Number(draft.percentComplete);
    if (!name) return setError('Task name is required');
    if (!task.isSummary && (!Number.isInteger(duration) || duration < 0)) return setError('Duration must be a whole number of days (0 for a milestone)');
    if (!task.isSummary && (Number.isNaN(pct) || pct < 0 || pct > 100)) return setError('% complete must be between 0 and 100');
    if (draft.predecessors.some((p) => !p.task) || draft.relations.some((r) => !r.task)) return setError('Choose a task in every link row, or remove the empty row');
    if (draft.manual && !draft.constraintStart) return setError('Manually scheduled tasks need a start date');
    const missing = customFields.filter((f) => f.required && isEmptyValue(draft.customValues[f._id])).map((f) => f.name);
    if (missing.length) return setError(`Please fill in: ${missing.join(', ')}`);

    const patch: TaskPatch = {
      name,
      notes: draft.notes,
      priority: draft.priority,
      assignee: draft.assignee || null,
      accountable: draft.accountable || null,
      category: draft.category || null,
      manual: draft.manual,
      constraintStart: draft.constraintStart || null,
      predecessors: draft.predecessors.map((p) => ({ task: p.task, type: p.type, lag: Math.round(Number(p.lag) || 0) })),
      relations: draft.relations,
      resources: draft.resources,
      customValues: Object.fromEntries(customFields.map((f) => [f._id, isEmptyValue(draft.customValues[f._id]) ? null : draft.customValues[f._id]])),
    };
    if (draft.type) patch.type = draft.type;
    if (draft.status) patch.status = draft.status;
    if (!task.isSummary) {
      patch.duration = duration;
      patch.percentComplete = pct;
    }
    setSaving(true);
    try {
      await mutations.update.mutateAsync({ taskId: task._id, patch });
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the task'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const children = tasks.filter((t) => t.wbs.startsWith(`${task.wbs}.`)).length;
    if (!(await confirmDanger(`Delete "${task.name}"?`, children ? `Its ${children} sub-task${children === 1 ? '' : 's'} will be deleted too.` : 'Links to this task will be removed.'))) return;
    try {
      await mutations.remove.mutateAsync(task._id);
      onClose();
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const id = readableId(task, plan.project);

  return (
    <Drawer
      open
      onClose={onClose}
      icon={ClipboardList}
      width="lg"
      title={task.name}
      subtitle={`${id ? `${id} · ` : ''}Row ${task.rowNumber} · WBS ${task.wbs}${task.isSummary ? ' · Summary task' : task.isMilestone ? ' · Milestone' : ''}`}
      footer={
        tab !== 'details' ? (
          <Button inDrawer onClick={onClose}>
            Close
          </Button>
        ) : canEdit ? (
          <>
            <Button inDrawer variant="danger" icon={Trash2} className="mr-auto" onClick={remove}>
              Delete
            </Button>
            <Button inDrawer onClick={onClose}>
              Cancel
            </Button>
            <Button inDrawer variant="primary" loading={saving} onClick={save}>
              Save task
            </Button>
          </>
        ) : (
          <Button inDrawer onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <FilterTabs<'details' | 'activity' | 'files'>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'details', label: 'Details' },
            { key: 'activity', label: 'Activity', count: activity.data?.activity.filter((a) => a.kind === 'comment').length },
            { key: 'files', label: 'Files' },
          ]}
        />
        <Button
          inDrawer
          size="sm"
          icon={watching ? BellOff : Bell}
          loading={watch.isPending}
          onClick={() => watch.mutate(!watching)}
          title={watching ? 'Stop getting notifications for this task' : 'Get notified about changes and comments'}
        >
          {watching ? 'Unwatch' : 'Watch'} · {(activity.data?.watchers ?? task.watchers ?? []).length}
        </Button>
      </div>
      {tab === 'activity' ? (
        <TaskActivityPanel projectId={projectId} taskId={task._id} people={[...ctx.people.values()]} canComment={canEdit} canModerate={atLeast(role, 'manager')} />
      ) : tab === 'files' ? (
        <TaskFilesPanel projectId={projectId} taskId={task._id} canEdit={canEdit} canModerate={atLeast(role, 'manager')} />
      ) : (
      <div className="space-y-8">
        {error && <Alert>{error}</Alert>}
        {readOnly && <Alert tone="info">You have view-only access to this project.</Alert>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
          {[
            ['Start', fmtDate(task.start)],
            ['Finish', fmtDate(task.finish)],
            ['Total slack', `${task.totalSlack} day${task.totalSlack === 1 ? '' : 's'}`],
            ['Baseline finish', fmtDate(task.baselineFinish)],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">{value}</p>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-2">
            <Badge tone={TASK_STATUS[status].tone} dot>
              {TASK_STATUS[status].label}
            </Badge>
            {task.isCritical && <Badge tone="danger">Critical path</Badge>}
            {task.manual && <Badge tone="purple">Manually scheduled</Badge>}
            {task.baselineFinish && task.finish > task.baselineFinish && <Badge tone="warning">Slipped vs. baseline</Badge>}
          </div>
        </div>

        <section>
          <Sec title="General" icon={ClipboardList} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Task name" htmlFor="t-name" required className="sm:col-span-2">
              <input id="t-name" className={inputCls} value={draft.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Type">
              <ThemedSelect options={(workSettings?.types ?? []).map((t) => ({ value: t._id, label: t.name }))} value={draft.type} disabled={readOnly} onChange={(v) => set('type', v)} />
            </Field>
            <Field label="Status" hint={ctx.statuses.get(draft.status)?.isClosed ? 'Closed statuses set the task to 100% complete' : undefined}>
              <ThemedSelect options={statusOptions} value={draft.status} disabled={readOnly} onChange={(v) => set('status', v)} />
            </Field>
            {shown('priority') && <Field label="Priority">
              <ThemedSelect options={PRIORITY_OPTIONS} value={draft.priority} disabled={readOnly} onChange={(v) => set('priority', v as Priority)} />
            </Field>}
            {shown('category') && <Field label="Category">
              <ThemedSelect
                options={[{ value: '', label: 'No category' }, ...[...ctx.categories.entries()].map(([value, label]) => ({ value, label }))]}
                value={draft.category}
                disabled={readOnly || ctx.categories.size === 0}
                placeholder={ctx.categories.size === 0 ? 'Add categories in project settings' : 'Select…'}
                onChange={(v) => set('category', v)}
              />
            </Field>}
          </div>
        </section>

        <section>
          <Sec title="People" icon={Users} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Assignee" hint="Who does the work">
              <ThemedSelect options={[{ value: '', label: 'Unassigned' }, ...people]} value={draft.assignee} disabled={readOnly} searchable onChange={(v) => set('assignee', v)} />
            </Field>
            {shown('accountable') && <Field label="Accountable" hint="Who answers for the result">
              <ThemedSelect options={[{ value: '', label: 'Nobody' }, ...people]} value={draft.accountable} disabled={readOnly} searchable onChange={(v) => set('accountable', v)} />
            </Field>}
            {shown('resources') && <div className="sm:col-span-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Resources</p>
              {resources.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No resources yet. Add them on the Resources tab.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {resources.map((r) => {
                    const checked = draft.resources.includes(r._id);
                    return (
                      <label
                        key={r._id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors',
                          checked ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50',
                          readOnly && 'cursor-not-allowed opacity-70',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={readOnly}
                          onChange={() => set('resources', checked ? draft.resources.filter((x) => x !== r._id) : [...draft.resources, r._id])}
                          className="w-4 h-4 accent-[var(--theme-primary)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</span>
                          {r.title && <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{r.title}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>}
          </div>
        </section>

        {customFields.length > 0 && (
          <section>
            <Sec title="Additional fields" icon={ListPlus} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {customFields.map((f) => (
                <Field key={f._id} label={f.name} htmlFor={`cf-${f._id}`} required={f.required} hint={f.description || undefined} className={f.kind === 'longtext' || f.kind === 'multiselect' ? 'sm:col-span-2' : undefined}>
                  <CustomFieldInput
                    field={f}
                    value={draft.customValues[f._id]}
                    people={[...ctx.people.values()]}
                    disabled={readOnly}
                    onChange={(v) => set('customValues', { ...draft.customValues, [f._id]: v })}
                  />
                </Field>
              ))}
            </div>
          </section>
        )}

        <section>
          <Sec title="Schedule" icon={CalendarRange} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Duration (working days)" htmlFor="t-dur" hint={task.isSummary ? 'Calculated from sub-tasks' : '0 makes this a milestone'}>
              <input id="t-dur" type="number" min={0} className={inputCls} value={draft.duration} disabled={readOnly || task.isSummary} onChange={(e) => set('duration', e.target.value)} />
            </Field>
            <Field label="% complete" htmlFor="t-pct" hint={task.isSummary ? 'Rolled up from sub-tasks' : undefined}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draft.percentComplete}
                  disabled={readOnly || task.isSummary}
                  onChange={(e) => set('percentComplete', e.target.value)}
                  className="flex-1 accent-[var(--theme-primary)]"
                  aria-label="% complete slider"
                />
                <input id="t-pct" type="number" min={0} max={100} className={cn(inputCls, 'w-20')} value={draft.percentComplete} disabled={readOnly || task.isSummary} onChange={(e) => set('percentComplete', e.target.value)} />
              </div>
            </Field>
            {!task.isSummary && (
              <Field label="Scheduling mode" className="sm:col-span-2">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { manual: false, title: 'Automatic', text: 'Dates follow links and the calendar' },
                    { manual: true, title: 'Manual', text: 'Stays on the date you set, ignores links' },
                  ].map((m) => (
                    <button
                      key={m.title}
                      type="button"
                      disabled={readOnly}
                      onClick={() => {
                        set('manual', m.manual);
                        if (m.manual && !draft.constraintStart) set('constraintStart', task.start);
                      }}
                      className={cn(
                        'text-left px-3 py-2 rounded-md border transition-colors disabled:cursor-not-allowed',
                        draft.manual === m.manual ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50',
                      )}
                    >
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">{m.title}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{m.text}</span>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label={draft.manual ? 'Start date' : 'Start no earlier than'} htmlFor="t-snet" hint={draft.manual ? undefined : 'Leave empty to schedule as soon as possible'} className="sm:col-span-2">
              <div className="flex gap-2">
                <input id="t-snet" type="date" className={inputCls} value={draft.constraintStart} disabled={readOnly} onChange={(e) => set('constraintStart', e.target.value)} />
                {draft.constraintStart && !readOnly && !draft.manual && (
                  <Button inDrawer icon={X} onClick={() => set('constraintStart', '')}>
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </section>

        <section>
          <Sec title="Predecessors (scheduling links)" icon={Link2} />
          {draft.predecessors.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">This task doesn&apos;t depend on any other task.</p>}
          <div className="space-y-3">
            {draft.predecessors.map((link, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                <Field label="Task" className="col-span-12 sm:col-span-6">
                  <ThemedSelect options={otherTasks} value={link.task} disabled={readOnly} searchable placeholder="Choose a task…" onChange={(v) => set('predecessors', draft.predecessors.map((p, j) => (j === i ? { ...p, task: v } : p)))} />
                </Field>
                <Field label="Type" className="col-span-6 sm:col-span-3">
                  <ThemedSelect options={LINK_OPTIONS} value={link.type} disabled={readOnly} onChange={(v) => set('predecessors', draft.predecessors.map((p, j) => (j === i ? { ...p, type: v as LinkType } : p)))} />
                </Field>
                <Field label="Lag (days)" className="col-span-4 sm:col-span-2">
                  <input type="number" className={inputCls} value={link.lag} disabled={readOnly} onChange={(e) => set('predecessors', draft.predecessors.map((p, j) => (j === i ? { ...p, lag: Number(e.target.value) } : p)))} />
                </Field>
                {!readOnly && <RemoveButton label="Remove predecessor" onClick={() => set('predecessors', draft.predecessors.filter((_, j) => j !== i))} />}
              </div>
            ))}
          </div>
          {!readOnly && (
            <Button inDrawer size="sm" icon={Plus} className="mt-3" onClick={() => set('predecessors', [...draft.predecessors, { task: '', type: 'FS', lag: 0 }])}>
              Add predecessor
            </Button>
          )}
        </section>

        {shown('relations') && <section>
          <Sec title="Related tasks (no scheduling effect)" icon={GitBranch} />
          <div className="space-y-3">
            {draft.relations.map((rel, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                <Field label="This task…" className="col-span-12 sm:col-span-4">
                  <ThemedSelect options={RELATION_OPTIONS} value={rel.type} disabled={readOnly} onChange={(v) => set('relations', draft.relations.map((r, j) => (j === i ? { ...r, type: v as RelationType } : r)))} />
                </Field>
                <Field label="Task" className="col-span-10 sm:col-span-7">
                  <ThemedSelect options={otherTasks} value={rel.task} disabled={readOnly} searchable placeholder="Choose a task…" onChange={(v) => set('relations', draft.relations.map((r, j) => (j === i ? { ...r, task: v } : r)))} />
                </Field>
                {!readOnly && <RemoveButton label="Remove relation" onClick={() => set('relations', draft.relations.filter((_, j) => j !== i))} />}
              </div>
            ))}
            {incoming.map(({ from, type }) => (
              <div key={`${from._id}-${type}`} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-sm">
                <span className="text-gray-500 dark:text-gray-400">{RELATION_LABELS[type].in}</span>
                <span className="font-medium text-gray-900 dark:text-white truncate">
                  {from.rowNumber}. {from.name}
                </span>
                <span className="ml-auto text-xs text-gray-400">set on that task</span>
              </div>
            ))}
            {draft.relations.length === 0 && incoming.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">No related tasks.</p>}
          </div>
          {!readOnly && (
            <Button inDrawer size="sm" icon={Plus} className="mt-3" onClick={() => set('relations', [...draft.relations, { task: '', type: 'relates' }])}>
              Add relation
            </Button>
          )}
        </section>}

        {shown('notes') && <section>
          <Sec title="Notes" icon={StickyNote} />
          <textarea rows={4} className={textareaCls} value={draft.notes} disabled={readOnly} onChange={(e) => set('notes', e.target.value)} placeholder="Details, links, acceptance criteria…" aria-label="Notes" />
        </section>}

        {task.baselineStart && (
          <section>
            <Sec title="Baseline" icon={Tag} />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Planned {fmtDate(task.baselineStart)} → {fmtDate(task.baselineFinish)}
            </p>
          </section>
        )}
      </div>
      )}
    </Drawer>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-2 sm:col-span-1 h-10 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      title={label}
      aria-label={label}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
