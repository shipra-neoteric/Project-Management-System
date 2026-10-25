'use client';

import { Activity, Archive, BarChart3, CalendarDays, CalendarRange, Clock, FileBarChart, KanbanSquare, LayoutGrid, PiggyBank, Presentation, Settings, Star, Table2, Users } from 'lucide-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { TaskDrawerHost } from '@/components/gantt/TaskDrawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { FilterTabs, Page, PageHeader } from '@/components/ui/Layout';
import { ProjectWorkspaceProvider } from '@/features/project-context';
import { useFavorite, useProject, useProjects } from '@/features/queries';
import { toastError } from '@/lib/alerts';
import { ApiError, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dates';
import { KIND_LABEL, PROJECT_STATUS, roleBadge } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import { can } from '@/lib/permissions';
import type { ProjectModule, ProjectPermission } from '@/lib/types';

type TabKey = 'overview' | 'gantt' | 'table' | 'board' | 'calendar' | 'team' | 'resources' | 'time' | 'budgets' | 'reports' | 'meetings' | 'activity' | 'settings';
const SUB_TABS: TabKey[] = ['overview', 'table', 'board', 'calendar', 'team', 'resources', 'time', 'budgets', 'reports', 'meetings', 'activity', 'settings'];
const TABS: { key: TabKey; label: string; icon: typeof BarChart3; module?: ProjectModule; perm?: ProjectPermission[] }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'gantt', label: 'Gantt chart', icon: BarChart3, module: 'gantt' },
  { key: 'table', label: 'Table', icon: Table2, module: 'table' },
  { key: 'board', label: 'Board', icon: KanbanSquare, module: 'board' },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, module: 'calendar' },
  { key: 'team', label: 'Team planner', icon: CalendarRange, module: 'team_planner' },
  { key: 'resources', label: 'Resources', icon: Users, module: 'resources' },
  { key: 'time', label: 'Time & costs', icon: Clock, module: 'time_costs', perm: ['log_time', 'view_time', 'view_costs', 'log_costs'] },
  { key: 'budgets', label: 'Budgets', icon: PiggyBank, module: 'budgets', perm: ['view_budgets'] },
  { key: 'reports', label: 'Reports', icon: FileBarChart, module: 'reports', perm: ['log_time', 'view_time', 'view_costs'] },
  { key: 'meetings', label: 'Meetings', icon: Presentation, module: 'meetings' },
  { key: 'activity', label: 'Activity', icon: Activity, module: 'activity' },
  { key: 'settings', label: 'Settings & team', icon: Settings },
];

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { themeColor } = useTheme();
  const favorite = useFavorite();
  const { data: project, isLoading, error } = useProject(id);
  const { data: allProjects } = useProjects();
  const rollup = allProjects?.find((p) => p._id === id)?.rollup;

  const tab: TabKey = SUB_TABS.find((t) => pathname.endsWith(`/${t}`)) ?? 'gantt';

  if (isLoading) return <PageLoader label="Loading project…" />;
  if (error || !project) {
    const missing = error instanceof ApiError && error.status === 404;
    return missing ? (
      <EmptyState
        icon={BarChart3}
        title="Project not found"
        message="It may have been deleted, or you don't have access to it."
        action={<Button onClick={() => router.push('/projects')}>Back to projects</Button>}
      />
    ) : (
      <Alert>{errorMessage(error, 'Could not load the project')}</Alert>
    );
  }

  const disabled = new Set(project.disabledModules ?? []);
  const tabs = TABS.filter((t) => (!t.module || !disabled.has(t.module)) && (!t.perm || t.perm.some((p) => can({ ...project, status: 'active' }, p))));
  const parent = project.parent && typeof project.parent === 'object' ? project.parent : null;
  const isFav = !!project.favorite;

  return (
    <Page className="space-y-4 sm:space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, ...(parent ? [{ label: parent.name, href: `/projects/${parent._id}/overview` }] : []), { label: project.name }]}
        title={
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="truncate">{project.name}</span>
            <button
              type="button"
              onClick={() => favorite.mutate({ projectId: project._id, on: !isFav }, { onError: (err) => void toastError(errorMessage(err)) })}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
              aria-pressed={isFav}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className="w-5 h-5" style={isFav ? { color: themeColor, fill: themeColor } : { color: 'rgb(156 163 175)' }} />
            </button>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {project.key && <span className="font-mono text-xs font-bold theme-text">{project.key}</span>}
            {project.kind !== 'project' && <Badge tone="purple">{KIND_LABEL[project.kind]}</Badge>}
            {project.isTemplate && <Badge tone="info">Template</Badge>}
            <Badge tone={PROJECT_STATUS[project.status].tone} dot>
              {PROJECT_STATUS[project.status].label}
            </Badge>
            <span>
              {fmtDate(rollup?.startDate ?? project.startDate)} → {fmtDate(rollup?.finishDate ?? project.finishDate)}
            </span>
            <span className="flex items-center gap-2 w-40">
              <ProgressBar value={rollup?.percentComplete ?? project.stats.percentComplete} />
              <span className="tabular-nums text-xs">{rollup?.percentComplete ?? project.stats.percentComplete}%</span>
            </span>
            <Badge tone={roleBadge(project.myRole, project.myRoleName).tone}>You: {roleBadge(project.myRole, project.myRoleName).label}</Badge>
          </span>
        }
      />
      {project.status === 'archived' && (
        <Alert tone="warning">
          <span className="inline-flex items-center gap-2">
            <Archive className="w-4 h-4" /> This project is archived and read-only. A manager can reactivate it under Settings → Edit.
          </span>
        </Alert>
      )}
      <FilterTabs<TabKey> value={tab} onChange={(key) => router.push(`/projects/${id}${key === 'gantt' ? '' : `/${key}`}`)} tabs={tabs} />
      <ProjectWorkspaceProvider projectId={id}>
        {children}
        <TaskDrawerHost />
      </ProjectWorkspaceProvider>
    </Page>
  );
}
