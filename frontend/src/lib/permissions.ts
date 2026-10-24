import type { GlobalPermission, Project, ProjectPermission, User } from './types';

/** Does the signed-in user have this permission in the project? (The API enforces it too.) */
export function can(project: Pick<Project, 'myPermissions' | 'status'> | null | undefined, perm: ProjectPermission): boolean {
  if (!project?.myPermissions?.includes(perm)) return false;
  // Archived projects are read-only.
  if (project.status === 'archived') return perm === 'view_project' || perm.startsWith('view_');
  return true;
}

/** Organisation-wide permission (administrators have all of them). */
export function hasGlobal(user: Pick<User, 'role' | 'globalPermissions'> | null | undefined, perm: GlobalPermission): boolean {
  if (!user) return false;
  return user.role === 'Admin' || !!user.globalPermissions?.includes(perm);
}

/** Owner, direct members and the members of member groups — everyone who can be assigned work. */
export function projectPeople(project: Pick<Project, 'owner' | 'members'>) {
  const people = new Map<string, Project['owner']>();
  if (project.owner) people.set(project.owner._id, project.owner);
  for (const m of project.members ?? []) {
    if (m.user) people.set(m.user._id, m.user);
    for (const u of m.group?.members ?? []) people.set(u._id, u);
  }
  return people;
}

export const ROLE_PERMISSION_GROUPS = ['Project', 'Tasks', 'Time & cost'] as const;
