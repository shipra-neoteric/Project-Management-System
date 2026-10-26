import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAdmin, requireSession } from '../middleware/auth';
import { Project } from '../models/Project';
import { Webhook, WebhookDelivery } from '../models/Security';
import { assertSafeUrl, deliver, startWebhooks } from '../services/webhooks';
import { assertObjectId, badRequest, notFound, parseBody, patchSchema } from '../utils/http';

/** Outgoing webhooks (administrators). Mounted at /api/webhooks. */
export const webhooksRouter = Router();
webhooksRouter.use(requireSession, requireAdmin);
startWebhooks();

/** Event groups offered in the UI; "*" means everything. */
export const WEBHOOK_EVENTS = ['*', 'project.*', 'task.*', 'comment.*', 'attachment.*', 'time-entry.*', 'cost-entry.*', 'budget.*', 'member.*', 'meeting.*', 'baseline.*'];

const schema = z.object({
  name: z.string().trim().min(1, 'Name the webhook').max(80),
  url: z.string().trim().min(1, 'Enter the URL').max(2000),
  events: z.array(z.string().regex(/^(\*|[a-z][a-z-]*(\.(\*|created|updated|deleted))?)$/, 'Unknown event pattern')).min(1).max(30).default(['*']),
  project: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid project').nullish(),
  active: z.boolean().default(true),
});

async function validate(body: Partial<z.infer<typeof schema>>) {
  if (body.url) {
    try {
      await assertSafeUrl(body.url);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid URL');
    }
  }
  if (body.project && !(await Project.exists({ _id: body.project }))) throw badRequest('Unknown project');
}

webhooksRouter.get('/', async (_req, res) => {
  const hooks = await Webhook.find().sort({ createdAt: -1 }).populate('project', 'name key').lean();
  res.json({ webhooks: hooks, events: WEBHOOK_EVENTS });
});

/** The signing secret is returned once, on creation (and when rotated). */
webhooksRouter.post('/', async (req, res) => {
  const body = parseBody(schema, req.body);
  await validate(body);
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const hook = await Webhook.create({ ...body, project: body.project ?? null, secret, createdBy: req.user!._id });
  res.status(201).json({ webhook: { ...hook.toObject(), secret: undefined }, secret });
});

webhooksRouter.patch('/:hookId', async (req, res) => {
  const body = parseBody(patchSchema(schema), req.body);
  await validate(body);
  const hook = await Webhook.findById(assertObjectId(req.params.hookId, 'Webhook'));
  if (!hook) throw notFound('Webhook');
  hook.set({ ...body, ...(body.project !== undefined ? { project: body.project ?? null } : {}) });
  // Turning a webhook back on resets the failure counter.
  if (body.active) {
    hook.consecutiveFailures = 0;
    hook.disabledReason = '';
  }
  await hook.save();
  res.json({ webhook: hook.toObject() });
});

webhooksRouter.post('/:hookId/rotate-secret', async (req, res) => {
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const hook = await Webhook.findByIdAndUpdate(assertObjectId(req.params.hookId, 'Webhook'), { $set: { secret } });
  if (!hook) throw notFound('Webhook');
  res.json({ secret });
});

webhooksRouter.delete('/:hookId', async (req, res) => {
  const id = assertObjectId(req.params.hookId, 'Webhook');
  const hook = await Webhook.findByIdAndDelete(id);
  if (!hook) throw notFound('Webhook');
  await WebhookDelivery.deleteMany({ webhook: id });
  res.status(204).end();
});

webhooksRouter.get('/:hookId/deliveries', async (req, res) => {
  const deliveries = await WebhookDelivery.find({ webhook: assertObjectId(req.params.hookId, 'Webhook') })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ deliveries });
});

/** Sends a "ping" event right away and returns the delivery result. */
webhooksRouter.post('/:hookId/test', async (req, res) => {
  const hook = await Webhook.findById(assertObjectId(req.params.hookId, 'Webhook'));
  if (!hook) throw notFound('Webhook');
  const body = JSON.stringify({
    id: randomUUID(),
    type: 'ping',
    at: new Date().toISOString(),
    actor: { id: String(req.user!._id), name: req.user!.name },
    projectId: null,
    entityId: null,
    resource: 'webhooks',
    data: { message: 'Test delivery from the Project Management System', webhook: hook.name },
  });
  res.json({ delivery: await deliver(hook._id, 'ping', body) });
});

/** Re-sends a stored payload (same body, new delivery id). */
webhooksRouter.post('/:hookId/deliveries/:deliveryId/redeliver', async (req, res) => {
  const old = await WebhookDelivery.findOne({ _id: assertObjectId(req.params.deliveryId, 'Delivery'), webhook: assertObjectId(req.params.hookId, 'Webhook') });
  if (!old) throw notFound('Delivery');
  res.json({ delivery: await deliver(old.webhook, old.eventType, old.payload) });
});
