import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAdmin, requireGlobal } from '../middleware/auth';
import { ALL_PROJECT_PERMISSIONS, GLOBAL_PERMISSIONS, GlobalRole, Group, PROJECT_PERMISSIONS, Role } from '../models/Access';
import { Project } from '../models/Project';
import { Setting } from '../models/Setting';
import { User } from '../models/User';
import { ensureAccessDefaults, invalidateRoles, loadRoles } from '../services/permissions';
import { assertObjectId, badRequest, conflict, notFound, parseBody } from '../utils/http';

/** Project roles, global roles and groups. */
export const accessRouter = Router();

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const name = z.string().trim().min(1, 'Name is required').max(40);

// ---- Project roles --------------------------------------------------------------------------

accessRouter.get('/roles', async (_req, res) => {
  await ensureAccessDefaults();
  const roles = await Role.find().sort({ position: 1, name: 1 }).lean();
  res.json({ roles, permissions: PROJECT_PERMISSIONS });
});

const roleSchema = z.object({ name, permissions: z.array(z.enum(ALL_PROJECT_PERMISSIONS as [string, ...string[]])).max(50) });

accessRouter.post('/roles', requireAdmin, async (req, res) => {
  const body = parseBody(roleSchema, req.body);
  if (await Role.exists({ name: new RegExp(`^${body.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw conflict('A role with this name exists');
  // Everyone in a project can at least see it.
  const role = await Role.create({ ...body, permissions: [...new Set(['view_project', ...body.permissions])], key: null, position: await Role.countDocuments() });
  invalidateRoles();
  res.status(201).json({ role });
});

accessRouter.patch('/roles/:roleId', requireAdmin, async (req, res) => {
  const body = parseBody(roleSchema.partial(), req.body);
  const role = await Role.findById(assertObjectId(req.params.roleId, 'Role'));
  if (!role) throw notFound('Role');
  if (body.name) role.name = body.name;
  if (body.permissions) role.permissions = [...new Set(['view_project', ...body.permissions])];
  await role.save();
  invalidateRoles();
  res.json({ role });
});

accessRouter.delete('/roles/:roleId', requireAdmin, async (req, res) => {
  const role = await Role.findById(assertObjectId(req.params.roleId, 'Role'));
  if (!role) throw notFound('Role');
  if (role.key) throw badRequest('Built-in roles cannot be deleted — edit their permissions instead');
  const used = await Project.countDocuments({ 'members.role': String(role._id) });
  if (used) throw badRequest(`${used} project${used === 1 ? ' uses' : 's use'} this role. Change those members first.`);
  await role.deleteOne();
  // Drop workflow rules for the deleted role.
  await Setting.updateOne({ key: 'org' }, { $unset: { [`workflow.${role._id}`]: '' } });
  invalidateRoles();
  await loadRoles(true);
  res.status(204).end();
});

// ---- Global roles ---------------------------------------------------------------------------

const globalKeys = GLOBAL_PERMISSIONS.map((p) => p.key) as [string, ...string[]];
const globalRoleSchema = z.object({ name, permissions: z.array(z.enum(globalKeys)).max(20), isDefault: z.boolean().default(false) });

accessRouter.get('/global-roles', async (_req, res) => {
  await ensureAccessDefaults();
  res.json({ roles: await GlobalRole.find().sort({ name: 1 }).lean(), permissions: GLOBAL_PERMISSIONS });
});

accessRouter.post('/global-roles', requireAdmin, async (req, res) => {
  const body = parseBody(globalRoleSchema, req.body);
  res.status(201).json({ role: await GlobalRole.create(body) });
});

accessRouter.patch('/global-roles/:roleId', requireAdmin, async (req, res) => {
  const body = parseBody(globalRoleSchema.partial(), req.body);
  const role = await GlobalRole.findByIdAndUpdate(assertObjectId(req.params.roleId, 'Role'), { $set: body }, { new: true });
  if (!role) throw notFound('Role');
  res.json({ role });
});

accessRouter.delete('/global-roles/:roleId', requireAdmin, async (req, res) => {
  const id = assertObjectId(req.params.roleId, 'Role');
  const role = await GlobalRole.findByIdAndDelete(id);
  if (!role) throw notFound('Role');
  await User.updateMany({ globalRoles: id }, { $pull: { globalRoles: id } });
  res.status(204).end();
});

// ---- Groups ---------------------------------------------------------------------------------

const groupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  description: z.string().max(300).optional().default(''),
  members: z.array(objectId).max(500).optional().default([]),
});

accessRouter.get('/groups', async (_req, res) => {
  const groups = await Group.find().sort({ name: 1 }).populate('members', 'name email kind').lean();
  res.json({ groups });
});

accessRouter.post('/groups', requireGlobal('manage_users'), async (req, res) => {
  const body = parseBody(groupSchema, req.body);
  if (await Group.exists({ name: body.name })) throw conflict('A group with this name exists');
  const group = await Group.create({ ...body, members: [...new Set(body.members)] });
  res.status(201).json({ group });
});

accessRouter.patch('/groups/:groupId', requireGlobal('manage_users'), async (req, res) => {
  const body = parseBody(groupSchema.partial(), req.body);
  const group = await Group.findByIdAndUpdate(
    assertObjectId(req.params.groupId, 'Group'),
    { $set: { ...body, ...(body.members ? { members: [...new Set(body.members)] } : {}) } },
    { new: true },
  );
  if (!group) throw notFound('Group');
  res.json({ group });
});

accessRouter.delete('/groups/:groupId', requireGlobal('manage_users'), async (req, res) => {
  const id = assertObjectId(req.params.groupId, 'Group');
  const group = await Group.findByIdAndDelete(id);
  if (!group) throw notFound('Group');
  await Project.updateMany({ 'members.group': id }, { $pull: { members: { group: id } } });
  res.status(204).end();
});
