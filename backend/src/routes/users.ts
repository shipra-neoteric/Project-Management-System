import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import { APP_ROLES, publicUser, User } from '../models/User';
import { assertObjectId, badRequest, notFound, parseBody } from '../utils/http';

export const usersRouter = Router();

usersRouter.get('/', async (_req, res) => {
  const users = await User.find().sort({ name: 1 });
  res.json({ users: users.map(publicUser) });
});

const updateSchema = z.object({
  role: z.enum(APP_ROLES).optional(),
  isActive: z.boolean().optional(),
});

usersRouter.patch('/:id', requireAdmin, async (req, res) => {
  const id = assertObjectId(req.params.id, 'User');
  const body = parseBody(updateSchema, req.body);
  if (id === req.user!._id.toString() && (body.role === 'User' || body.isActive === false)) {
    throw badRequest('You cannot remove your own admin access or deactivate yourself');
  }
  const user = await User.findByIdAndUpdate(id, body, { new: true });
  if (!user) throw notFound('User');
  res.json({ user: publicUser(user) });
});
