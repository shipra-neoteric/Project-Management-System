import type { NextFunction, Request, Response } from 'express';
import { Project, type ProjectDoc, type ProjectRole } from '../models/Project';
import type { UserDoc } from '../models/User';
import { assertObjectId, forbidden, notFound } from '../utils/http';

export const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, member: 2, manager: 3, owner: 4 };

/** The caller's effective role on a project, or null if they have no access. Admins act as owners. */
export function roleFor(project: ProjectDoc, user: UserDoc): ProjectRole | null {
  if (user.role === 'Admin') return 'owner';
  const ownerId = (project.owner as { _id?: unknown })?._id ?? project.owner;
  if (String(ownerId) === user._id.toString()) return 'owner';
  const member = project.members.find((m) => {
    const memberId = (m.user as { _id?: unknown })?._id ?? m.user;
    return String(memberId) === user._id.toString();
  });
  if (member) return member.role as ProjectRole;
  // Templates are visible to everyone so they can be used to start new projects.
  return project.isTemplate ? 'viewer' : null;
}

/** Mongo filter for projects visible to a user. */
export function accessFilter(user: UserDoc) {
  if (user.role === 'Admin') return {};
  return { $or: [{ owner: user._id }, { 'members.user': user._id }, { isTemplate: true }] };
}

/**
 * Loads `req.params.id` into `req.project` and enforces a minimum project role.
 * Archived projects are read-only: anything above viewer is refused unless `allowArchived`.
 */
export function loadProject(minRole: ProjectRole, options: { allowArchived?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const id = assertObjectId(String(req.params.id), 'Project');
    const project = await Project.findById(id);
    if (!project) throw notFound('Project');
    const role = roleFor(project, req.user!);
    if (!role) throw notFound('Project'); // don't reveal projects you can't see
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw forbidden(`This action needs the ${minRole} role on this project`);
    if (project.status === 'archived' && minRole !== 'viewer' && !options.allowArchived) {
      throw forbidden('This project is archived and read-only. A manager can reactivate it in Settings.');
    }
    req.project = project;
    req.projectRole = role;
    next();
  };
}
