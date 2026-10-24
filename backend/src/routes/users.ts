import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env';
import { Group, TimeOff } from '../models/Access';
import { HourlyRate } from '../models/Finance';
import { Project } from '../models/Project';
import { Resource } from '../models/Resource';
import { Task } from '../models/Task';
import { APP_ROLES, publicUser, User } from '../models/User';
import { renderEmail, sendMail } from '../services/mailer';
import { can, hasGlobal, roleInfo } from '../services/permissions';
import { assertObjectId, badRequest, conflict, forbidden, notFound, parseBody } from '../utils/http';

export const usersRouter = Router();

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

usersRouter.get('/', async (_req, res) => {
  const users = await User.find().sort({ kind: 1, name: 1 });
  res.json({ users: users.map(publicUser) });
});

const updateSchema = z.object({
  role: z.enum(APP_ROLES).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(80).optional(),
  globalRoles: z.array(objectId).max(20).optional(),
  workSchedule: z.object({ hoursPerDay: z.number().min(0).max(24), workingDays: z.array(z.number().int().min(0).max(6)).max(7) }).optional(),
});

usersRouter.patch('/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'User');
  const body = parseBody(updateSchema, req.body);
  if (!hasGlobal(req.user!, 'manage_users')) throw forbidden('You don’t have permission to manage users');
  if (body.role !== undefined && req.user!.role !== 'Admin') throw forbidden('Only administrators can grant or remove admin access');
  if (id === req.user!._id.toString() && (body.role === 'User' || body.isActive === false)) {
    throw badRequest('You cannot remove your own admin access or deactivate yourself');
  }
  const user = await User.findByIdAndUpdate(id, { $set: body }, { new: true });
  if (!user) throw notFound('User');
  res.json({ user: publicUser(user) });
});

// ---- Placeholders ---------------------------------------------------------------------------

usersRouter.post('/placeholders', async (req, res) => {
  if (!hasGlobal(req.user!, 'manage_users')) throw forbidden('You don’t have permission to manage users');
  const { name } = parseBody(z.object({ name: z.string().trim().min(2, 'Name is required').max(80) }), req.body);
  const user = await User.create({ name, kind: 'placeholder', emailVerified: true, notifyByEmail: false });
  res.status(201).json({ user: publicUser(user) });
});

/** Hands everything a placeholder had (memberships, assignments, resources, groups) to a real user, then removes it. */
usersRouter.post('/:id/replace', async (req, res) => {
  if (!hasGlobal(req.user!, 'manage_users')) throw forbidden('You don’t have permission to manage users');
  const placeholder = await User.findById(assertObjectId(req.params.id, 'User'));
  if (!placeholder || placeholder.kind !== 'placeholder') throw notFound('Placeholder');
  const { userId } = parseBody(z.object({ userId: objectId }), req.body);
  const user = await User.findById(userId);
  if (!user || user.kind === 'placeholder') throw badRequest('Choose a real user');
  const from = placeholder._id;
  const to = user._id;

  for (const project of await Project.find({ 'members.user': from })) {
    const hasUser = project.members.some((m) => m.user && m.user.equals(to)) || project.owner.equals(to);
    project.set(
      'members',
      hasUser ? project.members.filter((m) => !(m.user && m.user.equals(from))) : project.members.map((m) => (m.user && m.user.equals(from) ? { user: to, group: null, role: m.role } : m)),
    );
    await project.save();
  }
  await Promise.all([
    Task.updateMany({ assignee: from }, { $set: { assignee: to } }),
    Task.updateMany({ accountable: from }, { $set: { accountable: to } }),
    Resource.updateMany({ user: from }, { $set: { user: to } }),
    Group.updateMany({ members: from }, { $addToSet: { members: to } }).then(() => Group.updateMany({}, { $pull: { members: from } })),
  ]);
  await placeholder.deleteOne();
  res.json({ user: publicUser(user) });
});

usersRouter.delete('/:id', async (req, res) => {
  if (!hasGlobal(req.user!, 'manage_users')) throw forbidden('You don’t have permission to manage users');
  const user = await User.findById(assertObjectId(req.params.id, 'User'));
  if (!user) throw notFound('User');
  if (user.kind !== 'placeholder' && !user.invited) {
    // Real accounts: administrators only, never admins or yourself, and only once they own no projects.
    if (req.user!.role !== 'Admin') throw badRequest('Only placeholders and pending invitations can be deleted. Deactivate real users instead.');
    if (user.role === 'Admin' || user._id.equals(req.user!._id)) throw badRequest('Administrators cannot be deleted. Remove admin access first.');
    if (await Project.exists({ owner: user._id })) throw badRequest('This person still owns projects. Transfer or delete them first.');
  }
  await Promise.all([
    Project.updateMany({ 'members.user': user._id }, { $pull: { members: { user: user._id } } }),
    Task.updateMany({ assignee: user._id }, { $set: { assignee: null } }),
    Task.updateMany({ accountable: user._id }, { $set: { accountable: null } }),
    Task.updateMany({ watchers: user._id }, { $pull: { watchers: user._id } }),
    Group.updateMany({ members: user._id }, { $pull: { members: user._id } }),
    HourlyRate.deleteMany({ user: user._id }),
    TimeOff.deleteMany({ user: user._id }),
  ]);
  await user.deleteOne();
  res.status(204).end();
});

// ---- Invitations ----------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  name: z.string().trim().max(80).optional(),
  projectId: objectId.optional(),
  role: z.string().max(40).optional(),
});

async function sendInvite(user: InstanceType<typeof User>, inviter: string, projectName?: string) {
  const token = randomBytes(32).toString('hex');
  user.inviteTokenHash = hashToken(token);
  await user.save();
  const { text, html } = renderEmail(
    `${inviter} invited you to the Project Management System`,
    [projectName ? `You've been added to the project "${projectName}".` : 'You now have an account.', 'Choose your password to get started.'],
    { label: 'Accept invitation', url: `${env.appUrl}/accept-invite?token=${token}` },
  );
  if (user.email) void sendMail({ to: user.email, subject: 'You are invited to the Project Management System', text, html });
}

/** Invite someone by email — optionally straight into a project (needs "manage members" there). */
usersRouter.post('/invite', async (req, res) => {
  const body = parseBody(inviteSchema, req.body);
  let project = null;
  if (body.projectId) {
    project = await Project.findById(body.projectId);
    if (!project || !can(project, req.user!, 'manage_members')) throw forbidden('You can’t add members to that project');
    if (!body.role || body.role === 'owner' || !roleInfo(body.role)) throw badRequest('Choose a role for the project');
  } else if (!hasGlobal(req.user!, 'manage_users')) {
    throw forbidden('You don’t have permission to invite users');
  }

  let user = await User.findOne({ email: body.email });
  if (user && !project) throw conflict('Someone with this email already has an account');
  if (!user) {
    user = await User.create({ name: body.name || body.email.split('@')[0], email: body.email, invited: true });
    await sendInvite(user, req.user!.name, project?.name);
  }
  if (project) {
    const id = user._id;
    if (!project.owner.equals(id) && !project.members.some((m) => m.user && m.user.equals(id))) {
      project.members.push({ user: id, group: null, role: body.role! });
      await project.save();
    }
  }
  res.status(201).json({ user: publicUser(user) });
});

usersRouter.post('/:id/resend-invite', async (req, res) => {
  if (!hasGlobal(req.user!, 'manage_users')) throw forbidden('You don’t have permission to manage users');
  const user = await User.findById(assertObjectId(req.params.id, 'User'));
  if (!user || !user.invited) throw notFound('Invitation');
  await sendInvite(user, req.user!.name);
  res.json({ ok: true });
});
