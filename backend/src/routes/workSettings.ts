import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import { PRIORITIES, Status, TaskType } from '../models/Catalog';
import { CUSTOM_FIELD_KINDS, CUSTOM_FIELD_SCOPES, CustomField, PhaseDefinition } from '../models/CustomField';
import { Project } from '../models/Project';
import { Setting } from '../models/Setting';
import { Task } from '../models/Task';
import { getCatalog } from '../services/catalog';
import { assertObjectId, badRequest, conflict, notFound, parseBody } from '../utils/http';

/** Task types, statuses, workflow, life-cycle phases and custom fields. Everyone reads; admins change. */
export const workSettingsRouter = Router();

async function payload() {
  const { types, statuses, phases, customFields, workflow } = await getCatalog();
  return { types, statuses, phases, customFields, workflow, priorities: PRIORITIES };
}

workSettingsRouter.get('/', async (_req, res) => {
  res.json(await payload());
});

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #3b82f6');
const name = z.string().trim().min(1, 'Name is required').max(60);
const schemas = {
  types: z.object({
    name,
    color,
    position: z.number().int().min(0).max(1000).optional(),
    isDefault: z.boolean().optional(),
    isMilestone: z.boolean().optional(),
    hiddenFields: z.array(z.string().max(40)).max(100).optional(),
  }),
  statuses: z.object({
    name,
    color,
    position: z.number().int().min(0).max(1000).optional(),
    isDefault: z.boolean().optional(),
    isClosed: z.boolean().optional(),
  }),
  phases: z.object({
    name,
    color,
    gate: z.string().trim().max(60).optional(),
    position: z.number().int().min(0).max(1000).optional(),
  }),
  'custom-fields': z.object({
    name,
    scope: z.enum(CUSTOM_FIELD_SCOPES),
    kind: z.enum(CUSTOM_FIELD_KINDS),
    options: z.array(z.object({ _id: z.string().optional(), name: z.string().trim().min(1).max(60) })).max(100).optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
    description: z.string().max(300).optional(),
  }),
};
type Path = keyof typeof schemas;

const models = { types: TaskType, statuses: Status, phases: PhaseDefinition, 'custom-fields': CustomField } as const;
const labels: Record<Path, string> = { types: 'Type', statuses: 'Status', phases: 'Phase', 'custom-fields': 'Custom field' };

/** Usage check before deleting: returns how many records still reference the item. */
async function usage(path: Path, id: string): Promise<number> {
  if (path === 'types') return Task.countDocuments({ type: id });
  if (path === 'statuses') return Task.countDocuments({ status: id });
  if (path === 'phases') return Project.countDocuments({ 'lifecycle.definition': id });
  return 0;
}

for (const path of Object.keys(schemas) as Path[]) {
  const Model = models[path] as unknown as typeof TaskType;
  const schema = schemas[path];
  const label = labels[path];

  const assertUniqueName = async (value: string, id?: unknown) => {
    const rx = new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (await Model.exists({ name: rx, ...(id ? { _id: { $ne: id } } : {}) })) throw conflict(`${label} "${value}" already exists`);
  };
  const clearOtherDefaults = (id: unknown) => Model.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
  const normalizeOptions = (body: { options?: { _id?: string; name: string }[] }) => {
    if (body.options) body.options = body.options.map((o) => (o._id && Types.ObjectId.isValid(o._id) ? o : { name: o.name }));
  };

  workSettingsRouter.post(`/${path}`, requireAdmin, async (req, res) => {
    const body = parseBody(schema, req.body) as Record<string, unknown> & { name: string; isDefault?: boolean; kind?: string; options?: { name: string }[] };
    await assertUniqueName(body.name);
    if ((body.kind === 'select' || body.kind === 'multiselect') && !body.options?.length) throw badRequest('Add at least one option');
    normalizeOptions(body);
    const doc = await Model.create({ ...body, position: (body.position as number | undefined) ?? (await Model.countDocuments()) });
    if (body.isDefault) await clearOtherDefaults(doc._id);
    res.status(201).json(await payload());
  });

  workSettingsRouter.patch(`/${path}/:itemId`, requireAdmin, async (req, res) => {
    const body = parseBody(schema.partial(), req.body) as Record<string, unknown> & { name?: string; isDefault?: boolean; kind?: string; scope?: string; options?: { _id?: string; name: string }[] };
    const id = assertObjectId(req.params.itemId, label);
    const existing = await Model.findById(id).lean<Record<string, unknown>>();
    if (!existing) throw notFound(label);
    if (body.name) await assertUniqueName(body.name, id);
    if (body.isDefault === false) throw badRequest('Choose another item as the default instead');
    if (path === 'custom-fields' && ((body.kind && body.kind !== existing.kind) || (body.scope && body.scope !== existing.scope))) {
      throw badRequest('The kind and scope of a custom field cannot change. Create a new field instead.');
    }
    normalizeOptions(body);
    const doc = await Model.findByIdAndUpdate(id, { $set: body }, { new: true });
    if (body.isDefault && doc) await clearOtherDefaults(doc._id);
    res.json(await payload());
  });

  workSettingsRouter.delete(`/${path}/:itemId`, requireAdmin, async (req, res) => {
    const id = assertObjectId(req.params.itemId, label);
    const doc = await Model.findById(id).lean<Record<string, unknown>>();
    if (!doc) throw notFound(label);
    if (doc.isDefault) throw badRequest(`The default ${label.toLowerCase()} cannot be deleted`);
    const used = await usage(path, id);
    if (used) throw badRequest(`${used} record${used === 1 ? ' uses' : 's use'} this ${label.toLowerCase()}. Change them first.`);
    await Model.deleteOne({ _id: id });
    if (path === 'custom-fields') {
      // Remove stored values and hide-rules for the deleted field.
      const target = doc.scope === 'project' ? Project : Task;
      await (target as typeof Task).updateMany({}, { $unset: { [`customValues.${id}`]: '' } });
      await TaskType.updateMany({}, { $pull: { hiddenFields: id } });
    }
    res.json(await payload());
  });
}

const roleRules = z.record(z.string(), z.array(z.string()).max(100)).nullable().optional();
const workflowSchema = z.object({ manager: roleRules, member: roleRules });

/** PUT /work-settings/workflow — `{ manager: {from: [to…]} | null, member: … }`; null removes restrictions for that role. */
workSettingsRouter.put('/workflow', requireAdmin, async (req, res) => {
  const body = parseBody(workflowSchema, req.body);
  const { statuses } = await getCatalog();
  const ids = new Set(statuses.map((s) => String(s._id)));
  const workflow: Record<string, Record<string, string[]>> = {};
  for (const [role, rules] of Object.entries(body)) {
    if (!rules) continue;
    workflow[role] = {};
    for (const [from, tos] of Object.entries(rules)) {
      if (!ids.has(from) || tos.some((t) => !ids.has(t))) throw badRequest('Workflow refers to an unknown status');
      workflow[role][from] = [...new Set(tos)];
    }
  }
  await Setting.findOneAndUpdate({ key: 'org' }, { $set: { workflow } }, { upsert: true });
  res.json(await payload());
});
