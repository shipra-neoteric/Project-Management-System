'use client';

import { Clock, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { IconButton, Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useWorkspace } from '@/features/project-context';
import { useTimeEntries, useTimeMutations } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, todayISO } from '@/lib/dates';
import { fmtHours, useMoney } from '@/lib/money';
import type { Task } from '@/lib/types';

/** Time logged on one task, plus a quick "log time" form. */
export function TaskTimePanel({ task }: { task: Task }) {
  const { projectId, workSettings, can } = useWorkspace();
  const { user } = useAuth();
  const { money } = useMoney();
  const entries = useTimeEntries({ project: projectId, task: task._id });
  const { create, remove } = useTimeMutations();
  const activities = workSettings?.activities ?? [];
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState('');
  const [activity, setActivity] = useState(activities.find((a) => a.isDefault)?._id ?? '');
  const [comment, setComment] = useState('');
  const canLog = can('log_time') && !task.isSummary;
  const list = entries.data ?? [];
  const total = list.reduce((a, e) => a + e.hours, 0);
  const showCost = list.some((e) => e.cost !== null);

  const log = async () => {
    const h = Number(hours);
    if (!h || h <= 0 || h > 24) return void toastError('Enter between 0.25 and 24 hours');
    try {
      await create.mutateAsync({ project: projectId, task: task._id, date, hours: h, activity: activity || null, comment: comment.trim() });
      setHours('');
      setComment('');
      void toastSuccess('Time logged');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const onDelete = async (id: string) => {
    if (!(await confirmDanger('Delete this time entry?'))) return;
    try {
      await remove.mutateAsync(id);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
        {[
          ['Estimated work', fmtHours(task.work)],
          ['Remaining', fmtHours(task.remainingWork)],
          ['Spent', fmtHours(task.spentHours ?? total)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {canLog && (
        <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <Field label="Date" htmlFor="tt-date" className="sm:col-span-3">
            <input id="tt-date" type="date" className={inputCls} value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hours" htmlFor="tt-hours" className="sm:col-span-2">
            <input id="tt-hours" type="number" min={0.25} max={24} step={0.25} className={inputCls} value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          <Field label="Activity" className="col-span-2 sm:col-span-3">
            <ThemedSelect options={activities.map((a) => ({ value: a._id, label: a.name }))} value={activity} onChange={setActivity} />
          </Field>
          <Field label="Comment" htmlFor="tt-comment" className="col-span-2 sm:col-span-4">
            <input id="tt-comment" className={inputCls} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} placeholder="What did you do?" />
          </Field>
          <div className="col-span-2 sm:col-span-12 flex justify-end">
            <Button inDrawer size="sm" variant="primary" icon={Plus} loading={create.isPending} disabled={!hours} onClick={log}>
              Log time
            </Button>
          </div>
        </div>
      )}

      {entries.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState compact icon={Clock} title="No time logged yet" message={canLog ? 'Log the hours you spend on this task above.' : undefined} />
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
          {list.map((e) => {
            const own = e.user?._id === user?._id;
            return (
              <li key={e._id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-gray-500 dark:text-gray-400 tabular-nums">{fmtDate(e.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900 dark:text-white truncate">
                    {e.user?.name ?? 'Former user'}
                    {e.activity && <span className="font-normal text-gray-500 dark:text-gray-400"> · {e.activity.name}</span>}
                  </span>
                  {e.comment && <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{e.comment}</span>}
                </span>
                {showCost && <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{money(e.cost)}</span>}
                <span className="w-14 text-right font-medium text-gray-900 dark:text-white tabular-nums">{fmtHours(e.hours)}</span>
                {(own ? can('log_time') : can('edit_time')) && <IconButton icon={Trash2} label="Delete entry" tone="delete" onClick={() => onDelete(e._id)} />}
              </li>
            );
          })}
          <li className="flex items-center justify-between px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-900/40">
            <span className="font-semibold text-gray-700 dark:text-gray-200">Total</span>
            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{fmtHours(total)}</span>
          </li>
        </ul>
      )}
    </div>
  );
}
