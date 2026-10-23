export type AppRole = 'Admin' | 'User';
export type ProjectRole = 'owner' | 'manager' | 'member' | 'viewer';
export type MemberRole = Exclude<ProjectRole, 'owner'>;
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
}

export type ProjectKind = 'project' | 'program' | 'portfolio';
export type ProjectModule = 'gantt' | 'table' | 'board' | 'calendar' | 'resources' | 'activity';
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
  members: { user: UserRef; role: MemberRole }[];
  baselineSavedAt: string | null;
  stats: ProjectStats;
  myRole: ProjectRole;
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

export type Workflow = Partial<Record<'manager' | 'member', Record<string, string[]>>>;

export interface WorkSettings {
  types: TaskType[];
  statuses: Status[];
  priorities: Priority[];
  phases: PhaseDefinition[];
  customFields: CustomField[];
  workflow: Workflow;
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
