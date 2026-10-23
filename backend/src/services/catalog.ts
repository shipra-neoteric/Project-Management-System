import { DEFAULT_STATUSES, DEFAULT_TYPES, Status, TaskType } from '../models/Catalog';
import { Project } from '../models/Project';
import { Task } from '../models/Task';

let seeded: Promise<void> | null = null;

/** Creates the default types and statuses the first time they are needed. Idempotent. */
export function ensureDefaults(): Promise<void> {
  seeded ??= (async () => {
    if ((await TaskType.estimatedDocumentCount()) === 0) {
      await TaskType.insertMany(DEFAULT_TYPES.map((t, position) => ({ ...t, position })));
    }
    if ((await Status.estimatedDocumentCount()) === 0) {
      await Status.insertMany(DEFAULT_STATUSES.map((s, position) => ({ ...s, position })));
    }
  })().catch((err) => {
    seeded = null;
    throw err;
  });
  return seeded;
}

export async function getCatalog() {
  await ensureDefaults();
  const [types, statuses] = await Promise.all([
    TaskType.find().sort({ position: 1, name: 1 }).lean(),
    Status.find().sort({ position: 1, name: 1 }).lean(),
  ]);
  const defaultType = types.find((t) => t.isDefault) ?? types[0];
  const milestoneType = types.find((t) => t.isMilestone) ?? defaultType;
  const defaultStatus = statuses.find((s) => s.isDefault) ?? statuses[0];
  return { types, statuses, defaultType, milestoneType, defaultStatus };
}
export type Catalog = Awaited<ReturnType<typeof getCatalog>>;

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

/** Upgrades data created before Phase 2 (types, statuses, project keys, task numbers). Safe to run repeatedly. */
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
