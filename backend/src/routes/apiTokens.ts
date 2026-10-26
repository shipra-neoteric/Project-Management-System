import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../middleware/auth';
import { ApiToken } from '../models/Security';
import { assertObjectId, forbidden, notFound, parseBody } from '../utils/http';

/** Personal access tokens for the public API. Mounted at /api/tokens (signed-in sessions only). */
export const apiTokensRouter = Router();

const MAX_TOKENS_PER_USER = 20;

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name the token').max(80),
  scope: z.enum(['read', 'write']).default('read'),
  /** Days until it expires; omit or null for no expiry. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

/** GET /api/tokens — your tokens; `?all=1` lists everyone's (administrators). */
apiTokensRouter.get('/', requireSession, async (req, res) => {
  const all = req.query.all === '1';
  if (all && req.user!.role !== 'Admin') throw forbidden('Only administrators can see everyone’s tokens');
  const tokens = await ApiToken.find(all ? {} : { user: req.user!._id })
    .sort({ createdAt: -1 })
    .populate('user', 'name email')
    .lean();
  res.json({ tokens });
});

/** POST /api/tokens — the token itself is returned once and never again. */
apiTokensRouter.post('/', requireSession, async (req, res) => {
  const body = parseBody(createSchema, req.body);
  if ((await ApiToken.countDocuments({ user: req.user!._id })) >= MAX_TOKENS_PER_USER) throw forbidden(`You can have at most ${MAX_TOKENS_PER_USER} tokens. Revoke one first.`);
  const token = `pms_${randomBytes(32).toString('base64url')}`;
  const doc = await ApiToken.create({
    user: req.user!._id,
    name: body.name,
    scope: body.scope,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    prefix: token.slice(0, 12),
    expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
  });
  const { tokenHash: _omit, ...safe } = doc.toObject();
  res.status(201).json({ token, apiToken: safe });
});

apiTokensRouter.delete('/:tokenId', requireSession, async (req, res) => {
  const doc = await ApiToken.findById(assertObjectId(req.params.tokenId, 'Token'));
  if (!doc) throw notFound('Token');
  if (String(doc.user) !== String(req.user!._id) && req.user!.role !== 'Admin') throw notFound('Token');
  await doc.deleteOne();
  res.status(204).end();
});
