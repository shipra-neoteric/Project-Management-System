import { Schema, model, type InferSchemaType } from 'mongoose';
import { env } from '../config/env';

export const AUDIT_CATEGORIES = ['change', 'security'] as const;

/**
 * Audit trail: one entry per successful change made through the API, plus security events
 * (sign-ins, failed sign-ins, password changes). Bodies are stored with secrets redacted.
 * Entries expire after AUDIT_RETENTION_DAYS (TTL index on `at`).
 */
const auditSchema = new Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    category: { type: String, enum: AUDIT_CATEGORIES, default: 'change' },
    /** e.g. "task.updated", "auth.login_failed" */
    type: { type: String, required: true },
    action: { type: String, default: '' },
    resource: { type: String, default: '' },
    method: { type: String, default: '' },
    path: { type: String, default: '' },
    status: { type: Number, default: 200 },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    project: { type: Schema.Types.ObjectId, default: null },
    projectName: { type: String, default: '' },
    entityId: { type: String, default: null },
    /** Human-readable sentence, e.g. "Rahul Verma updated task COFO-7 Demolition in Fit-out: status, % done". */
    summary: { type: String, default: '' },
    requestId: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    body: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false },
);
auditSchema.index({ at: 1 }, { expireAfterSeconds: env.AUDIT_RETENTION_DAYS * 86_400 });
auditSchema.index({ at: -1, _id: -1 });
auditSchema.index({ project: 1, at: -1 });
auditSchema.index({ actor: 1, at: -1 });
auditSchema.index({ type: 1, at: -1 });

export type AuditAttrs = InferSchemaType<typeof auditSchema>;
export const AuditLog = model('AuditLog', auditSchema);
