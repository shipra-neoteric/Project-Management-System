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
  return (member?.role as ProjectRole | undefined) ?? null;
}

/** Mongo filter for projects visible to a user. */
export function accessFilter(user: UserDoc) {
  if (user.role === 'Admin') return {};
  return { $or: [{ owner: user._id }, { 'members.user': user._id }] };
}

/** Loads `req.params.id` into `req.project` and enforces a minimum project role. */
export function loadProject(minRole: ProjectRole) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const id = assertObjectId(String(req.params.id), 'Project');
    const project = await Project.findById(id);
    if (!project) throw notFound('Project');
    const role = roleFor(project, req.user!);
    if (!role) throw notFound('Project'); // don't reveal projects you can't see
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw forbidden(`This action needs the ${minRole} role on this project`);
    req.project = project;
    req.projectRole = role;
    next();
  };
}
