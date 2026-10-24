export type AppRole = 'Admin' | 'User';
/** 'owner', a built-in role key ('manager' | 'member' | 'viewer') or a custom role id. */
export type ProjectRole = string;
export type MemberRole = string;
export type ProjectPermission =
  | 'view_project'
  | 'edit_tasks'
  | 'comment'
  | 'manage_resources'
  | 'manage_public_views'
  | 'manage_project'
  | 'manage_members'
  | 'add_subprojects'
  | 'delete_project'
  | 'view_time'
  | 'log_time'
  | 'edit_time'
  | 'view_costs'
  | 'log_costs'
  | 'view_budgets'
  | 'manage_budgets'
  | 'manage_rates';
export type GlobalPermission = 'create_projects' | 'view_all_projects' | 'manage_users' | 'manage_work_settings' | 'manage_rates';
export type ProgressMode = 'manual' | 'work' | 'status';
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type RelationType = 'relates' | 'blocks' | 'duplicates' | 'includes' | 'requires';
export type Priority = 'low' | 'normal' | 'high' | 'immediate';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  emailVerified?: boolean;
  notifyByEmail?: boolean;
  favorites?: string[];
  dashboardWidgets?: string[] | null;
  kind?: 'user' | 'placeholder';
  invited?: boolean;
  globalRoles?: string[];
  workSchedule?: WorkSchedule;
  globalPermissions?: GlobalPermission[];
}

export interface WorkSchedule {
  hoursPerDay: number;
  workingDays: number[];
}

export type ProjectKind = 'project' | 'program' | 'portfolio';
export type ProjectModule = 'gantt' | 'table' | 'board' | 'calendar' | 'team_planner' | 'resources' | 'time_costs' | 'budgets' | 'reports' | 'activity';
export type GateStatus = 'pending' | 'passed' | 'failed';

export interface LifecyclePhase {
  definition: string;
  start: string | null;
  finish: string | null;
  gateStatus: GateStatus;
}

export interface Rollup {
  taskCount: number;
  completedCount: number;
  overdueCount: number;
  percentComplete: number;
  startDate: string | null;
  finishDate: string | null;
  projectCount: number;
}

export interface UserRef {
  _id: string;
  name: string;
  email: string;
  kind?: 'user' | 'placeholder';
  invited?: boolean;
}

/** A project member: a person or a group, with a built-in or custom role. */
export interface ProjectMember {
  _id?: string;
  user: UserRef | null;
  group: { _id: string; name: string; members: UserRef[] } | null;
  role: MemberRole;
}

export interface ProjectStats {
  taskCount: number;
  completedCount: number;
  overdueCount: number;
  percentComplete: number;
}

export interface Category {
  _id: string;
  name: string;
}

export interface Project {
  _id: string;
  name: string;
  key: string;
  categories: Category[];
  kind: ProjectKind;
  parent: string | { _id: string; name: string; key: string; kind: ProjectKind } | null;
  isTemplate: boolean;
  disabledModules: ProjectModule[];
  lifecycle: LifecyclePhase[];
  customValues: Record<string, unknown>;
  favorite?: boolean;
  rollup?: Rollup;
  description: string;
  status: ProjectStatus;
  startDate: string;
  finishDate: string;
  workingDays: number[];
  holidays: string[];
  owner: UserRef;
  members: ProjectMember[];
  progressMode?: ProgressMode;
  baselineSavedAt: string | null;
  stats: ProjectStats;
  myRole: ProjectRole | null;
  myRoleName?: string;
  myPermissions?: ProjectPermission[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskLink {
  task: string;
  type: LinkType;
  lag: number;
}

export interface Task {
  _id: string;
  project: string;
  parent: string | null;
  order: number;
  name: string;
  duration: number;
  constraintStart: string | null;
  percentComplete: number;
  predecessors: TaskLink[];
  resources: string[];
  notes: string;
  type: string | null;
  status: string | null;
  priority: Priority;
  assignee: string | null;
  accountable: string | null;
  category: string | null;
  number: number | null;
  manual: boolean;
  relations: { task: string; type: RelationType }[];
  watchers: string[];
  customValues: Record<string, unknown>;
  baselineStart: string | null;
  baselineFinish: string | null;
  /** Estimated work and remaining work in hours. */
  work?: number | null;
  remainingWork?: number | null;
  /** Hours logged (rolled up for summary tasks). */
  spentHours?: number;
  budget?: string | null;
  start: string;
  finish: string;
  isSummary: boolean;
  isMilestone: boolean;
  isCritical: boolean;
  totalSlack: number;
  wbs: string;
  outlineLevel: number;
  rowNumber: number;
}

export interface Plan {
  project: Project;
  tasks: Task[];
}

export interface Resource {
  _id: string;
  project: string;
  name: string;
  title: string;
  email: string;
  user: string | null;
}

export interface OrgSettings {
  orgName: string;
  themeColor: string;
  currency?: string;
}

export interface DashboardTask {
  _id: string;
  project: string;
  projectName: string;
  name: string;
  start: string;
  finish: string;
  percentComplete: number;
  isMilestone: boolean;
}

export interface Dashboard {
  kpis: { projects: number; activeTasks: number; overdueTasks: number; percentComplete: number };
  upcomingMilestones: DashboardTask[];
  overdueTasks: DashboardTask[];
  myTasks: (DashboardTask & { status: string | null; priority: Priority; number: number | null })[];
  statusCounts: CountRow[];
  assigneeCounts: CountRow[];
}

export interface TaskType {
  _id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isMilestone: boolean;
  hiddenFields: string[];
}

export interface Status {
  _id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isClosed: boolean;
  percentDone?: number | null;
}

export type CustomFieldKind = 'text' | 'longtext' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'user';

export interface CustomField {
  _id: string;
  name: string;
  scope: 'task' | 'project';
  kind: CustomFieldKind;
  options: { _id: string; name: string }[];
  required: boolean;
  position: number;
  description: string;
}

export interface PhaseDefinition {
  _id: string;
  name: string;
  color: string;
  gate: string;
  position: number;
}

/** Role key or custom role id → from status → allowed target statuses. */
export type Workflow = Record<string, Record<string, string[]> | undefined>;

export interface WorkSettings {
  types: TaskType[];
  statuses: Status[];
  priorities: Priority[];
  phases: PhaseDefinition[];
  customFields: CustomField[];
  workflow: Workflow;
  activities: TimeActivity[];
  costTypes: CostType[];
  currency: string;
}

export interface JournalEntry {
  _id: string;
  project: string;
  task: string | null;
  taskName: string;
  user: { _id: string; name: string; email: string } | null;
  kind: 'created' | 'change' | 'comment' | 'deleted' | 'attachment';
  text: string;
  changes: { field: string; label: string; from: string; to: string }[];
  editedAt: string | null;
  createdAt: string;
}

export interface AppNotification {
  _id: string;
  actor: { _id: string; name: string } | null;
  project: string;
  projectName: string;
  task: string | null;
  taskName: string;
  reason: 'mentioned' | 'assigned' | 'accountable' | 'commented' | 'updated' | 'watched';
  summary: string;
  read: boolean;
  createdAt: string;
}

export interface Attachment {
  _id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: { _id: string; name: string } | null;
  createdAt: string;
}

export interface BaselineSummary {
  _id: string;
  name: string;
  finishDate: string;
  createdBy: { _id: string; name: string } | null;
  createdAt: string;
}

export interface CountRow {
  value: string;
  count: number;
}

export interface ProjectOverview {
  project: Project;
  rollup: Rollup;
  children: (Pick<Project, '_id' | 'name' | 'key' | 'kind' | 'status' | 'startDate' | 'finishDate' | 'stats'> & { rollup: Rollup })[];
  counts: { status: CountRow[]; type: CountRow[]; priority: CountRow[]; assignee: CountRow[] };
  upcomingMilestones: { _id: string; name: string; start: string; project: string; projectName: string; projectKey: string; number: number | null }[];
  overdue: number;
  recentActivity: JournalEntry[];
}

export type ViewKind = 'gantt' | 'table' | 'board' | 'calendar' | 'projects';

export interface ViewFilter {
  field: string;
  op: string;
  value?: string | number | boolean | string[] | null;
}

export interface ViewConfig {
  filters: ViewFilter[];
  search: string;
  sort: { field: string; dir: 'asc' | 'desc' }[];
  groupBy: string | null;
  columns: string[];
  options: Record<string, string | number | boolean>;
}

export interface SavedView {
  _id: string;
  project: string;
  owner: string;
  name: string;
  kind: ViewKind;
  isPublic: boolean;
  config: ViewConfig;
}

export interface SearchResults {
  projects: { _id: string; name: string; key: string; status: ProjectStatus }[];
  tasks: { _id: string; project: string; projectName: string; projectKey: string; name: string; number: number | null; start: string; finish: string; percentComplete: number; isMilestone: boolean }[];
}

// ---- Phase 4: time, costs, budgets ----------------------------------------------------------

export interface TimeActivity {
  _id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
}

export interface CostType {
  _id: string;
  name: string;
  unit: string;
  unitRate: number;
  color: string;
  position: number;
}

export interface TimeEntry {
  _id: string;
  project: string;
  projectName: string;
  projectKey: string;
  task: string | null;
  taskName: string;
  taskNumber: number | null;
  user: { _id: string; name: string } | null;
  activity: { _id: string; name: string; color: string } | null;
  date: string;
  hours: number;
  comment: string;
  rate: number | null;
  cost: number | null;
}

export interface CostEntry {
  _id: string;
  project: string;
  task: string | null;
  budget: string | null;
  costType: { _id: string; name: string; unit: string } | null;
  user: { _id: string; name: string } | null;
  date: string;
  units: number;
  unitRate: number;
  cost: number;
  comment: string;
}

export interface BudgetSummary {
  plannedLabor: number;
  plannedMaterial: number;
  planned: number;
  actualLabor: number;
  actualMaterial: number;
  actual: number;
  hours: number;
  plannedHours: number;
  remaining: number;
  percentUsed: number;
}

export interface Budget {
  _id: string;
  project: string;
  name: string;
  description: string;
  labor: { _id?: string; label: string; user: { _id: string; name: string } | string | null; hours: number; rate: number }[];
  material: { _id?: string; costType: { _id: string; name: string; unit: string } | string; units: number; unitRate: number; comment: string }[];
  summary?: BudgetSummary;
}

export interface HourlyRate {
  _id: string;
  user: { _id: string; name: string } | string;
  project: string | null;
  rate: number;
  validFrom: string;
}

export type ReportKind = 'time' | 'cost';
export type ReportGroupBy = 'user' | 'activity' | 'task' | 'month' | 'week' | 'costType' | 'project';

export interface Report {
  kind: ReportKind;
  groupBy: ReportGroupBy;
  rows: { key: string; label: string; hours: number; units: number; cost: number | null; count: number }[];
  totals: { hours: number; cost: number | null; entries: number };
  projects: number;
  generatedAt: string;
}

// ---- Phase 5: roles, groups, planning -------------------------------------------------------

export interface Role {
  _id: string;
  name: string;
  /** 'manager' | 'member' | 'viewer' for built-in roles; null for custom roles. */
  key: string | null;
  permissions: ProjectPermission[];
  position: number;
}

export interface PermissionInfo<K extends string = string> {
  key: K;
  label: string;
  group?: string;
}

export interface GlobalRole {
  _id: string;
  name: string;
  permissions: GlobalPermission[];
  isDefault: boolean;
}

export interface Group {
  _id: string;
  name: string;
  description: string;
  members: UserRef[];
}

export interface TimeOff {
  _id: string;
  user: string;
  start: string;
  end: string;
  note: string;
}

export interface Planner {
  from: string;
  to: string;
  days: string[];
  users: { _id: string; name: string; kind: 'user' | 'placeholder'; hoursPerDay: number }[];
  capacity: Record<string, number[]>;
  allocation: Record<string, number[]>;
  tasks: { _id: string; project: string; projectName: string; projectKey: string; name: string; number: number | null; assignee: string; start: string; finish: string; hoursPerDay: number }[];
  timeOff: { user: string; start: string; end: string; note: string }[];
}
