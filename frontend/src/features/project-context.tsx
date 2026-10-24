'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { OPEN_TASK_EVENT } from '@/components/layout/GlobalSearch';
import { usePlan, useResources, useWorkSettings } from '@/features/queries';
import { todayISO } from '@/lib/dates';
import { syncCustomFields, type QueryContext } from '@/lib/query';
import { can as canIn, projectPeople } from '@/lib/permissions';
import type { Plan, ProjectPermission, Resource, Task, UserRef, WorkSettings } from '@/lib/types';

interface ProjectWorkspace {
  projectId: string;
  plan: Plan | undefined;
  tasks: Task[];
  byId: Map<string, Task>;
  resources: Resource[];
  workSettings: WorkSettings | undefined;
  ctx: QueryContext | null;
  /** edit_tasks */
  canEdit: boolean;
  /** manage_project */
  canManage: boolean;
  /** Any project permission for the signed-in user. */
  can: (perm: ProjectPermission) => boolean;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  /** Task currently open in the details drawer. */
  openTaskId: string | null;
  openTask: (id: string | null) => void;
}

const Ctx = createContext<ProjectWorkspace | null>(null);

/** Loads everything a project's views need once, and shares it between tabs. */
export function ProjectWorkspaceProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const plan = usePlan(projectId);
  const resourcesQuery = useResources(projectId);
  const workSettings = useWorkSettings();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Deep links: /projects/:id?task=<taskId> (from search and notifications)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('task');
    if (id) setOpenTaskId(id);
    // Search results for this same project arrive as an event (the page doesn't remount).
    const onOpen = (e: Event) => {
      const { projectId: pid, taskId } = (e as CustomEvent<{ projectId: string; taskId: string }>).detail;
      if (pid === projectId) setOpenTaskId(taskId);
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpen);
  }, [projectId]);

  const openTask = useCallback((id: string | null) => {
    setOpenTaskId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('task', id);
    else url.searchParams.delete('task');
    window.history.replaceState(null, '', url);
  }, []);

  const tasks = useMemo(() => plan.data?.tasks ?? [], [plan.data?.tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t._id, t])), [tasks]);
  const resources = useMemo(() => resourcesQuery.data ?? [], [resourcesQuery.data]);
  const project = plan.data?.project;

  const ctx = useMemo<QueryContext | null>(() => {
    if (!project || !workSettings.data) return null;
    syncCustomFields(workSettings.data.customFields ?? []);
    const people = projectPeople(project) as Map<string, UserRef>;
    return {
      project,
      today: todayISO(),
      types: new Map(workSettings.data.types.map((t) => [t._id, t])),
      statuses: new Map(workSettings.data.statuses.map((s) => [s._id, s])),
      people,
      resources: new Map(resources.map((r) => [r._id, r])),
      categories: new Map((project.categories ?? []).map((c) => [c._id, c.name])),
    };
  }, [project, workSettings.data, resources]);

  const value: ProjectWorkspace = {
    projectId,
    plan: plan.data,
    tasks,
    byId,
    resources,
    workSettings: workSettings.data,
    ctx,
    canEdit: canIn(project, 'edit_tasks'),
    canManage: canIn(project, 'manage_project'),
    can: (perm) => canIn(project, perm),
    isLoading: plan.isLoading || workSettings.isLoading,
    error: plan.error ?? workSettings.error,
    refetch: () => void plan.refetch(),
    openTaskId,
    openTask,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace must be used inside ProjectWorkspaceProvider');
  return ctx;
}
