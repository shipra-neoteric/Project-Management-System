'use client';

import { AlertTriangle, CheckCircle2, Diamond, FolderKanban, ListTodo, Plus, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { Card, KpiCard, KpiGrid, Page, PageHeader, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ProjectDrawer } from '@/features/ProjectDrawer';
import { useDashboard, useProjects } from '@/features/queries';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { diffDays, fmtDate, todayISO } from '@/lib/dates';
import { PROJECT_STATUS } from '@/lib/status';
import type { DashboardTask } from '@/lib/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useDashboard();
  const projects = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const today = todayISO();

  const portfolio = (projects.data ?? []).filter((p) => p.status !== 'archived').slice(0, 8);
  const kpis = dashboard.data?.kpis;

  return (
    <Page>
      <PageHeader
        title={`Welcome, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle="Your portfolio at a glance"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
            New project
          </Button>
        }
      />

      {dashboard.error && <Alert>{errorMessage(dashboard.error)}</Alert>}

      <KpiGrid>
        <KpiCard label="Projects" value={kpis?.projects ?? '–'} icon={FolderKanban} iconColor="text-blue-500" />
        <KpiCard label="Open tasks" value={kpis?.activeTasks ?? '–'} icon={ListTodo} iconColor="text-amber-500" />
        <KpiCard label="Overdue tasks" value={kpis?.overdueTasks ?? '–'} icon={AlertTriangle} iconColor="text-red-500" />
        <KpiCard label="Overall completion" value={kpis ? `${kpis.percentComplete}%` : '–'} icon={TrendingUp} iconColor="text-green-500" />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        <Card title="Portfolio" icon={FolderKanban} className="xl:col-span-2" actions={<Link href="/projects" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">View all</Link>}>
          {projects.isLoading ? (
            <PageLoader />
          ) : portfolio.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              message="Create your first project and start planning on the Gantt chart."
              action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create project</Button>}
            />
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
                        <Link href={`/projects/${p._id}`} className="text-sm font-medium text-gray-900 dark:text-white hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {p.stats.taskCount} tasks
                          {p.stats.overdueCount > 0 && <span className="text-red-500"> · {p.stats.overdueCount} overdue</span>}
                        </p>
                      </td>
                      <td className={`${td} hidden sm:table-cell`}>
                        <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                      </td>
                      <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{fmtDate(p.finishDate)}</td>
                      <td className={`${td} w-40`}>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={p.stats.percentComplete} />
                          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-9 text-right">{p.stats.percentComplete}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4 sm:space-y-6">
          <Card title="Upcoming milestones" icon={Diamond}>
            <TaskList
              loading={dashboard.isLoading}
              tasks={dashboard.data?.upcomingMilestones ?? []}
              empty="No milestones in the next 30 days"
              render={(t) => {
                const days = diffDays(today, t.start);
                return <span className="text-xs text-gray-500 dark:text-gray-400">{days === 0 ? 'Today' : `in ${days} day${days === 1 ? '' : 's'}`} · {fmtDate(t.start)}</span>;
              }}
            />
          </Card>
          <Card title="Overdue tasks" icon={AlertTriangle}>
            <TaskList
              loading={dashboard.isLoading}
              tasks={dashboard.data?.overdueTasks ?? []}
              empty="Nothing overdue. Nice work!"
              emptyIcon={CheckCircle2}
              render={(t) => (
                <span className="text-xs text-red-600 dark:text-red-400">
                  Due {fmtDate(t.finish)} · {t.percentComplete}% done
                </span>
              )}
            />
          </Card>
        </div>
      </div>

      <ProjectDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  );
}

function TaskList({
  tasks,
  loading,
  empty,
  emptyIcon = Diamond,
  render,
}: {
  tasks: DashboardTask[];
  loading: boolean;
  empty: string;
  emptyIcon?: typeof Diamond;
  render: (t: DashboardTask) => React.ReactNode;
}) {
  if (loading) return <PageLoader />;
  if (!tasks.length) return <EmptyState icon={emptyIcon} title={empty} compact />;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {tasks.map((t) => (
        <li key={t._id}>
          <Link href={`/projects/${t.project}`} className="block px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate mb-0.5">{t.projectName}</p>
            {render(t)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
