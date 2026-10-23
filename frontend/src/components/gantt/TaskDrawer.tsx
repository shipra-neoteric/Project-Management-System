'use client';

import { CalendarRange, ClipboardList, Link2, Plus, StickyNote, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls, Sec, textareaCls } from '@/components/ui/Field';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import type { TaskPatch } from '@/features/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/dates';
import { TASK_STATUS, taskStatus } from '@/lib/status';
import type { LinkType, Resource, Task, TaskLink } from '@/lib/types';
import { LINK_LABELS } from './predecessors';

interface TaskDrawerProps {
  task: Task | null;
  tasks: Task[];
  resources: Resource[];
  canEdit: boolean;
  today: string;
  onClose: () => void;
  onSave: (taskId: string, patch: TaskPatch) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
}

interface Draft {
  name: string;
  duration: string;
  constraintStart: string;
  percentComplete: string;
  predecessors: TaskLink[];
  resources: string[];
  notes: string;
}

const LINK_OPTIONS = (Object.keys(LINK_LABELS) as LinkType[]).map((t) => ({ value: t, label: LINK_LABELS[t] }));

function toDraft(t: Task): Draft {
  return {
    name: t.name,
    duration: String(t.duration),
    constraintStart: t.constraintStart ?? '',
    percentComplete: String(t.percentComplete),
    predecessors: t.predecessors.map((p) => ({ ...p })),
    resources: [...t.resources],
    notes: t.notes,
  };
}

export function TaskDrawer({ task, tasks, resources, canEdit, today, onClose, onSave, onDelete }: TaskDrawerProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(task ? toDraft(task) : null);
    setError(null);
    // Only reset when a different task is opened, not on every background refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?._id]);

  const otherTasks = useMemo(
    () => tasks.filter((t) => t._id !== task?._id).map((t) => ({ value: t._id, label: `${t.rowNumber}. ${t.name}`, description: t.isSummary ? 'Summary task' : undefined })),
    [tasks, task?._id],
  );

  if (!task || !draft) return null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const status = taskStatus(task, today);

  const save = async () => {
    setError(null);
    const name = draft.name.trim();
    const duration = Number(draft.duration);
    const pct = Number(draft.percentComplete);
    if (!name) return setError('Task name is required');
    if (!task.isSummary && (!Number.isInteger(duration) || duration < 0)) return setError('Duration must be a whole number of days (0 for a milestone)');
    if (!task.isSummary && (Number.isNaN(pct) || pct < 0 || pct > 100)) return setError('% complete must be between 0 and 100');
    if (draft.predecessors.some((p) => !p.task)) return setError('Choose a task for every predecessor row, or remove the empty row');

    const patch: TaskPatch = {
      name,
      notes: draft.notes,
      constraintStart: draft.constraintStart || null,
      predecessors: draft.predecessors.map((p) => ({ task: p.task, type: p.type, lag: Math.round(Number(p.lag) || 0) })),
      resources: draft.resources,
    };
    if (!task.isSummary) {
      patch.duration = duration;
      patch.percentComplete = pct;
    }
    setSaving(true);
    try {
      await onSave(task._id, patch);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the task'));
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !canEdit;

  return (
    <Drawer
      open
      onClose={onClose}
      icon={ClipboardList}
      title={task.name}
      subtitle={`Row ${task.rowNumber} · WBS ${task.wbs}${task.isSummary ? ' · Summary task' : task.isMilestone ? ' · Milestone' : ''}`}
      footer={
        canEdit ? (
          <>
            <Button inDrawer variant="danger" icon={Trash2} className="mr-auto" onClick={() => onDelete(task)}>
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
      <div className="space-y-8">
        {error && <Alert>{error}</Alert>}
        {readOnly && <Alert tone="info">You have view-only access to this project.</Alert>}

        {/* Schedule summary */}
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
            {task.baselineFinish && task.finish > task.baselineFinish && <Badge tone="warning">Slipped vs. baseline</Badge>}
          </div>
        </div>

        <section>
          <Sec title="General" icon={ClipboardList} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Task name" htmlFor="t-name" required className="sm:col-span-2">
              <input id="t-name" className={inputCls} value={draft.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Duration (working days)" htmlFor="t-dur" hint={task.isSummary ? 'Calculated from sub-tasks' : '0 makes this a milestone'}>
              <input
                id="t-dur"
                type="number"
                min={0}
                className={inputCls}
                value={draft.duration}
                disabled={readOnly || task.isSummary}
                onChange={(e) => set('duration', e.target.value)}
              />
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
                <input
                  id="t-pct"
                  type="number"
                  min={0}
                  max={100}
                  className={cn(inputCls, 'w-20')}
                  value={draft.percentComplete}
                  disabled={readOnly || task.isSummary}
                  onChange={(e) => set('percentComplete', e.target.value)}
                />
              </div>
            </Field>
            <Field label="Start no earlier than" htmlFor="t-snet" hint="Leave empty to schedule as soon as possible" className="sm:col-span-2">
              <div className="flex gap-2">
                <input
                  id="t-snet"
                  type="date"
                  className={inputCls}
                  value={draft.constraintStart}
                  disabled={readOnly}
                  onChange={(e) => set('constraintStart', e.target.value)}
                />
                {draft.constraintStart && !readOnly && (
                  <Button inDrawer icon={X} onClick={() => set('constraintStart', '')}>
                    Clear
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </section>

        <section>
          <Sec title="Predecessors" icon={Link2} />
          {draft.predecessors.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">This task doesn&apos;t depend on any other task.</p>}
          <div className="space-y-3">
            {draft.predecessors.map((link, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                <Field label="Task" className="col-span-12 sm:col-span-6">
                  <ThemedSelect
                    options={otherTasks}
                    value={link.task}
                    disabled={readOnly}
                    searchable
                    placeholder="Choose a task…"
                    onChange={(v) => set('predecessors', draft.predecessors.map((p, j) => (j === i ? { ...p, task: v } : p)))}
                  />
                </Field>
                <Field label="Type" className="col-span-6 sm:col-span-3">
                  <ThemedSelect
                    options={LINK_OPTIONS}
                    value={link.type}
                    disabled={readOnly}
                    onChange={(v) => set('predecessors', draft.predecessors.map((p, j) => (j === i ? { ...p, type: v as LinkType } : p)))}
                  />
                </Field>
                <Field label="Lag (days)" className="col-span-4 sm:col-span-2">
                  <input
                    type="number"
                    className={inputCls}
                    value={link.lag}
                    disabled={readOnly}
                    onChange={(e) => set('predecessors', draft.predecessors.map((p, j) => (j === i ? { ...p, lag: Number(e.target.value) } : p)))}
                  />
                </Field>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => set('predecessors', draft.predecessors.filter((_, j) => j !== i))}
                    className="col-span-2 sm:col-span-1 h-10 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Remove predecessor"
                    aria-label="Remove predecessor"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!readOnly && (
            <Button inDrawer size="sm" icon={Plus} className="mt-3" onClick={() => set('predecessors', [...draft.predecessors, { task: '', type: 'FS', lag: 0 }])}>
              Add predecessor
            </Button>
          )}
        </section>

        <section>
          <Sec title="Resources" icon={Users} />
          {resources.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No resources yet. Add people on the Resources tab, then assign them here.</p>
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
                      onChange={() => set('resources', checked ? draft.resources.filter((id) => id !== r._id) : [...draft.resources, r._id])}
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
        </section>

        <section>
          <Sec title="Notes" icon={StickyNote} />
          <textarea rows={4} className={textareaCls} value={draft.notes} disabled={readOnly} onChange={(e) => set('notes', e.target.value)} placeholder="Details, links, acceptance criteria…" aria-label="Notes" />
        </section>

        {task.baselineStart && (
          <section>
            <Sec title="Baseline" icon={CalendarRange} />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Planned {fmtDate(task.baselineStart)} → {fmtDate(task.baselineFinish)}
            </p>
          </section>
        )}
      </div>
    </Drawer>
  );
}
