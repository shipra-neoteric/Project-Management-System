'use client';

import { BarChart3, CalendarDays, KanbanSquare, Settings, Table2, Users } from 'lucide-react';
import { TaskDrawerHost } from '@/components/gantt/TaskDrawer';
import { ProjectWorkspaceProvider } from '@/features/project-context';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader, ProgressBar } from '@/components/ui/Feedback';
import { FilterTabs, Page, PageHeader } from '@/components/ui/Layout';
import { useProject } from '@/features/queries';
import { ApiError, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dates';
import { PROJECT_ROLE, PROJECT_STATUS } from '@/lib/status';

type TabKey = 'gantt' | 'table' | 'board' | 'calendar' | 'resources' | 'settings';
const SUB_TABS: TabKey[] = ['table', 'board', 'calendar', 'resources', 'settings'];

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { data: project, isLoading, error } = useProject(id);

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

  return (
    <Page className="space-y-4 sm:space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {project.key && <span className="font-mono text-xs font-bold theme-text">{project.key}</span>}
            <Badge tone={PROJECT_STATUS[project.status].tone} dot>
              {PROJECT_STATUS[project.status].label}
            </Badge>
            <span>
              {fmtDate(project.startDate)} → {fmtDate(project.finishDate)}
            </span>
            <span className="flex items-center gap-2 w-40">
              <ProgressBar value={project.stats.percentComplete} />
              <span className="tabular-nums text-xs">{project.stats.percentComplete}%</span>
            </span>
            <Badge tone={PROJECT_ROLE[project.myRole].tone}>You: {PROJECT_ROLE[project.myRole].label}</Badge>
          </span>
        }
      />
      <FilterTabs<TabKey>
        value={tab}
        onChange={(key) => router.push(`/projects/${id}${key === 'gantt' ? '' : `/${key}`}`)}
        tabs={[
          { key: 'gantt', label: 'Gantt chart', icon: BarChart3 },
          { key: 'table', label: 'Table', icon: Table2 },
          { key: 'board', label: 'Board', icon: KanbanSquare },
          { key: 'calendar', label: 'Calendar', icon: CalendarDays },
          { key: 'resources', label: 'Resources', icon: Users },
          { key: 'settings', label: 'Settings & team', icon: Settings },
        ]}
      />
      <ProjectWorkspaceProvider projectId={id}>
        {children}
        <TaskDrawerHost />
      </ProjectWorkspaceProvider>
    </Page>
  );
}
