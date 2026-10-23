import { Router } from 'express';
import { z } from 'zod';
import { View } from '../models/View';
import { assertObjectId, forbidden, notFound, parseBody } from '../utils/http';

/** Saved project-list views (filters/columns for the Projects page). Private, or shared by admins. */
export const projectViewsRouter = Router();

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  isPublic: z.boolean().default(false),
  config: z.object({
    filters: z.array(z.object({ field: z.string().max(60), op: z.string().max(20), value: z.unknown().optional() })).max(30).default([]),
    search: z.string().max(200).default(''),
    sort: z.array(z.object({ field: z.string().max(60), dir: z.enum(['asc', 'desc']) })).max(5).default([]),
    groupBy: z.string().max(60).nullable().default(null),
    columns: z.array(z.string().max(60)).max(40).default([]),
    options: z.record(z.string(), z.union([z.string().max(100), z.number(), z.boolean()])).default({}),
  }),
});

projectViewsRouter.get('/', async (req, res) => {
  const views = await View.find({ kind: 'projects', project: null, $or: [{ isPublic: true }, { owner: req.user!._id }] }).sort({ name: 1 });
  res.json({ views });
});

projectViewsRouter.post('/', async (req, res) => {
  const body = parseBody(schema, req.body);
  if (body.isPublic && req.user!.role !== 'Admin') throw forbidden('Only administrators can share project lists with everyone');
  const view = await View.create({ ...body, kind: 'projects', project: null, owner: req.user!._id });
  res.status(201).json({ view });
});

async function loadOwn(id: unknown, user: Express.Request['user']) {
  const view = await View.findOne({ _id: assertObjectId(id, 'View'), kind: 'projects', project: null });
  if (!view || (!view.isPublic && String(view.owner) !== String(user!._id))) throw notFound('View');
  if (String(view.owner) !== String(user!._id) && user!.role !== 'Admin') throw forbidden('Only the creator or an administrator can change this view');
  return view;
}

projectViewsRouter.patch('/:viewId', async (req, res) => {
  const body = parseBody(schema.partial(), req.body);
  const view = await loadOwn(req.params.viewId, req.user);
  if (body.isPublic && req.user!.role !== 'Admin') throw forbidden('Only administrators can share project lists with everyone');
  view.set(body);
  await view.save();
  res.json({ view });
});

projectViewsRouter.delete('/:viewId', async (req, res) => {
  const view = await loadOwn(req.params.viewId, req.user);
  await view.deleteOne();
  res.status(204).end();
});
