import type { BadgeTone } from '@/components/ui/Badge';
import type { ProjectStatus, Task } from './types';

export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue';

export function taskStatus(task: Pick<Task, 'percentComplete' | 'finish'>, today: string): TaskStatus {
  if (task.percentComplete >= 100) return 'completed';
  if (task.finish && task.finish < today) return 'overdue';
  if (task.percentComplete > 0) return 'in_progress';
  return 'not_started';
}

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: BadgeTone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
};

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
  completed: { label: 'Completed', tone: 'info' },
  archived: { label: 'Archived', tone: 'neutral' },
};

const BUILTIN_ROLE: Record<string, { label: string; tone: BadgeTone; description: string }> = {
  owner: { label: 'Owner', tone: 'purple', description: 'Full control, including deleting the project' },
  manager: { label: 'Manager', tone: 'info', description: 'Edit the plan, settings, members and baseline' },
  member: { label: 'Member', tone: 'success', description: 'Edit tasks and resources, log time' },
  viewer: { label: 'Viewer', tone: 'neutral', description: 'Read-only access' },
};

/** Label and badge tone for a role key (owner / built-in) or a custom role id. */
export function roleBadge(role: string | null | undefined, name?: string): { label: string; tone: BadgeTone; description: string } {
  if (role && BUILTIN_ROLE[role]) return { ...BUILTIN_ROLE[role], label: name || BUILTIN_ROLE[role].label };
  return { label: name || 'Custom role', tone: 'warning', description: 'Custom role' };
}

export const KIND_LABEL: Record<'project' | 'program' | 'portfolio', string> = { project: 'Project', program: 'Program', portfolio: 'Portfolio' };

export const MODULE_LABELS: Record<string, string> = {
  gantt: 'Gantt chart',
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  team_planner: 'Team planner',
  resources: 'Resources',
  time_costs: 'Time & costs',
  budgets: 'Budgets',
  reports: 'Reports',
  activity: 'Activity',
};
