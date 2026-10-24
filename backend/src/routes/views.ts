import { Router } from 'express';
import { z } from 'zod';
import { hasPerm, loadProject } from '../middleware/projectAccess';
import { View, VIEW_KINDS } from '../models/View';
import { assertObjectId, forbidden, notFound, parseBody } from '../utils/http';

/** Mounted at /api/projects/:id/views */
export const viewsRouter = Router({ mergeParams: true });

const filterSchema = z.object({
  field: z.string().max(40),
  op: z.string().max(20),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(200)).max(100), z.null()]).optional(),
});

/** Config is interpreted by the frontend query engine; the API only bounds its size and shape. */
const configSchema = z.object({
  filters: z.array(filterSchema).max(30).default([]),
  search: z.string().max(200).default(''),
  sort: z.array(z.object({ field: z.string().max(40), dir: z.enum(['asc', 'desc']) })).max(5).default([]),
  groupBy: z.string().max(40).nullable().default(null),
  columns: z.array(z.string().max(40)).max(40).default([]),
  options: z.record(z.string(), z.union([z.string().max(100), z.number(), z.boolean()])).default({}),
});

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  kind: z.enum(VIEW_KINDS),
  isPublic: z.boolean().default(false),
  config: configSchema,
});

viewsRouter.get('/', loadProject('viewer'), async (req, res) => {
  const views = await View.find({ project: req.project!._id, $or: [{ isPublic: true }, { owner: req.user!._id }] }).sort({ name: 1 });
  res.json({ views });
});

viewsRouter.post('/', loadProject('viewer'), async (req, res) => {
  const body = parseBody(createSchema, req.body);
  if (body.isPublic && !hasPerm(req, 'manage_public_views')) throw forbidden('Only managers can save views for the whole project');
  const view = await View.create({ ...body, project: req.project!._id, owner: req.user!._id });
  res.status(201).json({ view });
});

async function loadOwnView(req: Parameters<Parameters<typeof viewsRouter.patch>[1]>[0]) {
  const view = await View.findOne({ _id: assertObjectId(req.params.viewId, 'View'), project: req.project!._id });
  if (!view || (!view.isPublic && String(view.owner) !== req.user!._id.toString())) throw notFound('View');
  const isOwner = String(view.owner) === req.user!._id.toString();
  if (!isOwner && !hasPerm(req, 'manage_public_views')) throw forbidden('Only the creator or a manager can change this view');
  return view;
}

viewsRouter.patch('/:viewId', loadProject('viewer'), async (req, res) => {
  const body = parseBody(createSchema.partial(), req.body);
  const view = await loadOwnView(req);
  if (body.isPublic && !view.isPublic && !hasPerm(req, 'manage_public_views')) {
    throw forbidden('Only managers can share views with the whole project');
  }
  view.set(body);
  await view.save();
  res.json({ view });
});

viewsRouter.delete('/:viewId', loadProject('viewer'), async (req, res) => {
  const view = await loadOwnView(req);
  await view.deleteOne();
  res.status(204).end();
});
