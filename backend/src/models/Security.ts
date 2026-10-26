import { Schema, model, type InferSchemaType } from 'mongoose';

/** Personal access token for the public API. Only a SHA-256 hash of the token is stored. */
const apiTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    tokenHash: { type: String, required: true, unique: true, select: false },
    /** First characters of the token, shown so people can tell their tokens apart. */
    prefix: { type: String, required: true },
    /** 'read' tokens may only make GET requests. */
    scope: { type: String, enum: ['read', 'write'], default: 'read' },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export type ApiTokenAttrs = InferSchemaType<typeof apiTokenSchema>;
export const ApiToken = model('ApiToken', apiTokenSchema);

/** Outgoing webhook: changes matching `events` are POSTed (signed with `secret`) to `url`. */
const webhookSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, maxlength: 2000 },
    /** Event patterns such as "*", "task.*", "time-entry.created". */
    events: { type: [String], default: ['*'] },
    /** Only send events from this project (null = every project). */
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    secret: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    consecutiveFailures: { type: Number, default: 0 },
    disabledReason: { type: String, default: '' },
    lastDeliveryAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const Webhook = model('Webhook', webhookSchema);

/** One delivery attempt series of an event to a webhook (the last 50 per webhook are kept). */
const webhookDeliverySchema = new Schema(
  {
    webhook: { type: Schema.Types.ObjectId, ref: 'Webhook', required: true, index: true },
    deliveryId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: String, required: true },
    ok: { type: Boolean, default: false },
    status: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    response: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);
export const WebhookDelivery = model('WebhookDelivery', webhookDeliverySchema);

/** Pending single sign-on attempt (state, nonce and PKCE verifier); expires after 10 minutes. */
const ssoStateSchema = new Schema({
  state: { type: String, required: true, unique: true },
  nonce: { type: String, required: true },
  verifier: { type: String, required: true },
  redirectUri: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 600 },
});
export const SsoState = model('SsoState', ssoStateSchema);
