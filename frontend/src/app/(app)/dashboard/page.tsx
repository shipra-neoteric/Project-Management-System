'use client';

import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, CheckCircle2, Diamond, FolderKanban, ListTodo, PieChart, Plus, Settings2, Star, Timer, TrendingUp, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarList, StackedShare } from '@/components/charts/Charts';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { Card, KpiCard, KpiGrid, Page, PageHeader, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { PriorityBadge, StatusBadge } from '@/components/ui/TaskBits';
import { ProjectDrawer } from '@/features/ProjectDrawer';
import { useDashboard, useProjects, useTimeEntries, useUsers, useWorkSettings } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { addDays, diffDays, fmtDate, todayISO, weekday, WEEKDAY_NAMES } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { PROJECT_STATUS } from '@/lib/status';
import type { DashboardTask, ProjectStatus, User } from '@/lib/types';

const WIDGETS = {
  kpis: { label: 'Key figures', wide: true },
  myTasks: { label: 'My open tasks', wide: false },
  favorites: { label: 'Favorite projects', wide: false },
  statusChart: { label: 'Open tasks by status', wide: false },
  workloadChart: { label: 'Open tasks per person', wide: false },
  projectStatusChart: { label: 'Projects by status', wide: false },
  portfolio: { label: 'Portfolio', wide: true },
  milestones: { label: 'Upcoming milestones', wide: false },
  overdue: { label: 'Overdue tasks', wide: false },
  myTime: { label: 'My time this week', wide: false },
} as const;
type WidgetId = keyof typeof WIDGETS;
const DEFAULT_WIDGETS: WidgetId[] = ['kpis', 'myTasks', 'myTime', 'favorites', 'statusChart', 'workloadChart', 'portfolio', 'milestones', 'overdue'];
const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = { active: '#22c55e', on_hold: '#f59e0b', completed: '#3b82f6', archived: '#9ca3af' };

export default function DashboardPage() {
  const { user, setUser } = useAuth();
  const dashboard = useDashboard();
  const projects = useProjects();
  const users = useUsers();
  const { data: ws } = useWorkSettings();
  const [createOpen, setCreateOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const today = todayISO();

  const widgets = ((user?.dashboardWidgets?.length ? user.dashboardWidgets : DEFAULT_WIDGETS) as WidgetId[]).filter((w) => w in WIDGETS);
  const saveWidgets = async (next: WidgetId[] | null) => {
    try {
      setUser((await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { dashboardWidgets: next } })).user);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const d = dashboard.data;
  const portfolio = (projects.data ?? []).filter((p) => p.status !== 'archived' && !p.isTemplate && !p.parent).slice(0, 10);
  const favorites = (projects.data ?? []).filter((p) => p.favorite);
  const userNames = new Map((users.data ?? []).map((u) => [u._id, u.name]));
  const statuses = new Map((ws?.statuses ?? []).map((s) => [s._id, s]));

  const render = (id: WidgetId) => {
    switch (id) {
      case 'kpis':
        return (
          <KpiGrid>
            <KpiCard label="Projects" value={d?.kpis.projects ?? '–'} icon={FolderKanban} iconColor="text-blue-500" />
            <KpiCard label="Open tasks" value={d?.kpis.activeTasks ?? '–'} icon={ListTodo} iconColor="text-amber-500" />
            <KpiCard label="Overdue tasks" value={d?.kpis.overdueTasks ?? '–'} icon={AlertTriangle} iconColor="text-red-500" />
            <KpiCard label="Overall completion" value={d ? `${d.kpis.percentComplete}%` : '–'} icon={TrendingUp} iconColor="text-green-500" />
          </KpiGrid>
        );
      case 'myTasks':
        return (
          <Card title="My open tasks" icon={UserCheck}>
            {!d?.myTasks.length ? (
              <EmptyState icon={CheckCircle2} title="Nothing assigned to you" compact />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-96 overflow-y-auto custom-scrollbar">
                {d.myTasks.map((t) => (
                  <li key={t._id}>
                    <Link href={`/projects/${t.project}?task=${t._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{t.name}</span>
                        <span className="block text-xs text-gray-500 truncate">{t.projectName}</span>
                      </span>
                      <StatusBadge status={t.status ? statuses.get(t.status) : undefined} />
                      <PriorityBadge priority={t.priority ?? 'normal'} showLabel={false} />
                      <span className={cn('text-xs whitespace-nowrap w-20 text-right', t.finish < today ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500')}>{fmtDate(t.finish)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      case 'favorites':
        return (
          <Card title="Favorite projects" icon={Star}>
            {!favorites.length ? (
              <EmptyState icon={Star} title="No favorites yet" message="Star a project to pin it here and in the sidebar." compact />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {favorites.map((p) => (
                  <li key={p._id}>
                    <Link href={`/projects/${p._id}${p.kind === 'project' ? '' : '/overview'}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</span>
                        <span className="block text-xs text-gray-500">Finish {fmtDate(p.rollup?.finishDate ?? p.finishDate)}</span>
                      </span>
                      <span className="flex items-center gap-2 w-32">
                        <ProgressBar value={p.rollup?.percentComplete ?? p.stats.percentComplete} />
                        <span className="text-xs tabular-nums w-9 text-right">{p.rollup?.percentComplete ?? p.stats.percentComplete}%</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      case 'statusChart':
        return (
          <Card title="Open tasks by status" icon={PieChart}>
            <div className="p-5">
              <StackedShare
                segments={(ws?.statuses ?? []).filter((s) => !s.isClosed).map((s) => ({ key: s._id, label: s.name, color: s.color, count: d?.statusCounts.find((c) => c.value === s._id)?.count ?? 0 }))}
                emptyText="No open tasks"
              />
            </div>
          </Card>
        );
      case 'workloadChart':
        return (
          <Card title="Open tasks per person" icon={Users}>
            <div className="p-5">
              <BarList rows={(d?.assigneeCounts ?? []).map((c) => ({ key: c.value || 'none', label: c.value ? userNames.get(c.value) ?? 'Former user' : 'Unassigned', value: c.count }))} emptyText="No open tasks" />
            </div>
          </Card>
        );
      case 'myTime':
        return <MyTimeWidget hoursPerDay={user?.workSchedule?.hoursPerDay ?? 8} workingDays={user?.workSchedule?.workingDays ?? [1, 2, 3, 4, 5]} />;
      case 'projectStatusChart': {
        const list = (projects.data ?? []).filter((p) => !p.isTemplate);
        return (
          <Card title="Projects by status" icon={BarChart3}>
            <div className="p-5">
              <StackedShare
                segments={(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ key: s, label: PROJECT_STATUS[s].label, color: PROJECT_STATUS_COLORS[s], count: list.filter((p) => p.status === s).length }))}
                emptyText="No projects yet"
              />
            </div>
          </Card>
        );
      }
      case 'portfolio':
        return (
          <Card title="Portfolio (top level)" icon={FolderKanban} actions={<Link href="/projects" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">View all</Link>}>
            {projects.isLoading ? (
              <PageLoader />
            ) : !portfolio.length ? (
              <EmptyState icon={FolderKanban} title="No projects yet" message="Create your first project and start planning." action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create project</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead className={theadCls}>
                    <tr>
                      <th className={th}>Project</th>
                      <th className={`${th} hidden sm:table-cell`}>Status</th>
                      <th className={`${th} hidden md:table-cell`}>Finish</th>
                      <th className={th}>Progress</th>
                    </tr>
                  </thead>
                  <tbody className={tbodyCls}>
                    {portfolio.map((p) => (
                      <tr key={p._id} className={rowCls}>
                        <td className={td}>
                          <Link href={`/projects/${p._id}${p.kind === 'project' ? '' : '/overview'}`} className="text-sm font-medium text-gray-900 dark:text-white hover:underline">
                            {p.name}
                          </Link>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {p.rollup?.taskCount ?? p.stats.taskCount} tasks
                            {p.rollup && p.rollup.projectCount > 0 && ` · ${p.rollup.projectCount} sub-projects`}
                            {(p.rollup?.overdueCount ?? 0) > 0 && <span className="text-red-500"> · {p.rollup?.overdueCount} overdue</span>}
                          </p>
                        </td>
                        <td className={`${td} hidden sm:table-cell`}>
                          <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                        </td>
                        <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{fmtDate(p.rollup?.finishDate ?? p.finishDate)}</td>
                        <td className={`${td} w-40`}>
                          <div className="flex items-center gap-2">
                            <ProgressBar value={p.rollup?.percentComplete ?? p.stats.percentComplete} />
                            <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-9 text-right">{p.rollup?.percentComplete ?? p.stats.percentComplete}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      case 'milestones':
        return (
          <Card title="Upcoming milestones" icon={Diamond}>
            <TaskList
              loading={dashboard.isLoading}
              tasks={d?.upcomingMilestones ?? []}
              empty="No milestones in the next 30 days"
              render={(t) => {
                const days = diffDays(today, t.start);
                return <span className="text-xs text-gray-500 dark:text-gray-400">{days === 0 ? 'Today' : `in ${days} day${days === 1 ? '' : 's'}`} · {fmtDate(t.start)}</span>;
              }}
            />
          </Card>
        );
      case 'overdue':
        return (
          <Card title="Overdue tasks" icon={AlertTriangle}>
            <TaskList
              loading={dashboard.isLoading}
              tasks={d?.overdueTasks ?? []}
              empty="Nothing overdue. Nice work!"
              emptyIcon={CheckCircle2}
              render={(t) => (
                <span className="text-xs text-red-600 dark:text-red-400">
                  Due {fmtDate(t.finish)} · {t.percentComplete}% done
                </span>
              )}
            />
          </Card>
        );
    }
  };

  return (
    <Page>
      <PageHeader
        title={`Welcome, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle="Your work and portfolio at a glance"
        actions={
          <>
            <Button icon={Settings2} onClick={() => setCustomizing(true)}>
              Customize
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
              New project
            </Button>
          </>
        }
      />
      {dashboard.error && <Alert>{errorMessage(dashboard.error)}</Alert>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        {widgets.map((w) => (
          <div key={w} className={cn(WIDGETS[w].wide && 'xl:col-span-2')}>
            {render(w)}
          </div>
        ))}
      </div>

      <CustomizeDrawer open={customizing} onClose={() => setCustomizing(false)} widgets={widgets} onSave={saveWidgets} />
      <ProjectDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  );
}

function CustomizeDrawer({ open, onClose, widgets, onSave }: { open: boolean; onClose: () => void; widgets: WidgetId[]; onSave: (w: WidgetId[] | null) => Promise<void> }) {
  const [list, setList] = useState<WidgetId[]>(widgets);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) setList(widgets);
  }, [open]);
  const all = [...list, ...(Object.keys(WIDGETS) as WidgetId[]).filter((w) => !list.includes(w))];
  const move = (i: number, delta: number) => {
    const next = [...list];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      icon={Settings2}
      title="Customize dashboard"
      subtitle="Choose widgets and their order"
      width="md"
      footer={
        <>
          <Button
            inDrawer
            className="mr-auto"
            onClick={async () => {
              setSaving(true);
              await onSave(null);
              setSaving(false);
              setList(DEFAULT_WIDGETS);
              onClose();
            }}
          >
            Reset to default
          </Button>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button
            inDrawer
            variant="primary"
            loading={saving}
            disabled={!list.length}
            onClick={async () => {
              setSaving(true);
              await onSave(list);
              setSaving(false);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {all.map((w) => {
          const on = list.includes(w);
          const i = list.indexOf(w);
          return (
            <li key={w} className={cn('flex items-center gap-3 px-3 py-2 rounded-md border', on ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700')}>
              <input type="checkbox" checked={on} onChange={() => setList(on ? list.filter((x) => x !== w) : [...list, w])} className="w-4 h-4 accent-[var(--theme-primary)]" aria-label={`Show ${WIDGETS[w].label}`} />
              <span className="flex-1 text-sm text-gray-800 dark:text-gray-100">{WIDGETS[w].label}</span>
              {on && (
                <>
                  <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon={ArrowDown} label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}

function TaskList({ tasks, loading, empty, emptyIcon = Diamond, render }: { tasks: DashboardTask[]; loading: boolean; empty: string; emptyIcon?: typeof Diamond; render: (t: DashboardTask) => React.ReactNode }) {
  if (loading) return <PageLoader />;
  if (!tasks.length) return <EmptyState icon={emptyIcon} title={empty} compact />;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {tasks.map((t) => (
        <li key={t._id}>
          <Link href={`/projects/${t.project}?task=${t._id}`} className="block px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate mb-0.5">{t.projectName}</p>
            {render(t)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Hours logged per day this week (Mon–Sun) against the person's working day. */
function MyTimeWidget({ hoursPerDay, workingDays }: { hoursPerDay: number; workingDays: number[] }) {
  const { themeColor } = useTheme();
  const today = todayISO();
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const entries = useTimeEntries({ from: days[0], to: days[6] });
  const perDay = days.map((d) => Math.round((entries.data ?? []).filter((e) => e.date === d).reduce((a, e) => a + e.hours, 0) * 100) / 100);
  const total = Math.round(perDay.reduce((a, h) => a + h, 0) * 100) / 100;
  const capacity = days.filter((d) => workingDays.includes(weekday(d))).length * hoursPerDay;
  const scale = Math.max(hoursPerDay, ...perDay, 1);

  return (
    <Card
      title="My time this week"
      icon={Timer}
      actions={
        <Link href="/timesheet" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
          Open timesheet
        </Link>
      }
    >
      {entries.isLoading ? (
        <PageLoader />
      ) : (
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="text-2xl font-medium text-gray-900 dark:text-white tabular-nums">{total} h</span> of {capacity} h
          </p>
          <div className="relative h-28 flex items-end gap-2" role="img" aria-label={days.map((d, i) => `${WEEKDAY_NAMES[weekday(d)]} ${perDay[i]} hours`).join(', ')}>
            {/* Dashed line at one working day */}
            <div className="absolute inset-x-0 border-t border-dashed border-gray-300 dark:border-gray-600 pointer-events-none" style={{ bottom: `${(hoursPerDay / scale) * 100}%` }} />
            {days.map((d, i) => (
              <div key={d} className="flex-1 h-full flex flex-col justify-end items-center" title={`${fmtDate(d)}: ${perDay[i]} h`}>
                {perDay[i] > 0 && (
                  <span className={cn('text-[10px] tabular-nums mb-0.5', perDay[i] > hoursPerDay ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400')}>{perDay[i]}</span>
                )}
                <div className="w-full max-w-7 rounded-t" style={{ height: `${(perDay[i] / scale) * 100}%`, minHeight: perDay[i] > 0 ? 2 : 0, backgroundColor: themeColor }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            {days.map((d) => (
              <span key={d} className={cn('flex-1 text-center text-[11px]', d === today ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500')}>
                {WEEKDAY_NAMES[weekday(d)]}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
