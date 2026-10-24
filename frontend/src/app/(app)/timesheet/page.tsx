'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Download, FolderKanban, Gauge, Plus, Timer, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { KpiCard, KpiGrid, Page, PageHeader } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { keys, useProjects, useTimeEntries, useTimeMutations, useWorkSettings } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { addDays, fmtDate, todayISO, weekday, WEEKDAY_NAMES } from '@/lib/dates';
import { exportFileName, exportXlsx } from '@/lib/export';
import { can } from '@/lib/permissions';
import { useTheme } from '@/lib/theme';
import type { Plan } from '@/lib/types';

/** One timesheet line: a project, optionally a task, and an activity. */
interface Row {
  key: string;
  project: string;
  task: string | null;
  activity: string | null;
}

const rowKey = (project: string, task: string | null, activity: string | null) => `${project}|${task ?? ''}|${activity ?? ''}`;
const mondayOf = (iso: string) => addDays(iso, -((weekday(iso) + 6) % 7));
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function TimesheetPage() {
  const { user } = useAuth();
  const { themeColor } = useTheme();
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = days[0];
  const to = days[6];
  const entries = useTimeEntries({ from, to });
  const projects = useProjects();
  const workSettings = useWorkSettings();
  const { setCell } = useTimeMutations();
  const [extraRows, setExtraRows] = useState<Row[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const schedule = user?.workSchedule ?? { hoursPerDay: 8, workingDays: [1, 2, 3, 4, 5] };
  const loggable = useMemo(() => (projects.data ?? []).filter((p) => !p.isTemplate && can(p, 'log_time')), [projects.data]);
  const loggableIds = useMemo(() => new Set(loggable.map((p) => p._id)), [loggable]);
  const activities = workSettings.data?.activities ?? [];
  const activityName = useMemo(() => new Map(activities.map((a) => [a._id, a])), [activities]);
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p._id, p.name])), [projects.data]);

  // hours[rowKey][date] and labels gathered from the entries
  const { rows, hours, taskLabels } = useMemo(() => {
    const hours = new Map<string, Map<string, number>>();
    const taskLabels = new Map<string, string>();
    const found: Row[] = [];
    for (const e of entries.data ?? []) {
      const activity = e.activity?._id ?? null;
      const key = rowKey(e.project, e.task, activity);
      if (!hours.has(key)) {
        hours.set(key, new Map());
        found.push({ key, project: e.project, task: e.task, activity });
      }
      const cells = hours.get(key)!;
      cells.set(e.date, round2((cells.get(e.date) ?? 0) + e.hours));
      if (e.task) taskLabels.set(e.task, `${e.taskNumber ? `${e.projectKey}-${e.taskNumber} ` : ''}${e.taskName}`);
    }
    const keysSeen = new Set(found.map((r) => r.key));
    const rows = [...found, ...extraRows.filter((r) => !keysSeen.has(r.key))].sort((a, b) =>
      `${projectName.get(a.project) ?? ''}${a.task ? taskLabels.get(a.task) ?? '' : ''}`.localeCompare(`${projectName.get(b.project) ?? ''}${b.task ? taskLabels.get(b.task) ?? '' : ''}`),
    );
    return { rows, hours, taskLabels };
  }, [entries.data, extraRows, projectName]);

  const [extraTaskLabels, setExtraTaskLabels] = useState<Map<string, string>>(new Map());
  const taskLabel = (id: string) => taskLabels.get(id) ?? extraTaskLabels.get(id) ?? 'Task';

  const cellValue = (row: Row, date: string) => hours.get(row.key)?.get(date) ?? 0;
  const rowTotal = (row: Row) => round2(days.reduce((a, d) => a + cellValue(row, d), 0));
  const dayTotal = (date: string) => round2(rows.reduce((a, r) => a + cellValue(r, date), 0));
  const weekTotal = round2(days.reduce((a, d) => a + dayTotal(d), 0));
  const capacity = round2(days.filter((d) => schedule.workingDays.includes(weekday(d))).length * schedule.hoursPerDay);
  const utilisation = capacity > 0 ? Math.round((weekTotal / capacity) * 100) : 0;
  const today = todayISO();

  const save = async (row: Row, date: string, value: number) => {
    try {
      await setCell.mutateAsync({ project: row.project, task: row.task, activity: row.activity, date, hours: value });
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const clearRow = async (row: Row) => {
    const filled = days.filter((d) => cellValue(row, d) > 0);
    if (filled.length && !(await confirmDanger('Clear this row?', `Removes ${rowTotal(row)} h logged this week on this line.`, 'Clear'))) return;
    for (const d of filled) await save(row, d, 0);
    setExtraRows((list) => list.filter((r) => r.key !== row.key));
    if (filled.length) void toastSuccess('Row cleared');
  };

  const exportWeek = () =>
    void exportXlsx(exportFileName(`Timesheet ${weekStart}`, 'xlsx'), [
      {
        name: `Week of ${weekStart}`,
        header: ['Project', 'Task', 'Activity', ...days.map((d) => `${WEEKDAY_NAMES[weekday(d)]} ${d}`), 'Total (h)'],
        rows: [
          ...rows.map((r) => [
            projectName.get(r.project) ?? '',
            r.task ? taskLabel(r.task) : '',
            r.activity ? activityName.get(r.activity)?.name ?? '' : '',
            ...days.map((d) => cellValue(r, d) || null),
            rowTotal(r),
          ]),
          ['Total', '', '', ...days.map((d) => dayTotal(d)), weekTotal],
        ],
        widths: [30, 36, 16, 14, 14, 14, 14, 14, 14, 14, 10],
      },
    ]);

  const loading = entries.isLoading || projects.isLoading || workSettings.isLoading;

  return (
    <Page>
      <PageHeader
        title="My timesheet"
        subtitle="Log your hours per project, task and activity. Changes save when you leave a cell."
        actions={
          <>
            <button
              type="button"
              onClick={exportWeek}
              disabled={!rows.length}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Excel
            </button>
            <Button variant="primary" icon={Plus} disabled={!loggable.length} onClick={() => setAddOpen(true)}>
              Add row
            </Button>
          </>
        }
      />
      <KpiGrid>
        <KpiCard label="Hours this week" value={weekTotal} icon={Clock} iconColor="text-blue-500" />
        <KpiCard label="Capacity" value={`${capacity} h`} icon={CalendarClock} iconColor="text-purple-500" />
        <KpiCard label="Utilisation" value={`${utilisation}%`} icon={Gauge} iconColor={utilisation > 100 ? 'text-red-500' : 'text-green-500'} />
        <KpiCard label="Projects" value={new Set(rows.map((r) => r.project)).size} icon={FolderKanban} iconColor="text-amber-500" />
      </KpiGrid>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2">
        <IconButton icon={ChevronLeft} label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))} />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 tabular-nums">
          {fmtDate(from)} – {fmtDate(to)}
        </span>
        <IconButton icon={ChevronRight} label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))} />
        {weekStart !== mondayOf(today) && (
          <Button size="sm" onClick={() => setWeekStart(mondayOf(today))}>
            This week
          </Button>
        )}
        <input
          type="date"
          aria-label="Go to week"
          className="ml-auto h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          value={from}
          onChange={(e) => e.target.value && setWeekStart(mondayOf(e.target.value))}
        />
      </div>

      {entries.error && <Alert>{errorMessage(entries.error)}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {loading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Timer}
            title="Nothing logged this week"
            message={loggable.length ? 'Add a row for a project (and optionally a task), then type your hours into the days.' : 'You are not in any project where you can log time.'}
            action={
              loggable.length ? (
                <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>
                  Add row
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-64">Project / task / activity</th>
                  {days.map((d) => {
                    const off = !schedule.workingDays.includes(weekday(d));
                    return (
                      <th
                        key={d}
                        className={cn('px-2 py-2 text-center text-xs font-medium uppercase tracking-wider w-20', off ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400')}
                        style={d === today ? { color: themeColor } : undefined}
                      >
                        {WEEKDAY_NAMES[weekday(d)]}
                        <span className="block font-normal normal-case tabular-nums">{d.slice(8)}/{d.slice(5, 7)}</span>
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-20">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((r) => {
                  const editable = loggableIds.has(r.project);
                  const activity = r.activity ? activityName.get(r.activity) : null;
                  return (
                    <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${r.project}${r.task ? `?task=${r.task}` : ''}`} className="font-medium text-gray-900 dark:text-white hover:underline">
                          {projectName.get(r.project) ?? 'Project'}
                        </Link>
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 flex-wrap">
                          <span className="truncate max-w-56">{r.task ? taskLabel(r.task) : 'Project level (no task)'}</span>
                          {activity && (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activity.color }} />
                              {activity.name}
                            </span>
                          )}
                          {!editable && <span className="text-amber-600 dark:text-amber-400">read-only</span>}
                        </p>
                      </td>
                      {days.map((d) => (
                        <td key={d} className={cn('px-1 py-1.5', !schedule.workingDays.includes(weekday(d)) && 'bg-gray-50/70 dark:bg-gray-900/30')}>
                          <HoursCell value={cellValue(r, d)} disabled={!editable} label={`${projectName.get(r.project)} ${d}`} onSave={(v) => save(r, d, v)} />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{rowTotal(r) || ''}</td>
                      <td className="pr-2 text-right">{editable && <IconButton icon={Trash2} label="Clear row" tone="delete" onClick={() => clearRow(r)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                <tr>
                  <td className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Day total</td>
                  {days.map((d) => {
                    const total = dayTotal(d);
                    const over = total > schedule.hoursPerDay;
                    return (
                      <td
                        key={d}
                        className={cn('px-2 py-2 text-center font-semibold tabular-nums', over ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100')}
                        title={over ? `More than your ${schedule.hoursPerDay} h working day` : undefined}
                      >
                        {total || '–'}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-white">{weekTotal}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Each cell holds your total for that line and day; typing over it replaces earlier entries (and their comments). Use a project&apos;s Time &amp; costs tab for
        detailed entries with comments.
      </p>

      {addOpen && (
        <AddRowDrawer
          projects={loggable.map((p) => ({ value: p._id, label: p.name, description: p.key }))}
          activities={activities.map((a) => ({ value: a._id, label: a.name }))}
          defaultActivity={activities.find((a) => a.isDefault)?._id ?? activities[0]?._id ?? null}
          onClose={() => setAddOpen(false)}
          onAdd={(row, label) => {
            setExtraRows((list) => (list.some((r) => r.key === row.key) ? list : [...list, row]));
            if (row.task && label) setExtraTaskLabels((m) => new Map(m).set(row.task!, label));
            setAddOpen(false);
          }}
        />
      )}
    </Page>
  );
}

/** Hour input that keeps a local draft and saves on blur / Enter. */
function HoursCell({ value, disabled, label, onSave }: { value: number; disabled: boolean; label: string; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  useEffect(() => setDraft(value ? String(value) : ''), [value]);

  const commit = () => {
    const text = draft.trim().replace(',', '.');
    const next = text === '' ? 0 : Number(text);
    if (!Number.isFinite(next) || next < 0 || next > 24) {
      void toastError('Enter between 0 and 24 hours');
      setDraft(value ? String(value) : '');
      return;
    }
    if (round2(next) !== value) onSave(round2(next));
  };

  return (
    <input
      inputMode="decimal"
      aria-label={`Hours for ${label}`}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-full h-9 text-center text-sm tabular-nums rounded-md border border-transparent bg-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-gray-300 dark:focus:border-gray-600 focus:bg-white dark:focus:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-gray-900 dark:text-white disabled:opacity-60"
    />
  );
}

function AddRowDrawer({
  projects,
  activities,
  defaultActivity,
  onClose,
  onAdd,
}: {
  projects: { value: string; label: string; description?: string }[];
  activities: { value: string; label: string }[];
  defaultActivity: string | null;
  onClose: () => void;
  onAdd: (row: Row, taskLabel?: string) => void;
}) {
  const [project, setProject] = useState(projects.length === 1 ? projects[0].value : '');
  const [task, setTask] = useState('');
  const [activity, setActivity] = useState(defaultActivity ?? '');
  // Same cache as the project's plan, loaded only once a project is chosen.
  const plan = useQuery({ queryKey: keys.plan(project), queryFn: () => api<Plan>(`/projects/${project}/tasks`), enabled: !!project });
  const taskOptions = useMemo(
    () => [
      { value: '', label: 'No task (project level)' },
      ...(plan.data?.tasks ?? [])
        .filter((t) => !t.isSummary)
        .map((t) => ({ value: t._id, label: `${t.number ? `${plan.data!.project.key}-${t.number} ` : ''}${t.name}`, description: t.wbs })),
    ],
    [plan.data],
  );

  return (
    <Drawer
      open
      onClose={onClose}
      icon={Plus}
      width="md"
      title="Add timesheet row"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button
            inDrawer
            variant="primary"
            disabled={!project}
            onClick={() =>
              onAdd({ key: rowKey(project, task || null, activity || null), project, task: task || null, activity: activity || null }, taskOptions.find((t) => t.value === task)?.label)
            }
          >
            Add row
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Project" required>
          <ThemedSelect
            options={projects}
            value={project}
            onChange={(v) => {
              setProject(v);
              setTask('');
            }}
            placeholder="Choose a project…"
            searchable
          />
        </Field>
        <Field label="Task" hint={project && plan.isLoading ? 'Loading tasks…' : 'Optional — summary tasks are not listed'}>
          <ThemedSelect options={taskOptions} value={task} onChange={setTask} disabled={!project || plan.isLoading} searchable />
        </Field>
        <Field label="Activity">
          <ThemedSelect options={activities} value={activity} onChange={setActivity} placeholder="Choose an activity…" />
        </Field>
      </div>
    </Drawer>
  );
}
