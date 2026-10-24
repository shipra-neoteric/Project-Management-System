import type { Types } from 'mongoose';
import {
  ALL_PROJECT_PERMISSIONS,
  BUILTIN_ROLES,
  GLOBAL_PERMISSIONS,
  GlobalRole,
  Group,
  Role,
  type GlobalPermission,
  type ProjectPermission,
} from '../models/Access';
import type { ProjectDoc } from '../models/Project';
import type { UserDoc } from '../models/User';

interface RoleInfo {
  id: string;
  key: string | null;
  name: string;
  permissions: Set<string>;
}

let cache: { roles: Map<string, RoleInfo>; loadedAt: number } | null = null;
let seeding: Promise<void> | null = null;
const TTL_MS = 30_000;

/** Creates the built-in project roles and the default global role on first use. Idempotent. */
export function ensureAccessDefaults(): Promise<void> {
  seeding ??= (async () => {
    for (const [i, r] of BUILTIN_ROLES.entries()) {
      if (!(await Role.exists({ key: r.key }))) await Role.create({ ...r, position: i });
    }
    if ((await GlobalRole.estimatedDocumentCount()) === 0) {
      // Everyone may create projects by default — admins can change this in Roles & permissions.
      await GlobalRole.create({ name: 'Everyone', permissions: ['create_projects'], isDefault: true });
    }
  })().catch((err) => {
    seeding = null;
    throw err;
  });
  return seeding;
}

/** Loads (or refreshes) the project-role cache. Called by requireAuth so lookups below stay synchronous. */
export async function loadRoles(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return cache.roles;
  await ensureAccessDefaults();
  const roles = await Role.find().lean();
  const map = new Map<string, RoleInfo>();
  for (const r of roles) {
    const info = { id: String(r._id), key: r.key ?? null, name: r.name, permissions: new Set(r.permissions) };
    map.set(String(r._id), info);
    if (r.key) map.set(r.key, info);
  }
  cache = { roles: map, loadedAt: Date.now() };
  return map;
}

export const invalidateRoles = () => {
  cache = null;
};

/** Looks up a role by built-in key or custom id (cache must be loaded). */
export function roleInfo(roleKey: string): RoleInfo | undefined {
  return cache?.roles.get(roleKey);
}

export function roleName(roleKey: string): string {
  if (roleKey === 'owner') return 'Owner';
  return roleInfo(roleKey)?.name ?? 'Unknown role';
}

/** Attaches group membership and global permissions to a user (stored on `user.$locals`). */
export async function attachAccess(user: UserDoc) {
  const [groups, globalRoles] = await Promise.all([
    Group.find({ members: user._id }).select('_id').lean(),
    GlobalRole.find({ $or: [{ isDefault: true }, { _id: { $in: user.globalRoles ?? [] } }] }).lean(),
  ]);
  user.$locals.groupIds = new Set(groups.map((g) => String(g._id)));
  const perms = new Set<string>(user.role === 'Admin' ? GLOBAL_PERMISSIONS.map((p) => p.key) : globalRoles.flatMap((r) => r.permissions));
  user.$locals.globalPerms = perms;
}

export async function attachAccessMany(users: UserDoc[]) {
  if (!users.length) return;
  const ids = users.map((u) => u._id);
  const groups = await Group.find({ members: { $in: ids } }).select('members').lean();
  for (const u of users) {
    u.$locals.groupIds = new Set(groups.filter((g) => g.members.some((m) => String(m) === String(u._id))).map((g) => String(g._id)));
  }
}

export function hasGlobal(user: UserDoc, perm: GlobalPermission): boolean {
  if (user.role === 'Admin') return true;
  return ((user.$locals.globalPerms as Set<string> | undefined) ?? new Set()).has(perm);
}

const idOf = (v: unknown) => String((v as { _id?: unknown } | null)?._id ?? v ?? '');

export interface Access {
  /** 'owner', a built-in key or a custom role id — the "main" role shown in the UI. */
  role: string;
  roleName: string;
  permissions: Set<ProjectPermission>;
}

/**
 * The user's access to a project, or null if they can't see it.
 * Union of: ownership/admin, direct membership, group memberships; templates and
 * the global "view all projects" permission grant read access.
 */
export function accessFor(project: ProjectDoc, user: UserDoc): Access | null {
  const all = new Set<ProjectPermission>(ALL_PROJECT_PERMISSIONS);
  if (user.role === 'Admin' || idOf(project.owner) === String(user._id)) return { role: 'owner', roleName: 'Owner', permissions: all };

  const groupIds = (user.$locals?.groupIds as Set<string> | undefined) ?? new Set<string>();
  const memberships = project.members.filter((m) => (m.user && idOf(m.user) === String(user._id)) || (m.group && groupIds.has(idOf(m.group))));
  if (memberships.length) {
    const permissions = new Set<ProjectPermission>();
    for (const m of memberships) for (const p of roleInfo(m.role)?.permissions ?? []) permissions.add(p as ProjectPermission);
    const primary = memberships.find((m) => m.user) ?? memberships[0];
    return { role: primary.role, roleName: roleName(primary.role), permissions };
  }
  if (project.isTemplate || hasGlobal(user, 'view_all_projects')) {
    return { role: 'viewer', roleName: 'Viewer', permissions: new Set(['view_project', 'view_budgets']) };
  }
  return null;
}

/** Back-compat: the user's main role on the project, or null. */
export function roleFor(project: ProjectDoc, user: UserDoc): string | null {
  return accessFor(project, user)?.role ?? null;
}

export function can(project: ProjectDoc, user: UserDoc, perm: ProjectPermission): boolean {
  return !!accessFor(project, user)?.permissions.has(perm);
}

/** Mongo filter for projects visible to a user. */
export function accessFilter(user: UserDoc) {
  if (user.role === 'Admin' || hasGlobal(user, 'view_all_projects')) return {};
  const groupIds = [...((user.$locals?.groupIds as Set<string> | undefined) ?? [])];
  return {
    $or: [{ owner: user._id }, { 'members.user': user._id }, ...(groupIds.length ? [{ 'members.group': { $in: groupIds } }] : []), { isTemplate: true }],
  };
}

/** Everyone who can be assigned work in a project: owner, direct members and members of member groups. */
export async function projectPeopleIds(project: ProjectDoc): Promise<Set<string>> {
  const ids = new Set<string>([idOf(project.owner)]);
  const groupIds: Types.ObjectId[] = [];
  for (const m of project.members) {
    if (m.user) ids.add(idOf(m.user));
    if (m.group) groupIds.push((m.group as { _id?: Types.ObjectId })._id ?? (m.group as Types.ObjectId));
  }
  if (groupIds.length) {
    const groups = await Group.find({ _id: { $in: groupIds } }).select('members').lean();
    for (const g of groups) for (const u of g.members) ids.add(String(u));
  }
  return ids;
}
