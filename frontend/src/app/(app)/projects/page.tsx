'use client';

import { CheckCircle2, FolderKanban, FolderOpen, PauseCircle, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { FilterTabs, KpiCard, KpiGrid, Page, PageHeader, rowCls, SearchInput, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ProjectDrawer } from '@/features/ProjectDrawer';
import { useDeleteProject, useProjects } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dates';
import { atLeast, PROJECT_ROLE, PROJECT_STATUS } from '@/lib/status';
import type { Project, ProjectStatus } from '@/lib/types';

type Filter = '' | ProjectStatus;

export default function ProjectsPage() {
  const router = useRouter();
  const { data: projects = [], isLoading, error } = useProjects();
  const remove = useDeleteProject();
  const [filter, setFilter] = useState<Filter>('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': projects.length };
    for (const p of projects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [projects]);

  const visible = projects.filter(
    (p) => (!filter || p.status === filter) && `${p.name} ${p.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const onDelete = async (p: Project) => {
    if (!(await confirmDanger(`Delete "${p.name}"?`, 'All tasks and resources in this project will be permanently deleted.'))) return;
    try {
      await remove.mutateAsync(p._id);
      void toastSuccess('Project deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader
        title="Projects"
        subtitle="Every project you own or have been invited to"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>
            New project
          </Button>
        }
      />

      <KpiGrid>
        <KpiCard label="All projects" value={counts[''] ?? 0} icon={FolderKanban} iconColor="text-gray-400" active={filter === ''} onClick={() => setFilter('')} />
        <KpiCard label="Active" value={counts.active ?? 0} icon={Play} iconColor="text-green-500" active={filter === 'active'} onClick={() => setFilter('active')} />
        <KpiCard label="On hold" value={counts.on_hold ?? 0} icon={PauseCircle} iconColor="text-amber-500" active={filter === 'on_hold'} onClick={() => setFilter('on_hold')} />
        <KpiCard label="Completed" value={counts.completed ?? 0} icon={CheckCircle2} iconColor="text-blue-500" active={filter === 'completed'} onClick={() => setFilter('completed')} />
      </KpiGrid>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <FilterTabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { key: '', label: 'All', count: counts[''] },
            ...(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ key: s as Filter, label: PROJECT_STATUS[s].label, count: counts[s] })),
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
      </div>

      {error && <Alert>{errorMessage(error)}</Alert>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={projects.length ? 'No matching projects' : 'No projects yet'}
            message={projects.length ? 'Try adjusting your search or filters' : 'Create a project to start planning'}
            action={!projects.length && <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Create first project</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Project</th>
                  <th className={`${th} hidden sm:table-cell`}>Status</th>
                  <th className={`${th} hidden lg:table-cell`}>Start</th>
                  <th className={`${th} hidden md:table-cell`}>Finish</th>
                  <th className={th}>Progress</th>
                  <th className={`${th} hidden lg:table-cell`}>Owner</th>
                  <th className={`${th} hidden md:table-cell`}>Your role</th>
                  <th className={`${th} text-right w-24`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {visible.map((p) => (
                  <tr key={p._id} className={`${rowCls} cursor-pointer`} onClick={() => router.push(`/projects/${p._id}`)}>
                    <td className={td}>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                        {p.stats.taskCount} tasks
                        {p.stats.overdueCount > 0 && <span className="text-red-500"> · {p.stats.overdueCount} overdue</span>}
                        {p.description && ` · ${p.description}`}
                      </p>
                    </td>
                    <td className={`${td} hidden sm:table-cell`}>
                      <Badge tone={PROJECT_STATUS[p.status].tone} dot>
                        {PROJECT_STATUS[p.status].label}
                      </Badge>
                    </td>
                    <td className={`${td} hidden lg:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{fmtDate(p.startDate)}</td>
                    <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{fmtDate(p.finishDate)}</td>
                    <td className={`${td} w-40`}>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={p.stats.percentComplete} />
                        <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-9 text-right">{p.stats.percentComplete}%</span>
                      </div>
                    </td>
                    <td className={`${td} hidden lg:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{p.owner?.name}</td>
                    <td className={`${td} hidden md:table-cell`}>
                      <Badge tone={PROJECT_ROLE[p.myRole].tone}>{PROJECT_ROLE[p.myRole].label}</Badge>
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        {atLeast(p.myRole, 'manager') && <IconButton icon={Pencil} label="Edit project" tone="edit" onClick={() => setEditing(p)} />}
                        {p.myRole === 'owner' && <IconButton icon={Trash2} label="Delete project" tone="delete" onClick={() => onDelete(p)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProjectDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <ProjectDrawer open={!!editing} project={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}
