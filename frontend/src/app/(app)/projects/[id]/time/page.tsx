'use client';

import { Clock, Coins, Download, Hash, Package, Pencil, Plus, Receipt, Timer, Trash2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, textareaCls } from '@/components/ui/Field';
import { Card, KpiCard, KpiGrid, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useWorkspace } from '@/features/project-context';
import { useBudgets, useCostEntries, useTimeEntries, useTimeMutations } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, todayISO } from '@/lib/dates';
import { exportFileName, exportXlsx } from '@/lib/export';
import { fmtHours, useMoney } from '@/lib/money';
import { readableId } from '@/lib/query';
import type { CostEntry, TimeEntry } from '@/lib/types';

const btnExcel =
  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40';

export default function TimeAndCostsPage() {
  const { projectId, plan, ctx, can, isLoading } = useWorkspace();
  const { user } = useAuth();
  const { money } = useMoney();
  const [person, setPerson] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const canSeeTime = can('view_time') || can('log_time');
  // With only "log costs" the API returns your own cost entries.
  const canSeeCosts = can('view_costs') || can('log_costs');
  const time = useTimeEntries({ project: projectId, user: person || undefined, from: from || undefined, to: to || undefined }, canSeeTime);
  const costs = useCostEntries(projectId, canSeeCosts);
  const timeMut = useTimeMutations();
  const [timeDrawer, setTimeDrawer] = useState<{ open: boolean; entry: TimeEntry | null }>({ open: false, entry: null });
  const [costDrawer, setCostDrawer] = useState<{ open: boolean; entry: CostEntry | null }>({ open: false, entry: null });

  const costRows = useMemo(
    () => (costs.data ?? []).filter((c) => (!person || c.user?._id === person) && (!from || c.date >= from) && (!to || c.date <= to)),
    [costs.data, person, from, to],
  );

  if (isLoading || !plan || !ctx) return <PageLoader />;
  const project = plan.project;
  const entries = time.data ?? [];
  const hours = entries.reduce((a, e) => a + e.hours, 0);
  const labour = entries.some((e) => e.cost !== null) ? entries.reduce((a, e) => a + (e.cost ?? 0), 0) : null;
  const material = canSeeCosts ? costRows.reduce((a, c) => a + c.cost, 0) : null;
  const taskName = (id: string | null) => {
    const t = id ? plan.tasks.find((x) => x._id === id) : undefined;
    return t ? `${readableId(t, project) ? `${readableId(t, project)} ` : ''}${t.name}` : '';
  };
  const mayChange = (e: TimeEntry) => (e.user?._id === user?._id ? can('log_time') : can('edit_time'));
  const mayChangeCost = (c: CostEntry) => can('log_costs') && (c.user?._id === user?._id || can('manage_budgets'));

  const deleteTime = async (e: TimeEntry) => {
    if (!(await confirmDanger('Delete this time entry?', `${fmtHours(e.hours)} on ${fmtDate(e.date)}`))) return;
    try {
      await timeMut.remove.mutateAsync(e._id);
      void toastSuccess('Time entry deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };
  const deleteCost = async (c: CostEntry) => {
    if (!(await confirmDanger('Delete this cost entry?', `${c.units} ${c.costType?.unit ?? ''} of ${c.costType?.name ?? 'cost'}`))) return;
    try {
      await costs.remove.mutateAsync(c._id);
      void toastSuccess('Cost entry deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const exportExcel = () => {
    const sheets = [];
    if (canSeeTime) {
      sheets.push({
        name: 'Time',
        header: ['Date', 'Person', 'Task', 'Activity', 'Hours', 'Comment', ...(labour !== null ? ['Rate', 'Cost'] : [])],
        rows: entries.map((e) => [e.date, e.user?.name ?? '', taskName(e.task), e.activity?.name ?? '', e.hours, e.comment, ...(labour !== null ? [e.rate, e.cost] : [])]),
        widths: [12, 22, 40, 16, 8, 40, 10, 12],
      });
    }
    if (canSeeCosts) {
      sheets.push({
        name: 'Costs',
        header: ['Date', 'Cost type', 'Units', 'Unit', 'Unit rate', 'Cost', 'Task', 'Person', 'Comment'],
        rows: costRows.map((c) => [c.date, c.costType?.name ?? '', c.units, c.costType?.unit ?? '', c.unitRate, c.cost, taskName(c.task), c.user?.name ?? '', c.comment]),
        widths: [12, 22, 8, 8, 10, 12, 40, 22, 40],
      });
    }
    void exportXlsx(exportFileName(`${project.name} time and costs`, 'xlsx'), sheets);
  };

  const people = [...ctx.people.values()];

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label="Hours logged" value={fmtHours(hours)} icon={Clock} iconColor="text-blue-500" />
        <KpiCard label="Labour cost" value={labour === null ? '—' : money(labour)} icon={Wallet} iconColor="text-green-500" />
        <KpiCard label="Material cost" value={material === null ? '—' : money(material)} icon={Package} iconColor="text-purple-500" />
        <KpiCard label="Entries" value={entries.length + (canSeeCosts ? costRows.length : 0)} icon={Hash} iconColor="text-amber-500" />
      </KpiGrid>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-end gap-2">
        {can('view_time') && (
          <div className="w-48">
            <ThemedSelect compact options={[{ value: '', label: 'Everyone' }, ...people.map((p) => ({ value: p._id, label: p.name }))]} value={person} onChange={setPerson} searchable />
          </div>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          From
          <input type="date" className={`${inputCls} !h-8 !w-36`} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          To
          <input type="date" className={`${inputCls} !h-8 !w-36`} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        {(person || from || to) && (
          <Button size="sm" variant="ghost" onClick={() => (setPerson(''), setFrom(''), setTo(''))}>
            Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={btnExcel} onClick={exportExcel} disabled={!entries.length && !costRows.length}>
            <Download className="w-4 h-4" /> Excel
          </button>
          {can('log_time') && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setTimeDrawer({ open: true, entry: null })}>
              Log time
            </Button>
          )}
          {can('log_costs') && (
            <Button size="sm" icon={Receipt} onClick={() => setCostDrawer({ open: true, entry: null })}>
              Add cost
            </Button>
          )}
        </div>
      </div>

      {canSeeTime && (
        <Card title={can('view_time') ? 'Time entries' : 'My time entries'} icon={Timer}>
          {time.error ? (
            <Alert className="m-4">{errorMessage(time.error)}</Alert>
          ) : time.isLoading ? (
            <PageLoader />
          ) : entries.length === 0 ? (
            <EmptyState compact icon={Clock} title="No time logged" message={can('log_time') ? 'Use “Log time” or the Time tab on a task.' : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Person</th>
                    <th className={th}>Task</th>
                    <th className={`${th} hidden md:table-cell`}>Activity</th>
                    <th className={`${th} text-right`}>Hours</th>
                    {labour !== null && <th className={`${th} text-right`}>Cost</th>}
                    <th className={`${th} hidden lg:table-cell`}>Comment</th>
                    <th className={`${th} text-right w-24`}>Actions</th>
                  </tr>
                </thead>
                <tbody className={tbodyCls}>
                  {entries.map((e) => (
                    <tr key={e._id} className={rowCls}>
                      <td className={`${td} text-sm tabular-nums whitespace-nowrap text-gray-600 dark:text-gray-300`}>{fmtDate(e.date)}</td>
                      <td className={`${td} text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap`}>{e.user?.name ?? 'Former user'}</td>
                      <td className={`${td} text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate`}>{taskName(e.task) || <span className="text-gray-400">Project level</span>}</td>
                      <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300`}>
                        {e.activity && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.activity.color }} aria-hidden />
                            {e.activity.name}
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-sm text-right font-medium tabular-nums text-gray-900 dark:text-white`}>{fmtHours(e.hours)}</td>
                      {labour !== null && <td className={`${td} text-sm text-right tabular-nums text-gray-600 dark:text-gray-300`}>{money(e.cost)}</td>}
                      <td className={`${td} hidden lg:table-cell text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate`}>{e.comment}</td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        {mayChange(e) && (
                          <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                            <IconButton icon={Pencil} label="Edit entry" tone="edit" onClick={() => setTimeDrawer({ open: true, entry: e })} />
                            <IconButton icon={Trash2} label="Delete entry" tone="delete" onClick={() => deleteTime(e)} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {canSeeCosts && (
        <Card title={can('view_costs') ? 'Cost entries' : 'My cost entries'} icon={Coins}>
          {costs.isLoading ? (
            <PageLoader />
          ) : costRows.length === 0 ? (
            <EmptyState compact icon={Receipt} title="No costs recorded" message={can('log_costs') ? 'Record materials, equipment or subcontracts with “Add cost”.' : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Cost type</th>
                    <th className={`${th} text-right`}>Units</th>
                    <th className={`${th} text-right`}>Cost</th>
                    <th className={`${th} hidden md:table-cell`}>Task</th>
                    <th className={`${th} hidden lg:table-cell`}>By</th>
                    <th className={`${th} text-right w-24`}>Actions</th>
                  </tr>
                </thead>
                <tbody className={tbodyCls}>
                  {costRows.map((c) => (
                    <tr key={c._id} className={rowCls}>
                      <td className={`${td} text-sm tabular-nums whitespace-nowrap text-gray-600 dark:text-gray-300`}>{fmtDate(c.date)}</td>
                      <td className={`${td} text-sm font-medium text-gray-900 dark:text-white`}>
                        {c.costType?.name ?? 'Deleted type'}
                        {c.comment && <span className="block text-xs font-normal text-gray-500 dark:text-gray-400 truncate max-w-xs">{c.comment}</span>}
                      </td>
                      <td className={`${td} text-sm text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap`}>
                        {c.units} {c.costType?.unit}
                        <span className="block text-xs text-gray-400">× {money(c.unitRate)}</span>
                      </td>
                      <td className={`${td} text-sm text-right font-medium tabular-nums text-gray-900 dark:text-white`}>{money(c.cost)}</td>
                      <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate`}>{taskName(c.task) || '—'}</td>
                      <td className={`${td} hidden lg:table-cell text-sm text-gray-600 dark:text-gray-300`}>{c.user?.name}</td>
                      <td className={`${td} text-right whitespace-nowrap`}>
                        {mayChangeCost(c) && (
                          <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                            <IconButton icon={Pencil} label="Edit cost" tone="edit" onClick={() => setCostDrawer({ open: true, entry: c })} />
                            <IconButton icon={Trash2} label="Delete cost" tone="delete" onClick={() => deleteCost(c)} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!canSeeTime && !canSeeCosts && <EmptyState icon={Clock} title="No access to time or costs" message="Your role in this project doesn’t include time tracking or costs." />}

      {timeDrawer.open && <TimeEntryDrawer entry={timeDrawer.entry} onClose={() => setTimeDrawer({ open: false, entry: null })} />}
      {costDrawer.open && <CostEntryDrawer entry={costDrawer.entry} onClose={() => setCostDrawer({ open: false, entry: null })} />}
    </div>
  );
}

function useTaskOptions() {
  const { plan } = useWorkspace();
  return useMemo(
    () => [
      { value: '', label: 'Project level (no task)' },
      ...(plan?.tasks ?? []).filter((t) => !t.isSummary).map((t) => ({ value: t._id, label: `${t.rowNumber}. ${t.name}`, description: plan ? readableId(t, plan.project) : undefined })),
    ],
    [plan],
  );
}

function TimeEntryDrawer({ entry, onClose }: { entry: TimeEntry | null; onClose: () => void }) {
  const { projectId, ctx, workSettings, can } = useWorkspace();
  const { user } = useAuth();
  const { create, update } = useTimeMutations();
  const taskOptions = useTaskOptions();
  const activities = workSettings?.activities ?? [];
  const [form, setForm] = useState({
    user: entry?.user?._id ?? user?._id ?? '',
    task: entry?.task ?? '',
    activity: entry?.activity?._id ?? activities.find((a) => a.isDefault)?._id ?? '',
    date: entry?.date ?? todayISO(),
    hours: entry ? String(entry.hours) : '',
    comment: entry?.comment ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setError(null);
    const hours = Number(form.hours);
    if (!form.date) return setError('Choose a date');
    if (!hours || hours <= 0 || hours > 24) return setError('Hours must be between 0.01 and 24');
    const body = { task: form.task || null, activity: form.activity || null, date: form.date, hours, comment: form.comment.trim() };
    try {
      if (entry) await update.mutateAsync({ id: entry._id, ...body });
      else await create.mutateAsync({ project: projectId, ...body, ...(form.user && form.user !== user?._id ? { user: form.user } : {}) });
      void toastSuccess(entry ? 'Time entry updated' : 'Time logged');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the time entry'));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={Clock}
      width="md"
      title={entry ? 'Edit time entry' : 'Log time'}
      subtitle={entry ? `${entry.user?.name ?? ''} · ${fmtDate(entry.date)}` : 'Hours spent on this project'}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" loading={create.isPending || update.isPending} onClick={save}>
            {entry ? 'Save changes' : 'Log time'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!entry && can('edit_time') && (
          <Field label="Person" hint="You can log time for teammates">
            <ThemedSelect options={[...(ctx?.people.values() ?? [])].map((p) => ({ value: p._id, label: p.name }))} value={form.user} onChange={(v) => set('user', v)} searchable />
          </Field>
        )}
        <Field label="Task">
          <ThemedSelect options={taskOptions} value={form.task} onChange={(v) => set('task', v)} searchable />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="te-date" required>
            <input id="te-date" type="date" className={inputCls} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Hours" htmlFor="te-hours" required>
            <input id="te-hours" type="number" min={0.25} max={24} step={0.25} className={inputCls} value={form.hours} onChange={(e) => set('hours', e.target.value)} />
          </Field>
        </div>
        <Field label="Activity">
          <ThemedSelect options={activities.map((a) => ({ value: a._id, label: a.name }))} value={form.activity} onChange={(v) => set('activity', v)} />
        </Field>
        <Field label="Comment" htmlFor="te-comment">
          <textarea id="te-comment" rows={3} maxLength={500} className={textareaCls} value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="What was done?" />
        </Field>
      </div>
    </Drawer>
  );
}

function CostEntryDrawer({ entry, onClose }: { entry: CostEntry | null; onClose: () => void }) {
  const { projectId, workSettings, can } = useWorkspace();
  const costs = useCostEntries(projectId, false);
  const budgets = useBudgets(projectId, can('view_budgets'));
  const { money } = useMoney();
  const taskOptions = useTaskOptions();
  const types = workSettings?.costTypes ?? [];
  const [form, setForm] = useState({
    costType: entry?.costType?._id ?? types[0]?._id ?? '',
    units: entry ? String(entry.units) : '',
    date: entry?.date ?? todayISO(),
    task: entry?.task ?? '',
    budget: entry?.budget ?? '',
    comment: entry?.comment ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const type = types.find((t) => t._id === form.costType);
  const units = Number(form.units) || 0;
  // Editing keeps the rate stored on the entry unless the cost type changes.
  const rate = entry && entry.costType?._id === form.costType ? entry.unitRate : (type?.unitRate ?? 0);

  const save = async () => {
    setError(null);
    if (!form.costType) return setError('Choose a cost type');
    if (!(units > 0)) return setError('Units must be more than 0');
    const body = { costType: form.costType, units, date: form.date, task: form.task || null, budget: form.budget || null, comment: form.comment.trim() };
    try {
      if (entry) await costs.update.mutateAsync({ id: entry._id, ...body });
      else await costs.create.mutateAsync(body);
      void toastSuccess(entry ? 'Cost entry updated' : 'Cost recorded');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the cost entry'));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={Receipt}
      width="md"
      title={entry ? 'Edit cost entry' : 'Add cost'}
      subtitle="Materials, equipment, subcontracts…"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" loading={costs.create.isPending || costs.update.isPending} disabled={!types.length} onClick={save}>
            {entry ? 'Save changes' : 'Add cost'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!types.length && <Alert tone="warning">No cost types yet. An administrator can add them under Work settings → Cost types.</Alert>}
        <Field label="Cost type" required>
          <ThemedSelect
            options={types.map((t) => ({ value: t._id, label: t.name, description: `${money(t.unitRate)} per ${t.unit}` }))}
            value={form.costType}
            onChange={(v) => set('costType', v)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Units${type ? ` (${type.unit})` : ''}`} htmlFor="ce-units" required>
            <input id="ce-units" type="number" min={0} step="any" className={inputCls} value={form.units} onChange={(e) => set('units', e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="ce-date" required>
            <input id="ce-date" type="date" className={inputCls} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-sm">
          <span className="text-gray-500 dark:text-gray-400 tabular-nums">
            {units} × {money(rate)}
          </span>
          <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{money(Math.round(units * rate * 100) / 100)}</span>
        </div>
        <Field label="Task">
          <ThemedSelect options={taskOptions} value={form.task} onChange={(v) => set('task', v)} searchable />
        </Field>
        {can('view_budgets') && (
          <Field label="Budget" hint="Leave empty to use the task's budget">
            <ThemedSelect options={[{ value: '', label: 'No budget' }, ...(budgets.data?.budgets ?? []).map((b) => ({ value: b._id, label: b.name }))]} value={form.budget} onChange={(v) => set('budget', v)} />
          </Field>
        )}
        <Field label="Comment" htmlFor="ce-comment">
          <textarea id="ce-comment" rows={3} maxLength={500} className={textareaCls} value={form.comment} onChange={(e) => set('comment', e.target.value)} placeholder="Supplier, invoice number…" />
        </Field>
      </div>
    </Drawer>
  );
}
