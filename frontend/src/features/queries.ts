'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
import type {
  Dashboard,
  LinkType,
  MemberRole,
  OrgSettings,
  Plan,
  Priority,
  Project,
  ProjectStatus,
  RelationType,
  Resource,
  AppNotification,
  Attachment,
  BaselineSummary,
  JournalEntry,
  ProjectOverview,
  Workflow,
  SavedView,
  SearchResults,
  Status,
  Task,
  TaskType,
  User,
  ViewConfig,
  ViewKind,
  WorkSettings,
  Budget,
  CostEntry,
  GlobalRole,
  Group,
  HourlyRate,
  PermissionInfo,
  Planner,
  ProjectPermission,
  GlobalPermission,
  Report,
  ReportGroupBy,
  ReportKind,
  Role,
  TimeEntry,
  TimeOff,
  WorkSchedule,
} from '@/lib/types';

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  plan: (id: string) => ['plan', id] as const,
  resources: (id: string) => ['resources', id] as const,
  users: ['users'] as const,
  dashboard: ['dashboard'] as const,
  settings: ['settings'] as const,
  workSettings: ['work-settings'] as const,
  views: (id: string) => ['views', id] as const,
  search: (q: string) => ['search', q] as const,
  activity: (taskId: string) => ['activity', taskId] as const,
  attachments: (taskId: string) => ['attachments', taskId] as const,
  projectActivity: (id: string) => ['project-activity', id] as const,
  notifications: ['notifications'] as const,
  overview: (id: string) => ['overview', id] as const,
  baselines: (id: string) => ['baselines', id] as const,
  projectViews: ['project-views'] as const,
  roles: ['roles'] as const,
  globalRoles: ['global-roles'] as const,
  groups: ['groups'] as const,
  timeEntries: (filter: TimeEntryFilter) => ['time-entries', filter] as const,
  costEntries: (id: string) => ['cost-entries', id] as const,
  budgets: (id: string) => ['budgets', id] as const,
  projectRates: (id: string) => ['project-rates', id] as const,
  rates: (userId: string) => ['rates', userId] as const,
  timeOff: (userId: string) => ['time-off', userId] as const,
  planner: (from: string, to: string, project?: string) => ['planner', from, to, project ?? null] as const,
  report: (id: string, params: ReportParams) => ['report', id, params] as const,
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
    mutationFn: ({ id, ...body }: { id: string; role?: User['role']; isActive?: boolean; name?: string; globalRoles?: string[]; workSchedule?: WorkSchedule }) =>
      api<{ user: User }>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users }),
  });
}

/** Placeholders, invitations and removing them. */
export function useUserAdmin() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.users });
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: ['plan'] });
  };
  return {
    addPlaceholder: useMutation({ mutationFn: (name: string) => api<{ user: User }>('/users/placeholders', { method: 'POST', body: { name } }), onSuccess: refresh }),
    replacePlaceholder: useMutation({
      mutationFn: ({ id, userId }: { id: string; userId: string }) => api<{ user: User }>(`/users/${id}/replace`, { method: 'POST', body: { userId } }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/users/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
    invite: useMutation({
      mutationFn: (body: { email: string; name?: string; projectId?: string; role?: string }) => api<{ user: User }>('/users/invite', { method: 'POST', body }),
      onSuccess: refresh,
    }),
    resendInvite: useMutation({ mutationFn: (id: string) => api(`/users/${id}/resend-invite`, { method: 'POST' }) }),
  };
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
  kind?: Project['kind'];
  parent?: string | null;
  isTemplate?: boolean;
  fromProject?: string | null;
  copy?: CopyOptions;
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
    void qc.invalidateQueries({ queryKey: keys.overview(plan.project._id) });
    void qc.invalidateQueries({ queryKey: keys.projectActivity(plan.project._id) });
    void qc.invalidateQueries({ queryKey: ['activity'] });
  };
}

export function useUpdateProject(id: string) {
  const store = usePlanCache();
  return useMutation({
    mutationKey: keys.plan(id),
    mutationFn: (
      body: Partial<Omit<ProjectInput, 'fromProject' | 'copy'>> & {
        key?: string;
        workingDays?: number[];
        holidays?: string[];
        categories?: { _id?: string; name: string }[];
        disabledModules?: Project['disabledModules'];
        lifecycle?: Project['lifecycle'];
        customValues?: Record<string, unknown>;
      },
    ) =>
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
    /** Add a person (`userId`) or a group (`groupId`). */
    add: useMutation({
      mutationFn: (body: { userId?: string; groupId?: string; role: MemberRole }) => api<{ project: Project }>(`/projects/${id}/members`, { method: 'POST', body }),
      onSuccess,
    }),
    /** `memberId` is the member's user id or group id. */
    update: useMutation({
      mutationFn: ({ memberId, role }: { memberId: string; role: MemberRole }) =>
        api<{ project: Project }>(`/projects/${id}/members/${memberId}`, { method: 'PATCH', body: { role } }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (memberId: string) => api<{ project: Project }>(`/projects/${id}/members/${memberId}`, { method: 'DELETE' }),
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

/** Attributes that can be set on one task or many at once. */
export interface TaskAttributes {
  customValues?: Record<string, unknown>;
  type?: string;
  status?: string;
  priority?: Priority;
  assignee?: string | null;
  accountable?: string | null;
  category?: string | null;
  percentComplete?: number;
  budget?: string | null;
  work?: number | null;
  remainingWork?: number | null;
}

export interface TaskPatch extends TaskAttributes {
  name?: string;
  manual?: boolean;
  relations?: { task: string; type: RelationType }[];
  duration?: number;
  constraintStart?: string | null;
  percentComplete?: number;
  predecessors?: { task: string; type: LinkType; lag: number }[];
  resources?: string[];
  notes?: string;
}

export function useTaskMutations(projectId: string) {
  const store = usePlanCache();
  const qc = useQueryClient();
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
    bulk: useMutation({
      ...opts,
      mutationFn: ({ taskIds, patch }: { taskIds: string[]; patch: TaskAttributes }) => api<Plan>(`${base}/bulk`, { method: 'POST', body: { taskIds, patch } }),
    }),
    bulkDelete: useMutation({ ...opts, mutationFn: (taskIds: string[]) => api<Plan>(`${base}/bulk-delete`, { method: 'POST', body: { taskIds } }) }),
    transfer: useMutation({
      ...opts,
      mutationFn: (body: { taskIds: string[]; targetProjectId: string; mode: 'copy' | 'move' }) =>
        api<Plan & { transferred: number }>(`${base}/transfer`, { method: 'POST', body }),
      onSuccess: (plan: Plan, vars) => {
        store(plan);
        if (vars.targetProjectId !== projectId) void qc.invalidateQueries({ queryKey: keys.plan(vars.targetProjectId) });
      },
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

// ---- Types, statuses, priorities ------------------------------------------------------------

export function useWorkSettings() {
  return useQuery({ queryKey: keys.workSettings, queryFn: () => api<WorkSettings>('/work-settings'), staleTime: 5 * 60_000 });
}

export function useWorkSettingsMutations() {
  const qc = useQueryClient();
  const onSuccess = (data: WorkSettings) => {
    qc.setQueryData<WorkSettings>(keys.workSettings, (old) => ({ ...data, priorities: old?.priorities ?? data.priorities }));
  };
  type Kind = 'types' | 'statuses' | 'phases' | 'custom-fields' | 'activities' | 'cost-types';
  return {
    create: useMutation({
      mutationFn: ({ kind, body }: { kind: Kind; body: Record<string, unknown> }) => api<WorkSettings>(`/work-settings/${kind}`, { method: 'POST', body }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ kind, id, body }: { kind: Kind; id: string; body: Record<string, unknown> }) =>
        api<WorkSettings>(`/work-settings/${kind}/${id}`, { method: 'PATCH', body }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: ({ kind, id }: { kind: Kind; id: string }) => api<WorkSettings>(`/work-settings/${kind}/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
  };
}

// ---- Saved views & search ----------------------------------------------------------------------

export function useViews(projectId: string) {
  return useQuery({ queryKey: keys.views(projectId), queryFn: async () => (await api<{ views: SavedView[] }>(`/projects/${projectId}/views`)).views });
}

export function useViewMutations(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.views(projectId) });
  const base = `/projects/${projectId}/views`;
  return {
    create: useMutation({
      mutationFn: async (body: { name: string; kind: ViewKind; isPublic: boolean; config: ViewConfig }) =>
        (await api<{ view: SavedView }>(base, { method: 'POST', body })).view,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: { id: string; name?: string; isPublic?: boolean; config?: ViewConfig }) =>
        (await api<{ view: SavedView }>(`${base}/${id}`, { method: 'PATCH', body })).view,
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.search(term),
    queryFn: () => api<SearchResults>(`/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });
}

// ---- Phase 1: activity, comments, watching, attachments, notifications -------------------------

export function useTaskActivity(projectId: string, taskId: string) {
  return useQuery({
    queryKey: keys.activity(taskId),
    queryFn: () => api<{ activity: JournalEntry[]; watchers: string[] }>(`/projects/${projectId}/tasks/${taskId}/activity`),
    refetchInterval: 20_000,
  });
}

export function useCommentMutations(projectId: string, taskId: string) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/tasks/${taskId}`;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.activity(taskId) });
    void qc.invalidateQueries({ queryKey: keys.projectActivity(projectId) });
  };
  return {
    add: useMutation({ mutationFn: (text: string) => api(`${base}/comments`, { method: 'POST', body: { text } }), onSuccess: refresh }),
    edit: useMutation({ mutationFn: ({ id, text }: { id: string; text: string }) => api(`${base}/comments/${id}`, { method: 'PATCH', body: { text } }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`${base}/comments/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
    watch: useMutation({
      mutationFn: (on: boolean) => api(`${base}/watch`, { method: on ? 'POST' : 'DELETE' }),
      onSuccess: () => {
        refresh();
        void qc.invalidateQueries({ queryKey: keys.plan(projectId) });
      },
    }),
  };
}

export function useProjectActivity(projectId: string) {
  return useQuery({
    queryKey: keys.projectActivity(projectId),
    queryFn: async () => (await api<{ activity: JournalEntry[] }>(`/projects/${projectId}/activity?limit=100`)).activity,
  });
}

export function useAttachments(projectId: string, taskId: string) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/tasks/${taskId}/attachments`;
  const query = useQuery({ queryKey: keys.attachments(taskId), queryFn: async () => (await api<{ attachments: Attachment[] }>(base)).attachments });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.attachments(taskId) });
    void qc.invalidateQueries({ queryKey: keys.activity(taskId) });
  };
  const upload = useMutation({ mutationFn: (file: File) => apiUpload(base, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  return { ...query, upload, remove, downloadUrl: (id: string) => `${base}/${id}` };
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: [...keys.notifications, unreadOnly],
    queryFn: () => api<{ notifications: AppNotification[]; unreadCount: number }>(`/notifications?limit=50${unreadOnly ? '&unread=1' : ''}`),
    refetchInterval: 30_000,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: [...keys.notifications, 'count'],
    queryFn: async () => (await api<{ unreadCount: number }>('/notifications/count')).unreadCount,
    refetchInterval: 30_000,
    enabled,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean; read?: boolean }) => api<{ unreadCount: number }>('/notifications/read', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

// ---- Phase 3: overview, baselines, favorites, copy, project lists ------------------------------

export function useProjectOverview(projectId: string) {
  return useQuery({ queryKey: keys.overview(projectId), queryFn: () => api<ProjectOverview>(`/projects/${projectId}/overview`) });
}

export function useBaselines(projectId: string) {
  const qc = useQueryClient();
  const store = usePlanCache();
  const query = useQuery({
    queryKey: keys.baselines(projectId),
    queryFn: async () => (await api<{ baselines: BaselineSummary[] }>(`/projects/${projectId}/baselines`)).baselines,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.baselines(projectId) });
  return {
    ...query,
    create: useMutation({
      mutationKey: keys.plan(projectId),
      mutationFn: (name: string) => api<Plan>(`/projects/${projectId}/baselines`, { method: 'POST', body: { name } }),
      onSuccess: (plan) => {
        store(plan);
        void refresh();
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/projects/${projectId}/baselines/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useBaselineSnapshot(projectId: string, baselineId: string | null) {
  return useQuery({
    queryKey: ['baseline', projectId, baselineId],
    queryFn: async () =>
      (await api<{ baseline: BaselineSummary & { tasks: { task: string; start: string; finish: string }[] } }>(`/projects/${projectId}/baselines/${baselineId}`)).baseline,
    enabled: !!baselineId,
    staleTime: Infinity,
  });
}

export function useFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, on }: { projectId: string; on: boolean }) => api(`/projects/${projectId}/favorite`, { method: on ? 'POST' : 'DELETE' }),
    onSuccess: (_d, { projectId }) => {
      void qc.invalidateQueries({ queryKey: keys.projects });
      void qc.invalidateQueries({ queryKey: keys.project(projectId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export interface CopyOptions {
  tasks: boolean;
  resources: boolean;
  members: boolean;
  views: boolean;
}

export function useCopyProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; startDate: string; parent?: string | null; isTemplate?: boolean; copy: CopyOptions }) =>
      (await api<{ project: Project }>(`/projects/${projectId}/copy`, { method: 'POST', body })).project,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useProjectViews() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: keys.projectViews, queryFn: async () => (await api<{ views: SavedView[] }>('/project-views')).views });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.projectViews });
  return {
    ...query,
    create: useMutation({
      mutationFn: async (body: { name: string; isPublic: boolean; config: ViewConfig }) => (await api<{ view: SavedView }>('/project-views', { method: 'POST', body })).view,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: { id: string; config: ViewConfig }) => (await api<{ view: SavedView }>(`/project-views/${id}`, { method: 'PATCH', body })).view,
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/project-views/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useWorkflowMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workflow: Workflow) =>
      api<WorkSettings>('/work-settings/workflow', { method: 'PUT', body: Object.fromEntries(Object.entries(workflow).map(([role, rules]) => [role, rules ?? null])) }),
    onSuccess: (data) => qc.setQueryData(keys.workSettings, data),
  });
}

// ---- Phase 4: time, costs, budgets, rates, reports ---------------------------------------------

export interface TimeEntryFilter {
  project?: string;
  task?: string;
  user?: string;
  from?: string;
  to?: string;
}

const qs = (params: object) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

/** Time entries: your own across projects (no `project`), or a project's (everyone's if you may view time). */
export function useTimeEntries(filter: TimeEntryFilter, enabled = true) {
  return useQuery({
    queryKey: keys.timeEntries(filter),
    queryFn: async () => (await api<{ entries: TimeEntry[] }>(`/time-entries${qs(filter)}`)).entries,
    enabled,
  });
}

export interface TimeEntryInput {
  project: string;
  task?: string | null;
  user?: string;
  activity?: string | null;
  date: string;
  hours: number;
  comment?: string;
}

export function useTimeMutations() {
  const qc = useQueryClient();
  const refresh = (projectId?: string) => {
    void qc.invalidateQueries({ queryKey: ['time-entries'] });
    void qc.invalidateQueries({ queryKey: ['report'] });
    void qc.invalidateQueries({ queryKey: ['budgets'] });
    void qc.invalidateQueries({ queryKey: projectId ? keys.plan(projectId) : ['plan'] });
  };
  return {
    create: useMutation({ mutationFn: (body: TimeEntryInput) => api<{ entry: TimeEntry }>('/time-entries', { method: 'POST', body }), onSuccess: (_d, v) => refresh(v.project) }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Omit<TimeEntryInput, 'project' | 'user'>> & { id: string }) => api<{ entry: TimeEntry }>(`/time-entries/${id}`, { method: 'PATCH', body }),
      onSuccess: () => refresh(),
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/time-entries/${id}`, { method: 'DELETE' }), onSuccess: () => refresh() }),
    /** Weekly timesheet: set your total hours for one project/task/activity/day (0 clears it). */
    setCell: useMutation({
      mutationFn: (body: { project: string; task: string | null; activity: string | null; date: string; hours: number }) =>
        api('/time-entries/cell', { method: 'PUT', body }),
      onSuccess: (_d, v) => refresh(v.project),
    }),
  };
}

export function useCostEntries(projectId: string, enabled = true) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/cost-entries`;
  const query = useQuery({ queryKey: keys.costEntries(projectId), queryFn: async () => (await api<{ entries: CostEntry[] }>(base)).entries, enabled });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.costEntries(projectId) });
    void qc.invalidateQueries({ queryKey: keys.budgets(projectId) });
    void qc.invalidateQueries({ queryKey: ['report', projectId] });
  };
  type Input = { costType: string; units: number; date: string; task?: string | null; budget?: string | null; comment?: string };
  return {
    ...query,
    create: useMutation({ mutationFn: (body: Input) => api<{ entry: CostEntry }>(base, { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<Input> & { id: string }) => api<{ entry: CostEntry }>(`${base}/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export interface BudgetInput {
  name: string;
  description?: string;
  labor: { label: string; user?: string | null; hours: number; rate: number }[];
  material: { costType: string; units: number; unitRate?: number; comment?: string }[];
}

export function useBudgets(projectId: string, enabled = true) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/budgets`;
  const query = useQuery({
    queryKey: keys.budgets(projectId),
    queryFn: () => api<{ budgets: Budget[]; canSeeMoney: boolean }>(base),
    enabled,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.budgets(projectId) });
    void qc.invalidateQueries({ queryKey: keys.plan(projectId) });
  };
  return {
    ...query,
    create: useMutation({ mutationFn: (body: BudgetInput) => api<{ budget: Budget }>(base, { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<BudgetInput> & { id: string }) => api<{ budget: Budget }>(`${base}/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

/** Project-specific hourly rates (override a person's default rate in this project). */
export function useProjectRates(projectId: string, enabled = true) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/rates`;
  const query = useQuery({ queryKey: keys.projectRates(projectId), queryFn: async () => (await api<{ rates: HourlyRate[] }>(base)).rates, enabled });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.projectRates(projectId) });
    void qc.invalidateQueries({ queryKey: ['time-entries'] });
    void qc.invalidateQueries({ queryKey: ['report', projectId] });
    void qc.invalidateQueries({ queryKey: keys.budgets(projectId) });
  };
  return {
    ...query,
    set: useMutation({ mutationFn: (body: { user: string; rate: number; validFrom: string }) => api(base, { method: 'POST', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

/** A person's default hourly rates (history by "valid from" date). */
export function useDefaultRates(userId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.rates(userId ?? ''),
    queryFn: async () => (await api<{ rates: HourlyRate[] }>(`/rates?user=${userId}`)).rates,
    enabled: !!userId,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['rates'] });
    void qc.invalidateQueries({ queryKey: ['time-entries'] });
    void qc.invalidateQueries({ queryKey: ['report'] });
  };
  return {
    ...query,
    set: useMutation({ mutationFn: (body: { user: string; rate: number; validFrom: string }) => api('/rates', { method: 'POST', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/rates/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export interface ReportParams {
  kind: ReportKind;
  groupBy: ReportGroupBy;
  from?: string;
  to?: string;
  includeSubprojects?: boolean;
  user?: string;
}

export function useReport(projectId: string, params: ReportParams, enabled = true) {
  return useQuery({
    queryKey: keys.report(projectId, params),
    queryFn: () => api<Report>(`/projects/${projectId}/reports${qs(params)}`),
    enabled,
  });
}

// ---- Phase 5: roles, groups, time off, planner --------------------------------------------------

export function useRoles() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.roles,
    queryFn: () => api<{ roles: Role[]; permissions: PermissionInfo<ProjectPermission>[] }>('/roles'),
    staleTime: 60_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.roles });
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: ['plan'] });
    void qc.invalidateQueries({ queryKey: keys.projects });
  };
  type Input = { name: string; permissions: ProjectPermission[] };
  return {
    ...query,
    create: useMutation({ mutationFn: (body: Input) => api<{ role: Role }>('/roles', { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<Input> & { id: string }) => api<{ role: Role }>(`/roles/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/roles/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useGlobalRoles(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.globalRoles,
    queryFn: () => api<{ roles: GlobalRole[]; permissions: PermissionInfo<GlobalPermission>[] }>('/global-roles'),
    enabled,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.globalRoles });
    void qc.invalidateQueries({ queryKey: keys.users });
  };
  type Input = { name: string; permissions: GlobalPermission[]; isDefault: boolean };
  return {
    ...query,
    create: useMutation({ mutationFn: (body: Input) => api<{ role: GlobalRole }>('/global-roles', { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Input> & { id: string }) => api<{ role: GlobalRole }>(`/global-roles/${id}`, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/global-roles/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useGroups(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: keys.groups, queryFn: async () => (await api<{ groups: Group[] }>('/groups')).groups, enabled });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.groups });
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: ['plan'] });
  };
  type Input = { name: string; description?: string; members?: string[] };
  return {
    ...query,
    create: useMutation({ mutationFn: (body: Input) => api<{ group: Group }>('/groups', { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<Input> & { id: string }) => api<{ group: Group }>(`/groups/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/groups/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export function useTimeOff(userId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.timeOff(userId ?? ''),
    queryFn: async () => (await api<{ timeOff: TimeOff[] }>(`/time-off?user=${userId}`)).timeOff,
    enabled: !!userId,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['time-off'] });
    void qc.invalidateQueries({ queryKey: ['planner'] });
  };
  return {
    ...query,
    add: useMutation({ mutationFn: (body: { start: string; end: string; note?: string; user?: string }) => api('/time-off', { method: 'POST', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/time-off/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

/** Capacity vs allocated hours per person per day (optionally only one project's team). */
export function usePlanner(from: string, to: string, project?: string) {
  return useQuery({
    queryKey: keys.planner(from, to, project),
    queryFn: () => api<Planner>(`/planner${qs({ from, to, project })}`),
  });
}
