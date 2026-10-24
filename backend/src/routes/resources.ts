import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { loadProject } from '../middleware/projectAccess';
import { Resource } from '../models/Resource';
import { Task } from '../models/Task';
import { assertObjectId, notFound, parseBody } from '../utils/http';

/** Mounted at /api/projects/:id/resources */
export const resourcesRouter = Router({ mergeParams: true });

const resourceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  title: z.string().trim().max(120).optional().default(''),
  email: z.union([z.email('Enter a valid email address'), z.literal('')]).optional().default(''),
  user: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid user').nullish(),
});

resourcesRouter.get('/', loadProject('viewer'), async (req, res) => {
  const resources = await Resource.find({ project: req.project!._id }).sort({ name: 1 });
  res.json({ resources });
});

resourcesRouter.post('/', loadProject('manage_resources'), async (req, res) => {
  const body = parseBody(resourceSchema, req.body);
  const resource = await Resource.create({ ...body, user: body.user ?? null, project: req.project!._id });
  res.status(201).json({ resource });
});

resourcesRouter.patch('/:resourceId', loadProject('manage_resources'), async (req, res) => {
  const body = parseBody(resourceSchema.partial(), req.body);
  const resource = await Resource.findOneAndUpdate(
    { _id: assertObjectId(req.params.resourceId, 'Resource'), project: req.project!._id },
    { $set: body },
    { new: true },
  );
  if (!resource) throw notFound('Resource');
  res.json({ resource });
});

resourcesRouter.delete('/:resourceId', loadProject('manage_resources'), async (req, res) => {
  const id = assertObjectId(req.params.resourceId, 'Resource');
  const deleted = await Resource.findOneAndDelete({ _id: id, project: req.project!._id });
  if (!deleted) throw notFound('Resource');
  await Task.updateMany({ project: req.project!._id }, { $pull: { resources: deleted._id } });
  res.status(204).end();
});
