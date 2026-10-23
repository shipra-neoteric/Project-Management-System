import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth';
import { DEFAULT_SETTINGS, Setting } from '../models/Setting';
import { parseBody } from '../utils/http';

export const settingsRouter = Router();

async function readSettings() {
  const doc = await Setting.findOne({ key: 'org' }).lean();
  return { orgName: doc?.orgName ?? DEFAULT_SETTINGS.orgName, themeColor: doc?.themeColor ?? DEFAULT_SETTINGS.themeColor };
}

settingsRouter.get('/', async (_req, res) => {
  res.json(await readSettings());
});

const updateSchema = z.object({
  orgName: z.string().trim().min(1).max(80).optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Theme color must be a hex value like #f97316').optional(),
});

settingsRouter.put('/', requireAdmin, async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  await Setting.findOneAndUpdate({ key: 'org' }, { $set: body }, { upsert: true });
  res.json(await readSettings());
});
