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
}

export interface TaskType {
  _id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isMilestone: boolean;
}

export interface Status {
  _id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isClosed: boolean;
}

export interface WorkSettings {
  types: TaskType[];
  statuses: Status[];
  priorities: Priority[];
}

export type ViewKind = 'gantt' | 'table' | 'board' | 'calendar';

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
