import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import { PRIORITIES, Status, TaskType } from '../models/Catalog';
import { Task } from '../models/Task';
import { getCatalog } from '../services/catalog';
import { assertObjectId, badRequest, conflict, notFound, parseBody } from '../utils/http';

/** Task types, statuses and priorities. Everyone can read; only admins can change. */
export const workSettingsRouter = Router();

workSettingsRouter.get('/', async (_req, res) => {
  const { types, statuses } = await getCatalog();
  res.json({ types, statuses, priorities: PRIORITIES });
});

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #3b82f6');
const typeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  color,
  position: z.number().int().min(0).max(1000).optional(),
  isDefault: z.boolean().optional(),
  isMilestone: z.boolean().optional(),
});
const statusSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  color,
  position: z.number().int().min(0).max(1000).optional(),
  isDefault: z.boolean().optional(),
  isClosed: z.boolean().optional(),
});

/** Generic CRUD for TaskType / Status (both are small ordered lists with one default). */
function catalogRoutes(path: 'types' | 'statuses') {
  const Model = (path === 'types' ? TaskType : Status) as typeof TaskType;
  const schema = path === 'types' ? typeSchema : statusSchema;
  const label = path === 'types' ? 'Type' : 'Status';
  const usedField = path === 'types' ? 'type' : 'status';

  const clearOtherDefaults = async (id: unknown) => Model.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
  const assertUniqueName = async (name: string, id?: unknown) => {
    const rx = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (await Model.exists({ name: rx, ...(id ? { _id: { $ne: id } } : {}) })) throw conflict(`${label} "${name}" already exists`);
  };

  workSettingsRouter.post(`/${path}`, requireAdmin, async (req, res) => {
    const body = parseBody(schema, req.body);
    await assertUniqueName(body.name);
    const position = body.position ?? (await Model.countDocuments());
    const doc = await Model.create({ ...body, position });
    if (body.isDefault) await clearOtherDefaults(doc._id);
    res.status(201).json(await getCatalog());
  });

  workSettingsRouter.patch(`/${path}/:itemId`, requireAdmin, async (req, res) => {
    const body = parseBody(schema.partial(), req.body);
    const id = assertObjectId(req.params.itemId, label);
    if (body.name) await assertUniqueName(body.name, id);
    if (body.isDefault === false) throw badRequest('Choose another item as the default instead');
    const doc = await Model.findByIdAndUpdate(id, { $set: body }, { new: true });
    if (!doc) throw notFound(label);
    if (body.isDefault) await clearOtherDefaults(doc._id);
    res.json(await getCatalog());
  });

  workSettingsRouter.delete(`/${path}/:itemId`, requireAdmin, async (req, res) => {
    const id = assertObjectId(req.params.itemId, label);
    const doc = await Model.findById(id);
    if (!doc) throw notFound(label);
    if (doc.isDefault) throw badRequest(`The default ${label.toLowerCase()} cannot be deleted`);
    const used = await Task.countDocuments({ [usedField]: id });
    if (used) throw badRequest(`${used} task${used === 1 ? ' uses' : 's use'} this ${label.toLowerCase()}. Change them first.`);
    await doc.deleteOne();
    res.json(await getCatalog());
  });
}

catalogRoutes('types');
catalogRoutes('statuses');
