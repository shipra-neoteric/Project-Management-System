import { createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '../config/env';
import { Webhook, WebhookDelivery } from '../models/Security';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { subscribe, type AppEvent } from './events';

/** Tunables (tests shorten the backoff). */
export const webhookConfig = { backoffMs: 2_000, timeoutMs: 10_000, maxRetries: 3, keepDeliveries: 50, disableAfterFailures: 20 };

/** Event types that are never sent out (security-sensitive or about webhooks themselves). */
const NEVER = /^(webhooks|tokens|auth|users\/[^/]+\/2fa)/;

export function matchesEvents(patterns: string[], type: string) {
  return patterns.some((p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))));
}

// ---- SSRF guard -----------------------------------------------------------------------------

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Throws when the URL is not allowed (HTTPS only, except localhost; no private networks in production). */
export async function assertSafeUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !env.isProduction)) throw new Error('Webhook URLs must use https://');
  if (url.username || url.password) throw new Error('Do not put credentials in the URL');
  if (!env.isProduction) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('Webhook URLs must point to a public address');
  return url;
}

// ---- Payloads -------------------------------------------------------------------------------

/** A small, current snapshot of the record (never the raw request body). */
async function entityData(event: AppEvent) {
  if (!event.entityId || event.action === 'deleted') return null;
  const kind = event.type.split('.')[0];
  if (kind === 'task') {
    return Task.findById(event.entityId).select('project name number start finish duration percentComplete status type priority assignee accountable isMilestone').lean();
  }
  if (kind === 'project') {
    return Project.findById(event.entityId).select('name key kind status startDate finishDate parent').lean();
  }
  return null;
}

export async function buildPayload(event: AppEvent) {
  return {
    id: event.id,
    type: event.type,
    at: event.at,
    actor: event.actor,
    projectId: event.projectId,
    entityId: event.entityId,
    resource: event.resource,
    data: await entityData(event),
  };
}

export const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one payload to a webhook with retries (exponential backoff), records the delivery and
 * keeps the webhook's failure counter. Returns the stored delivery.
 */
export async function deliver(webhookId: unknown, eventType: string, body: string) {
  const hook = await Webhook.findById(webhookId).select('+secret');
  if (!hook) return null;
  const deliveryId = randomUUID();
  const started = Date.now();
  let status = 0;
  let response = '';
  let error = '';
  let attempts = 0;
  for (; attempts <= webhookConfig.maxRetries; ) {
    attempts++;
    try {
      await assertSafeUrl(hook.url);
      const res = await fetch(hook.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PMS-Webhooks/1.0',
          'X-PMS-Event': eventType,
          'X-PMS-Delivery': deliveryId,
          'X-PMS-Signature': sign(hook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(webhookConfig.timeoutMs),
      });
      status = res.status;
      response = (await res.text().catch(() => '')).slice(0, 500);
      error = '';
      if (res.ok) break;
      if (status >= 400 && status < 500 && status !== 429) break; // the receiver rejected it: retrying won't help
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (/https:\/\/|public address|valid URL|credentials/.test(error)) break;
    }
    if (attempts <= webhookConfig.maxRetries) await sleep(webhookConfig.backoffMs * 4 ** (attempts - 1));
  }
  const ok = status >= 200 && status < 300;
  const delivery = await WebhookDelivery.create({ webhook: hook._id, deliveryId, eventType, payload: body, ok, status, attempts, durationMs: Date.now() - started, response, error });

  // Keep only the most recent deliveries.
  const old = await WebhookDelivery.find({ webhook: hook._id }).sort({ createdAt: -1 }).skip(webhookConfig.keepDeliveries).select('_id').lean();
  if (old.length) await WebhookDelivery.deleteMany({ _id: { $in: old.map((d) => d._id) } });

  const failures = ok ? 0 : hook.consecutiveFailures + 1;
  const disable = failures >= webhookConfig.disableAfterFailures;
  await Webhook.updateOne(
    { _id: hook._id },
    {
      $set: {
        consecutiveFailures: failures,
        lastDeliveryAt: new Date(),
        ...(disable ? { active: false, disabledReason: `Turned off after ${failures} failed deliveries in a row` } : {}),
      },
    },
  );
  return delivery;
}

/** Fan an event out to every active webhook that wants it. */
export async function dispatch(event: AppEvent) {
  if (NEVER.test(event.resource)) return;
  const hooks = await Webhook.find({ active: true }).lean();
  const wanted = hooks.filter((h) => matchesEvents(h.events ?? ['*'], event.type) && (!h.project || String(h.project) === event.projectId));
  if (!wanted.length) return;
  const body = JSON.stringify(await buildPayload(event));
  await Promise.all(wanted.map((h) => deliver(h._id, event.type, body)));
}

let started = false;
/** Subscribes to the change feed once per process. */
export function startWebhooks() {
  if (started) return;
  started = true;
  subscribe((event) => dispatch(event));
}
