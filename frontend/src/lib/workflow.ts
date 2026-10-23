import type { ProjectRole, Workflow } from './types';

/** Mirrors the server rule: owners/admins are never restricted; roles without rules may use any status. */
export function isTransitionAllowed(workflow: Workflow | undefined, role: ProjectRole | undefined, from: string | null, to: string): boolean {
  if (!role || role === 'viewer') return false;
  if (role === 'owner' || !from || from === to) return true;
  const rules = workflow?.[role];
  if (!rules) return true;
  return (rules[from] ?? []).includes(to);
}

/** Built-in task form fields that can be hidden per type (Admin → Types). */
export const OPTIONAL_TASK_FIELDS: { key: string; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'category', label: 'Category' },
  { key: 'accountable', label: 'Accountable' },
  { key: 'resources', label: 'Resources' },
  { key: 'relations', label: 'Related tasks' },
  { key: 'notes', label: 'Notes' },
];
