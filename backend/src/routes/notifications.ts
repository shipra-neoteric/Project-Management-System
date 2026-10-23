import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Notification } from '../models/Notification';
import { parseBody } from '../utils/http';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ recipient: req.user!._id, ...(unreadOnly ? { read: false } : {}) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actor', 'name')
      .lean(),
    Notification.countDocuments({ recipient: req.user!._id, read: false }),
  ]);
  res.json({ notifications, unreadCount });
});

notificationsRouter.get('/count', async (req, res) => {
  res.json({ unreadCount: await Notification.countDocuments({ recipient: req.user!._id, read: false }) });
});

const readSchema = z.object({
  ids: z.array(z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id')).max(500).optional(),
  all: z.boolean().optional(),
  read: z.boolean().default(true),
});

notificationsRouter.post('/read', async (req, res) => {
  const body = parseBody(readSchema, req.body);
  const filter = body.all ? { recipient: req.user!._id } : { recipient: req.user!._id, _id: { $in: body.ids ?? [] } };
  await Notification.updateMany(filter, { $set: { read: body.read } });
  res.json({ unreadCount: await Notification.countDocuments({ recipient: req.user!._id, read: false }) });
});
