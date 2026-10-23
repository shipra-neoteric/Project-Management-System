import { DEFAULT_STATUSES, DEFAULT_TYPES, Status, TaskType } from '../models/Catalog';
import { CustomField, DEFAULT_PHASES, PhaseDefinition, type CustomFieldKind } from '../models/CustomField';
import { Project, type ProjectRole } from '../models/Project';
import { Setting } from '../models/Setting';
import { Task } from '../models/Task';
import { isISODate } from '../scheduling/calendar';
import { badRequest } from '../utils/http';

let seeded: Promise<void> | null = null;

/** Creates default types, statuses and life-cycle phases the first time they are needed. Idempotent. */
export function ensureDefaults(): Promise<void> {
  seeded ??= (async () => {
    if ((await TaskType.estimatedDocumentCount()) === 0) {
      await TaskType.insertMany(DEFAULT_TYPES.map((t, position) => ({ ...t, position })));
    }
    if ((await Status.estimatedDocumentCount()) === 0) {
      await Status.insertMany(DEFAULT_STATUSES.map((s, position) => ({ ...s, position })));
    }
    if ((await PhaseDefinition.estimatedDocumentCount()) === 0) {
      await PhaseDefinition.insertMany(DEFAULT_PHASES.map((p, position) => ({ ...p, position })));
    }
  })().catch((err) => {
    seeded = null;
    throw err;
  });
  return seeded;
}

/** role → fromStatusId → allowed target status ids. A role without rules is unrestricted. */
export type Workflow = Partial<Record<'manager' | 'member', Record<string, string[]>>>;

export async function getCatalog() {
  await ensureDefaults();
  const [types, statuses, phases, customFields, setting] = await Promise.all([
    TaskType.find().sort({ position: 1, name: 1 }).lean(),
    Status.find().sort({ position: 1, name: 1 }).lean(),
    PhaseDefinition.find().sort({ position: 1, name: 1 }).lean(),
    CustomField.find().sort({ position: 1, name: 1 }).lean(),
    Setting.findOne({ key: 'org' }).select('workflow').lean(),
  ]);
  const defaultType = types.find((t) => t.isDefault) ?? types[0];
  const milestoneType = types.find((t) => t.isMilestone) ?? defaultType;
  const defaultStatus = statuses.find((s) => s.isDefault) ?? statuses[0];
  return {
    types,
    statuses,
    phases,
    customFields,
    workflow: (setting?.workflow ?? {}) as Workflow,
    defaultType,
    milestoneType,
    defaultStatus,
  };
}
export type Catalog = Awaited<ReturnType<typeof getCatalog>>;

export function isTransitionAllowed(workflow: Workflow, role: ProjectRole, from: string | null, to: string): boolean {
  if (role === 'owner' || !from || from === to) return true;
  if (role === 'viewer') return false;
  const rules = workflow[role];
  if (!rules) return true;
  return (rules[from] ?? []).includes(to);
}

/**
 * Validates custom field values for a task or project and returns the cleaned object to store.
 * `existing` values for fields not mentioned are kept. Unknown field ids are rejected.
 */
export function cleanCustomValues(
  catalog: Catalog,
  scope: 'task' | 'project',
  input: Record<string, unknown>,
  existing: Record<string, unknown> = {},
  isPerson: (userId: string) => boolean = () => true,
): Record<string, unknown> {
  const fields = new Map(catalog.customFields.filter((f) => f.scope === scope).map((f) => [String(f._id), f]));
  const out: Record<string, unknown> = { ...existing };
  for (const [id, raw] of Object.entries(input)) {
    const field = fields.get(id);
    if (!field) throw badRequest('Unknown custom field');
    if (raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
      delete out[id];
      continue;
    }
    out[id] = castValue(field.name, field.kind as CustomFieldKind, raw, field.options.map((o) => String(o._id)), isPerson);
  }
  return out;
}

function castValue(name: string, kind: CustomFieldKind, raw: unknown, optionIds: string[], isPerson: (id: string) => boolean): unknown {
  const fail = (msg: string) => {
    throw badRequest(`${name}: ${msg}`);
  };
  switch (kind) {
    case 'text':
    case 'longtext': {
      const s = String(raw).trim();
      if (s.length > (kind === 'text' ? 255 : 5000)) fail('too long');
      return s;
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) fail('must be a number');
      return n;
    }
    case 'date':
      if (typeof raw !== 'string' || !isISODate(raw)) fail('must be a date');
      return raw;
    case 'boolean':
      return raw === true || raw === 'true';
    case 'select':
      if (!optionIds.includes(String(raw))) fail('unknown option');
      return String(raw);
    case 'multiselect': {
      const list = (Array.isArray(raw) ? raw : [raw]).map(String);
      if (list.some((v) => !optionIds.includes(v))) fail('unknown option');
      return [...new Set(list)];
    }
    case 'user':
      if (!isPerson(String(raw))) fail('must be a member of the project');
      return String(raw);
  }
}

/** Lists required custom fields that have no value. */
export function missingRequired(catalog: Catalog, scope: 'task' | 'project', values: Record<string, unknown>, hidden: string[] = []): string[] {
  return catalog.customFields
    .filter((f) => f.scope === scope && f.required && !hidden.includes(String(f._id)))
    .filter((f) => {
      const v = values[String(f._id)];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    })
    .map((f) => f.name);
}

/** "Office Fit-out 2026" → "OF"; ensures the key is unique by adding a number. */
export async function generateProjectKey(name: string, excludeId?: unknown): Promise<string> {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] ?? 'PRJ').slice(0, 4);
  if (!/^[A-Z]/.test(base)) base = `P${base}`;
  if (base.length < 2) base = `${base}X`;
  for (let i = 0; i < 1000; i++) {
    const key = i === 0 ? base : `${base}${i + 1}`;
    if (!(await Project.exists({ key, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }))) return key;
  }
  throw new Error('Could not generate a project key');
}

/** Upgrades data created by earlier versions (types, statuses, project keys, task numbers). Safe to run repeatedly. */
export async function backfill(): Promise<void> {
  const { defaultType, milestoneType, defaultStatus } = await getCatalog();
  await Task.updateMany({ type: null, isMilestone: true }, { $set: { type: milestoneType._id } });
  await Task.updateMany({ type: null }, { $set: { type: defaultType._id } });
  await Task.updateMany({ status: null }, { $set: { status: defaultStatus._id } });

  for (const project of await Project.find({ $or: [{ key: null }, { key: { $exists: false } }] })) {
    project.key = await generateProjectKey(project.name, project._id);
    await project.save();
  }
  for (const project of await Project.find()) {
    const unnumbered = await Task.find({ project: project._id, $or: [{ number: null }, { number: { $exists: false } }] })
      .sort({ rowNumber: 1 })
      .select('_id');
    if (!unnumbered.length) continue;
    let seq = project.taskSeq ?? 0;
    await Task.bulkWrite(unnumbered.map((t) => ({ updateOne: { filter: { _id: t._id }, update: { $set: { number: ++seq } } } })));
    project.taskSeq = seq;
    await project.save();
  }
}
