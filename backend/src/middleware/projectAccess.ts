import type { NextFunction, Request, Response } from 'express';
import { READ_PERMISSIONS, type ProjectPermission } from '../models/Access';
import { Project } from '../models/Project';
import { accessFor } from '../services/permissions';
import { assertObjectId, forbidden, notFound } from '../utils/http';

export { accessFilter, roleFor } from '../services/permissions';

/** Legacy role names still used by some routes, mapped to the permission they stand for. */
const LEGACY: Record<string, ProjectPermission> = {
  viewer: 'view_project',
  member: 'edit_tasks',
  manager: 'manage_project',
  owner: 'delete_project',
};

const FRIENDLY: Partial<Record<ProjectPermission, string>> = {
  edit_tasks: 'edit tasks',
  manage_project: 'manage this project',
  delete_project: 'delete this project',
  manage_members: 'manage members',
  log_time: 'log time',
  edit_time: 'edit other people’s time',
  view_time: 'see time entries',
  view_costs: 'see costs',
  log_costs: 'add cost entries',
  manage_budgets: 'manage budgets',
  view_budgets: 'see budgets',
  manage_rates: 'set hourly rates',
};

/**
 * Loads `req.params.id` into `req.project` and checks a project permission (or a legacy role name).
 * Projects you can't see return 404. Archived projects only allow read permissions unless `allowArchived`.
 */
export function loadProject(need: ProjectPermission | 'viewer' | 'member' | 'manager' | 'owner', options: { allowArchived?: boolean } = {}) {
  const perm = LEGACY[need] ?? (need as ProjectPermission);
  return async (req: Request, _res: Response, next: NextFunction) => {
    const id = assertObjectId(String(req.params.id), 'Project');
    const project = await Project.findById(id);
    if (!project) throw notFound('Project');
    const access = accessFor(project, req.user!);
    if (!access) throw notFound('Project'); // don't reveal projects you can't see
    if (!access.permissions.has(perm)) throw forbidden(`You don't have permission to ${FRIENDLY[perm] ?? perm.replace(/_/g, ' ')} in this project`);
    if (project.status === 'archived' && !READ_PERMISSIONS.includes(perm) && !options.allowArchived) {
      throw forbidden('This project is archived and read-only. A manager can reactivate it in Settings.');
    }
    req.project = project;
    req.projectRole = access.role;
    req.permissions = access.permissions;
    next();
  };
}

/** Permission check inside a handler after loadProject ran. */
export function hasPerm(req: Request, perm: ProjectPermission) {
  return !!req.permissions?.has(perm);
}
