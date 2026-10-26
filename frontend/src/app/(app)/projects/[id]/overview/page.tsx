'use client';

import { Activity, AlertTriangle, CheckCircle2, Diamond, FolderTree, Info, ListTodo, Milestone, PieChart, Plus, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { BarList, LifecycleStrip, StackedShare } from '@/components/charts/Charts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { RichTextView } from '@/components/ui/RichTextEditor';
import { Card, KpiCard, KpiGrid, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ProjectDrawer } from '@/features/ProjectDrawer';
import { useWorkspace } from '@/features/project-context';
import { useProjectOverview } from '@/features/queries';
import { errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dates';
import { formatCustomValue } from '@/lib/query';
import { KIND_LABEL, PROJECT_STATUS } from '@/lib/status';
import { can, projectPeople } from '@/lib/permissions';
import type { UserRef } from '@/lib/types';

export default function OverviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useProjectOverview(id);
  const { workSettings, ctx, openTask } = useWorkspace();
  const [addChild, setAddChild] = useState(false);

  if (isLoading) return <PageLoader label="Loading overview…" />;
  if (error || !data || !workSettings) return <Alert>{errorMessage(error, 'Could not load the overview')}</Alert>;

  const { project, rollup } = data;
  const isContainer = project.kind !== 'project';
  const people = projectPeople(project) as Map<string, UserRef>;
  const statuses = new Map(workSettings.statuses.map((s) => [s._id, s]));
  const types = new Map(workSettings.types.map((t) => [t._id, t]));
  const phases = new Map(workSettings.phases.map((p) => [p._id, p]));
  const projectFields = workSettings.customFields.filter((f) => f.scope === 'project');
  const today = ctx?.today ?? new Date().toISOString().slice(0, 10);

  const statusSegments = workSettings.statuses.map((s) => ({ key: s._id, label: s.name, color: s.color, count: data.counts.status.find((c) => c.value === s._id)?.count ?? 0 }));
  const assigneeRows = data.counts.assignee.map((c) => ({ key: c.value || 'none', label: c.value ? people.get(c.value)?.name ?? 'Former member' : 'Unassigned', value: c.count }));
  const typeRows = data.counts.type.map((c) => ({ key: c.value || 'none', label: types.get(c.value)?.name ?? 'No type', value: c.count }));

  return (
    <div className="space-y-4 sm:space-y-6">
      <KpiGrid>
        <KpiCard label={isContainer ? 'Tasks in all sub-projects' : 'Tasks'} value={rollup?.taskCount ?? 0} icon={ListTodo} iconColor="text-blue-500" />
        <KpiCard label="Completion" value={`${rollup?.percentComplete ?? 0}%`} icon={TrendingUp} iconColor="text-green-500" />
        <KpiCard label="Overdue tasks" value={data.overdue} icon={AlertTriangle} iconColor="text-red-500" />
        {isContainer ? (
          <KpiCard label="Sub-projects" value={rollup?.projectCount ?? 0} icon={FolderTree} iconColor="text-purple-500" />
        ) : (
          <KpiCard label="Finish date" value={<span className="text-xl sm:text-2xl">{fmtDate(rollup?.finishDate ?? project.finishDate)}</span>} icon={CheckCircle2} iconColor="text-amber-500" />
        )}
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card title="About this project" icon={Info}>
          <div className="p-5 space-y-4">
            <RichTextView value={project.description} empty={<p className="text-sm text-gray-400">No description.</p>} />
            <dl className="grid grid-cols-2 gap-4">
              <Meta label="Type">{KIND_LABEL[project.kind]}</Meta>
              <Meta label="Status">
                <Badge tone={PROJECT_STATUS[project.status].tone} dot>
                  {PROJECT_STATUS[project.status].label}
                </Badge>
              </Meta>
              <Meta label="Owner">{project.owner?.name}</Meta>
              <Meta label="Team">{project.members.length + 1} people</Meta>
              {projectFields.map((f) => (
                <Meta key={f._id} label={f.name}>
                  {formatCustomValue(f, project.customValues?.[f._id], people) || <span className="text-gray-400">—</span>}
                </Meta>
              ))}
            </dl>
          </div>
        </Card>
        <Card title="Life cycle" icon={Milestone}>
          <div className="p-5">
            <LifecycleStrip
              today={today}
              phases={(project.lifecycle ?? []).map((p) => {
                const def = phases.get(p.definition);
                return { key: p.definition, name: def?.name ?? 'Phase', color: def?.color ?? '#9ca3af', gate: def?.gate ?? '', start: p.start, finish: p.finish, gateStatus: p.gateStatus };
              })}
            />
            {!project.lifecycle?.length && can(project, 'manage_project') && (
              <Link href={`/projects/${id}/settings`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block">
                Set up phases in Settings
              </Link>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        <Card title="Tasks by status" icon={PieChart}>
          <div className="p-5">
            <StackedShare segments={statusSegments} emptyText="No tasks yet" />
          </div>
        </Card>
        <Card title="Workload (tasks per person)" icon={Users}>
          <div className="p-5">
            <BarList rows={assigneeRows} emptyText="No tasks yet" />
          </div>
        </Card>
        <Card title="Tasks by type" icon={ListTodo}>
          <div className="p-5">
            <BarList rows={typeRows} emptyText="No tasks yet" />
          </div>
        </Card>
      </div>

      {(isContainer || data.children.length > 0) && (
        <Card
          title={`Sub-projects (${data.children.length})`}
          icon={FolderTree}
          actions={
            can(project, 'add_subprojects') && (
              <Button size="sm" icon={Plus} onClick={() => setAddChild(true)}>
                Add sub-project
              </Button>
            )
          }
        >
          {data.children.length === 0 ? (
            <EmptyState icon={FolderTree} title="No sub-projects yet" message="Programs and portfolios roll up the progress of the projects inside them." compact />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={`${th} hidden sm:table-cell`}>Status</th>
                    <th className={`${th} hidden md:table-cell`}>Dates</th>
                    <th className={th}>Progress</th>
                    <th className={`${th} hidden md:table-cell text-right`}>Tasks</th>
                  </tr>
                </thead>
                <tbody className={tbodyCls}>
                  {data.children.map((c) => (
                    <tr key={c._id} className={rowCls}>
                      <td className={td}>
                        <Link href={`/projects/${c._id}/overview`} className="text-sm font-medium text-gray-900 dark:text-white hover:underline">
                          {c.name}
                        </Link>
                        <p className="text-xs text-gray-500">
                          {c.key} · {KIND_LABEL[c.kind]}
                        </p>
                      </td>
                      <td className={`${td} hidden sm:table-cell`}>
                        <Badge tone={PROJECT_STATUS[c.status].tone} dot>
                          {PROJECT_STATUS[c.status].label}
                        </Badge>
                      </td>
                      <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>
                        {fmtDate(c.rollup?.startDate ?? c.startDate)} → {fmtDate(c.rollup?.finishDate ?? c.finishDate)}
                      </td>
                      <td className={`${td} w-40`}>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={c.rollup?.percentComplete ?? 0} />
                          <span className="text-xs tabular-nums w-9 text-right">{c.rollup?.percentComplete ?? 0}%</span>
                        </div>
                      </td>
                      <td className={`${td} hidden md:table-cell text-right text-sm tabular-nums`}>
                        {c.rollup?.taskCount ?? 0}
                        {(c.rollup?.overdueCount ?? 0) > 0 && <span className="text-red-500"> · {c.rollup?.overdueCount} late</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card title="Upcoming milestones (30 days)" icon={Diamond}>
          {data.upcomingMilestones.length === 0 ? (
            <EmptyState icon={Diamond} title="No milestones coming up" compact />
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.upcomingMilestones.map((m) => (
                <li key={m._id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{m.name}</span>
                    <span className="block text-xs text-gray-500">
                      {m.projectKey && m.number ? `${m.projectKey}-${m.number} · ` : ''}
                      {m.projectName}
                    </span>
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtDate(m.start)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent activity" icon={Activity}>
          <div className="p-5">
            <ActivityFeed entries={data.recentActivity} showTask onOpenTask={openTask} />
          </div>
        </Card>
      </div>

      <ProjectDrawer open={addChild} onClose={() => setAddChild(false)} defaultParent={project._id} />
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</dt>
      <dd className="text-sm font-medium text-gray-800 dark:text-gray-100 mt-1 break-words">{children}</dd>
    </div>
  );
}
