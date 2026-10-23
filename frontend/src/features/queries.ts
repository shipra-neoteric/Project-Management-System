'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Dashboard, LinkType, MemberRole, OrgSettings, Plan, Project, ProjectStatus, Resource, Task, User } from '@/lib/types';

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  plan: (id: string) => ['plan', id] as const,
  resources: (id: string) => ['resources', id] as const,
  users: ['users'] as const,
  dashboard: ['dashboard'] as const,
  settings: ['settings'] as const,
};

// ---- Organisation settings & users ---------------------------------------------------------

export function useOrgSettings(enabled = true) {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<OrgSettings>('/settings'), enabled, staleTime: 5 * 60_000 });
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrgSettings>) => api<OrgSettings>('/settings', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: async () => (await api<{ users: User[] }>('/users')).users });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: User['role']; isActive?: boolean }) =>
      api<{ user: User }>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users }),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api<Dashboard>('/dashboard') });
}

// ---- Projects --------------------------------------------------------------------------------

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: async () => (await api<{ projects: Project[] }>('/projects')).projects });
}

export function useProject(id: string) {
  return useQuery({ queryKey: keys.project(id), queryFn: async () => (await api<{ project: Project }>(`/projects/${id}`)).project });
}

export interface ProjectInput {
  name: string;
  description?: string;
  startDate: string;
  status?: ProjectStatus;
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ProjectInput) => (await api<{ project: Project }>('/projects', { method: 'POST', body })).project,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

/** Writes a plan response into every cache that holds it. */
function usePlanCache() {
  const qc = useQueryClient();
  return (plan: Plan) => {
    qc.setQueryData(keys.plan(plan.project._id), plan);
    qc.setQueryData(keys.project(plan.project._id), plan.project);
    void qc.invalidateQueries({ queryKey: keys.projects });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
  };
}

export function useUpdateProject(id: string) {
  const store = usePlanCache();
  return useMutation({
    mutationKey: keys.plan(id),
    mutationFn: (body: Partial<ProjectInput> & { workingDays?: number[]; holidays?: string[] }) =>
      api<Plan>(`/projects/${id}`, { method: 'PATCH', body }),
    onSuccess: store,
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: keys.project(id) });
      qc.removeQueries({ queryKey: keys.plan(id) });
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useBaseline(id: string) {
  const store = usePlanCache();
  return useMutation({
    mutationKey: keys.plan(id),
    mutationFn: (action: 'set' | 'clear') => api<Plan>(`/projects/${id}/baseline`, { method: action === 'set' ? 'POST' : 'DELETE' }),
    onSuccess: store,
  });
}

export function useMembers(id: string) {
  const qc = useQueryClient();
  const onSuccess = ({ project }: { project: Project }) => {
    qc.setQueryData(keys.project(id), project);
    qc.setQueryData<Plan>(keys.plan(id), (plan) => (plan ? { ...plan, project } : plan));
    void qc.invalidateQueries({ queryKey: keys.projects });
  };
  return {
    add: useMutation({
      mutationFn: (body: { userId: string; role: MemberRole }) => api<{ project: Project }>(`/projects/${id}/members`, { method: 'POST', body }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
        api<{ project: Project }>(`/projects/${id}/members/${userId}`, { method: 'PATCH', body: { role } }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => api<{ project: Project }>(`/projects/${id}/members/${userId}`, { method: 'DELETE' }),
      onSuccess,
    }),
  };
}

// ---- Plan (tasks) ----------------------------------------------------------------------------

export function usePlan(id: string) {
  return useQuery({
    queryKey: keys.plan(id),
    queryFn: () => api<Plan>(`/projects/${id}/tasks`),
    refetchInterval: 15_000, // pick up teammates' changes
  });
}

export interface TaskPatch {
  name?: string;
  duration?: number;
  constraintStart?: string | null;
  percentComplete?: number;
  predecessors?: { task: string; type: LinkType; lag: number }[];
  resources?: string[];
  notes?: string;
}

export function useTaskMutations(projectId: string) {
  const store = usePlanCache();
  const base = `/projects/${projectId}/tasks`;
  const opts = { mutationKey: keys.plan(projectId), onSuccess: store };
  return {
    create: useMutation({
      ...opts,
      mutationFn: (body: { name: string; duration?: number; afterTaskId?: string | null }) =>
        api<Plan & { createdTaskId: string }>(base, { method: 'POST', body }),
    }),
    update: useMutation({
      ...opts,
      mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) => api<Plan>(`${base}/${taskId}`, { method: 'PATCH', body: patch }),
    }),
    remove: useMutation({ ...opts, mutationFn: (taskId: string) => api<Plan>(`${base}/${taskId}`, { method: 'DELETE' }) }),
    move: useMutation({
      ...opts,
      mutationFn: ({ taskId, action }: { taskId: string; action: 'up' | 'down' | 'indent' | 'outdent' }) =>
        api<Plan>(`${base}/${taskId}/move`, { method: 'POST', body: { action } }),
    }),
  };
}

// ---- Resources -------------------------------------------------------------------------------

export function useResources(projectId: string) {
  return useQuery({
    queryKey: keys.resources(projectId),
    queryFn: async () => (await api<{ resources: Resource[] }>(`/projects/${projectId}/resources`)).resources,
  });
}

export interface ResourceInput {
  name: string;
  title?: string;
  email?: string;
  user?: string | null;
}

export function useResourceMutations(projectId: string) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/resources`;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.resources(projectId) });
    void qc.invalidateQueries({ queryKey: keys.plan(projectId) });
  };
  return {
    create: useMutation({ mutationFn: (body: ResourceInput) => api<{ resource: Resource }>(base, { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...body }: ResourceInput & { id: string }) => api<{ resource: Resource }>(`${base}/${id}`, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export type { Task };
