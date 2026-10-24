import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Project permissions. Built-in roles (manager / member / viewer) are editable sets of these;
 * admins can also create custom roles. The project owner and administrators have all of them.
 */
export const PROJECT_PERMISSIONS = [
  { key: 'view_project', label: 'View the project, tasks and views', group: 'Project' },
  { key: 'edit_tasks', label: 'Create, edit, move and delete tasks; upload files', group: 'Tasks' },
  { key: 'comment', label: 'Comment on tasks', group: 'Tasks' },
  { key: 'manage_resources', label: 'Manage resources', group: 'Tasks' },
  { key: 'manage_public_views', label: 'Share saved views with the project', group: 'Project' },
  { key: 'manage_project', label: 'Edit project settings, calendar, phases, baselines', group: 'Project' },
  { key: 'manage_members', label: 'Add and remove members', group: 'Project' },
  { key: 'add_subprojects', label: 'Add sub-projects', group: 'Project' },
  { key: 'delete_project', label: 'Delete the project', group: 'Project' },
  { key: 'view_time', label: 'View everyone’s time entries and reports', group: 'Time & cost' },
  { key: 'log_time', label: 'Log own time', group: 'Time & cost' },
  { key: 'edit_time', label: 'Log and edit time for others', group: 'Time & cost' },
  { key: 'view_costs', label: 'View costs, rates and cost reports', group: 'Time & cost' },
  { key: 'log_costs', label: 'Add material cost entries', group: 'Time & cost' },
  { key: 'view_budgets', label: 'View budgets', group: 'Time & cost' },
  { key: 'manage_budgets', label: 'Create and edit budgets', group: 'Time & cost' },
  { key: 'manage_rates', label: 'Set project hourly rates', group: 'Time & cost' },
] as const;
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number]['key'];
export const ALL_PROJECT_PERMISSIONS = PROJECT_PERMISSIONS.map((p) => p.key) as ProjectPermission[];
/** Permissions that only read data — allowed on archived projects. */
export const READ_PERMISSIONS: ProjectPermission[] = ['view_project', 'view_time', 'view_costs', 'view_budgets'];

export const BUILTIN_ROLES: { key: 'manager' | 'member' | 'viewer'; name: string; permissions: ProjectPermission[] }[] = [
  { key: 'manager', name: 'Manager', permissions: ALL_PROJECT_PERMISSIONS.filter((p) => p !== 'delete_project') },
  {
    key: 'member',
    name: 'Member',
    permissions: ['view_project', 'edit_tasks', 'comment', 'manage_resources', 'view_time', 'log_time', 'log_costs', 'view_budgets'],
  },
  { key: 'viewer', name: 'Viewer', permissions: ['view_project'] },
];

const roleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    /** 'manager' | 'member' | 'viewer' for built-in roles; null for custom roles (referenced by id). */
    key: { type: String, default: null },
    permissions: { type: [String], default: [] },
    position: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type RoleAttrs = InferSchemaType<typeof roleSchema> & { _id: unknown };
export const Role = model('Role', roleSchema);

/** Organisation-wide permissions (administrators have all of them). */
export const GLOBAL_PERMISSIONS = [
  { key: 'create_projects', label: 'Create projects' },
  { key: 'view_all_projects', label: 'See every project (read-only), e.g. for a PMO' },
  { key: 'manage_users', label: 'Manage users, groups, placeholders and invitations' },
  { key: 'manage_work_settings', label: 'Manage types, statuses, workflow, fields, phases, activities, cost types' },
  { key: 'manage_rates', label: 'Set default hourly rates' },
] as const;
export type GlobalPermission = (typeof GLOBAL_PERMISSIONS)[number]['key'];

const globalRoleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    permissions: { type: [String], default: [] },
    /** Default roles apply to every user automatically. */
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const GlobalRole = model('GlobalRole', globalRoleSchema);

/** A group of users that can be added to projects as one member. */
const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', maxlength: 300 },
    members: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true },
);
groupSchema.index({ members: 1 });
export const Group = model('Group', groupSchema);

/** Personal time off (holidays, leave) — reduces capacity in the resource planner. */
const timeOffSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    note: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true },
);
export const TimeOff = model('TimeOff', timeOffSchema);
