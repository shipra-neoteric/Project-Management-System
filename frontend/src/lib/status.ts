import type { BadgeTone } from '@/components/ui/Badge';
import type { MemberRole, ProjectRole, ProjectStatus, Task } from './types';

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

export const PROJECT_ROLE: Record<ProjectRole, { label: string; tone: BadgeTone; description: string }> = {
  owner: { label: 'Owner', tone: 'purple', description: 'Full control, including deleting the project' },
  manager: { label: 'Manager', tone: 'info', description: 'Edit the plan, settings, members and baseline' },
  member: { label: 'Member', tone: 'success', description: 'Edit tasks and resources' },
  viewer: { label: 'Viewer', tone: 'neutral', description: 'Read-only access' },
};

export const MEMBER_ROLES: MemberRole[] = ['manager', 'member', 'viewer'];

const RANK: Record<ProjectRole, number> = { viewer: 1, member: 2, manager: 3, owner: 4 };
export const atLeast = (role: ProjectRole | undefined, min: ProjectRole) => !!role && RANK[role] >= RANK[min];
